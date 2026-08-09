# ARCHITECTURE.md

## 1. نمای کلی

```text
WordPress (post.published / post.updated)
        │  Webhook سبک: {postId, eventType} + X-WP-Webhook-Secret
        ▼
┌───────────────────────────────────────────┐
│ WP 01 — Event Ingest + Dedup + Queue       │
│  validate(outcome: ok|unauthorized|        │
│           invalid_payload)                 │  → Fix #15: 401 vs 422
│  → fetch full post (fullResponse:true)     │  → Fix #1
│  → normalize status (599 fallback)         │
│  → normalize Article                       │
│  → dedup (read) → insert → race-detect     │  → Fix #10 (event layer)
│  → create N Publication Jobs (1/platform)  │
│  → aggregate N items → 1 response          │  → Fix #3
└───────────────────────────────────────────┘
        │ omid90_events / omid90_publish_queue (Data Table)
        ▼
┌───────────────────────────────────────────┐
│ WP 02 — Queue Publisher + Adapters         │
│  every 1 min → pending jobs (filtered,     │  → Fix #11
│    sorted, limited to 50)                  │
│  → optimistic lock + lock-verify           │  → Fix #10 (queue layer)
│  → Platform Adapter (Formatter+Publisher)  │
│  → unified result normalize (redact +      │  → Fix #2, #5, #14
│    classify permanent/temporary/unknown)   │
│  → success/retry/failed → rate-limit wait  │
└───────────────────────────────────────────┘
        │
        ├─▶ success → omid90_publish_queue.status = sent
        └─▶ failure → retry (temporary) یا failed (permanent/max attempts)
                          │
                          ▼
                 ┌─────────────────────────┐
                 │ WP 03 — Error Handler    │
                 │  errorTrigger + dead-job │
                 │  → omid90_errors + Alert │
                 └─────────────────────────┘

┌───────────────────────────────────────────┐
│ WP 04 — Publication Dashboard API          │
│  auth (X-Dashboard-Api-Secret) → Fix #4    │
│  → GET → KPI از سه Data Table (فیلتر ۳۰روزه)│ → Fix #11
└───────────────────────────────────────────┘
```

## 2. تصمیمات معماری کلیدی (به‌همراه دلیل هرکدام، مرتبط با CODE_REVIEW.md)

### تصمیم #1 — لایه یکنواخت‌سازی پاسخ HTTP (Fix #1)
`fullResponse:true` روی هر HTTP Request که باید کد وضعیت واقعی را ببیند اضافه شد، و یک Code Node مستقل
(«یکنواخت‌سازی پاسخ WordPress») خروجی خام n8n را به شکل ثابت `{statusCode, body}` تبدیل می‌کند. این جداسازی
عمدی است: اگر شکل دقیق خروجی `fullResponse` در نسخه‌های بعدی n8n تغییر کند، فقط همین یک Node باید اصلاح شود،
نه همه IF Nodeهای پایین‌دستی.

### تصمیم #2 — outcome صریح به‌جای boolean valid (Fix #15)
`اعتبارسنجی Webhook` دیگر فقط `valid: true/false` برنمی‌گرداند؛ `outcome: 'ok'|'unauthorized'|'invalid_payload'`
تولید می‌کند و یک Switch Node مسیر پاسخ HTTP را بر همان اساس انتخاب می‌کند (401 در برابر 422). این تفکیک برای
مصرف‌کننده Webhook (مثلاً یک پلاگین وردپرس که Retry می‌کند) مهم است: 401 یعنی «Secret را چک کن»، 422 یعنی
«Payload را چک کن» — رفتار Retry متفاوتی می‌طلبند.

### تصمیم #3 — Aggregation Node قبل از هر Respond to Webhook (Fix #3)
هر Webhook در n8n دقیقاً یک بار می‌تواند پاسخ بدهد. وقتی یک Code Node بالادست چند Item (یک Job به ازای هر
پلتفرم) تولید می‌کند، این کار **باید** قبل از رسیدن به `respondToWebhook` جمع شود. این الگو (aggregate-then-
respond) یک قاعده کلی این پروژه است، نه فقط یک Patch موضعی.

### تصمیم #4 — delivery از قبل موجود را حفظ کن، دوباره تحلیل نکن (Fix #2)
«نرمال‌سازی نتیجه ارسال» یک قانون ساده دارد: اگر Item ورودی از قبل `delivery` دارد (یعنی از مسیر Fallback
«Platform ناشناخته» آمده)، همان را (فقط بعد از Redact) نگه دار. در غیر این صورت، از `statusCode`/`body` HTTP
واقعی تحلیل کن. مخلوط کردن این دو مسیر منبع باگ اصلی گزارش بود.

### تصمیم #5 — Redact در نقطه واحد، نه در هر Publisher (Fix #5)
تابع `redact()` فقط یک‌بار، در «نرمال‌سازی نتیجه ارسال»، تعریف شده — نه در هر Formatter/Publisher — چون این
تنها نقطه‌ای است که پاسخ Provider قرار است در Data Table ذخیره شود. بازگشتی و Case-insensitive بودن آن تضمین
می‌کند فیلد `Token`/`AUTHORIZATION`/`cookie` در هر عمقی از Object یا Array مخفی شود.

### تصمیم #6 — Timing-safe compare فقط در دو نقطه Auth (Fix #6)
`crypto.timingSafeEqual` در «اعتبارسنجی Webhook» و «اعتبارسنجی Dashboard Secret» به‌صورت مستقل پیاده شده (نه
یک تابع مشترک import‌شده) چون Code Nodeهای n8n نمی‌توانند بین یکدیگر فایل مشترک Import کنند؛ تکرار کد کوچک
(۱۵ خط) اینجا آگاهانه انتخاب شده تا هر Workflow به‌تنهایی قابل Import/Export/Debug باشد.

### تصمیم #7 — Race Mitigation دو لایه‌ای، نه ادعای حذف کامل Race (Fix #10)
- لایه Event: Insert با `onError=continueRegularOutput` + یک Node تشخیص «آیا این خطا شبیه Unique Violation
  است؟» → اگر بله، مسیر Duplicate دنبال می‌شود.
- لایه Queue Lock: Update شرطی (`job_id AND status='pending'`) + یک Node تایید که بررسی می‌کند آیا واقعاً
  ردیفی Update شد؛ اگر نه (رقیب برنده شده)، این Worker همان Job را در همین چرخه Skip می‌کند.

این دو لایه **فقط زمانی واقعاً Atomic هستند** که `UNIQUE(event_id)`/`UNIQUE(job_id)` در سطح دیتابیس واقعی
تعریف شده باشد (`CONFIGURATION.md` بخش ۴). بدون آن Constraint، این کد یک Best-effort Mitigation است، نه یک
تضمین ریاضی — این پروژه هرگز ادعای بیشتر از این نکرده (طبق دستور صریح Task، از overclaim خودداری شده).

### تصمیم #8 — Classification صریح permanent/temporary/unknown (Fix #14)
به‌جای فقط یک boolean `permanent`، یک فیلد `classification` هم اضافه شد که مقصود کد را برای هر توسعه‌دهنده
بعدی شفاف می‌کند و تست مستقیم روی آن انجام می‌شود (`temporaryCodes` واقعاً استفاده می‌شود، نه فقط تعریف).

## 3. آنچه عمداً اضافه نشد

- **Circuit Breaker per-platform** (پیشنهاد جزئی گزارش): منطق فعلی (Backoff نمایی + طبقه‌بندی صریح
  permanent/temporary) همان مشکل اصلی (جلوگیری از Hammering یک API محدود) را با پیچیدگی کمتر پوشش می‌دهد.
  افزودن Pause سراسری per-platform نیاز به یک ستون/جدول جدید (`platform_status`) و هماهنگی بین Workerهای
  موازی دارد — خارج از دامنه ۱۵ مورد اصلی `CODE_REVIEW.md`. اگر لازم شد: یک جدول `omid90_platform_health`
  با `consecutive_failures` و `paused_until` پیشنهاد می‌شود.
- **کتابخانه HTML-entity-decode برای stripHtml**: پوشش فعلی (`&nbsp; &amp; &#8217;/&#039; &#8220;/&#8221;/
  &quot;`) برای محتوای نمونه فارسی این پروژه (تست T31) کافی بود؛ افزودن Dependency خارجی فقط برای این باعث
  افزایش سطح حمله/نگهداری بدون سود اثبات‌شده می‌شود. در `TROUBLESHOOTING.md` به‌عنوان محدودیت شناخته‌شده ثبت شده.

## 4. مرز مسئولیت هر Workflow

| Workflow | مسئول | مسئول **نیست** |
|---|---|---|
| 01 | اعتبارسنجی، واکشی، Normalize، Dedup سطح Event، ساخت Job | ارسال واقعی به هیچ پلتفرمی |
| 02 | صف، قفل، ارسال، Retry/Backoff، Rate Limit | اعتبارسنجی Webhook یا Normalize |
| 03 | فقط خطاهای فنی اجرا (`errorTrigger`) | شکست تجاری Job (که مستقیماً در 02 مدیریت می‌شود) |
| 04 | فقط خواندن/تجمیع KPI (Read-only) | هیچ نوشتنی روی Data Table |
