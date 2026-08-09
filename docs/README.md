# WordPress → Multi-Platform Publisher (n8n)

> **به‌روزرسانی (Fix Round):** این پروژه یک دور بازبینی کامل امنیتی/باگ طبق `CODE_REVIEW.md` (۱۵ مورد) گذرانده.
> جزئیات کامل هر Fix، تست مربوطه، و وضعیت واقعی (`PASS` / `STATICALLY VERIFIED` / `BLOCKED`) در
> [`FINAL-AUDIT.md`](./FINAL-AUDIT.md) آمده. برای نصب از صفر به [`SETUP.md`](./SETUP.md) مراجعه کنید.
> اسناد تکمیلی: [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`CONFIGURATION.md`](./CONFIGURATION.md) ·
> [`TESTING.md`](./TESTING.md) · [`DEPLOYMENT.md`](./DEPLOYMENT.md) · [`ENVIRONMENT.md`](./ENVIRONMENT.md) ·
> [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md).

سیستم اتوماسیون Event-driven که با انتشار هر پست جدید در WordPress، محتوا را نرمال‌سازی کرده و برای هر شبکه اجتماعی با قالب اختصاصی همان شبکه منتشر می‌کند.

---

## 0. تحلیل قبل از ساخت — Reuse / Change / Remove / Add

پروژه قبلی Omid90 (`OMID90_N8N_*`) بررسی شد. جمع‌بندی:

### Reuse می‌شود (بدون تغییر معنایی)
- الگوی کلی معماری: `Ingest → Dedup (Data Store + Unique Constraint) → Job per Channel → Queue → Worker → Retry/Backoff → Callback/Log → Dashboard`.
- Error Workflow جداگانه با `errorTrigger`، ثبت در `omid90_errors`، هشدار مدیر.
- الگوی سه جدول Data Store: `events` / `publish_queue` / `errors`.
- زیرساخت Docker (n8n Main + Worker + Redis + Postgres، Queue Mode) — بدون هیچ تغییری قابل استفاده است.
- الگوی Retry با Exponential Backoff و سقف Max Attempts.
- الگوی Rate Limit مستقل به‌ازای هر مقصد ارسال، با `Wait` بین Jobها.
- الگوی امنیتی: Secret فقط در Credential/Variable، هرگز در Code Node یا URL.

### تغییر می‌کند
- منبع Event: به‌جای Backend اختصاصی Omid90، اکنون **WordPress** منبع Event است و Payload ورودی باید سبک باشد (`postId` + `eventType`)؛ محتوای کامل از WordPress REST API واکشی می‌شود (پروژه قبلی کل Payload را در همان Webhook دریافت می‌کرد).
- مدل Dedup: به‌جای `eventId` دلخواه از Backend، اینجا `eventId = wp:{postId}:{modifiedAt}` است تا هم از تکرار جلوگیری شود و هم ویرایش واقعی پست بتواند دوباره منتشر شود (Nice-to-have که در پروژه قبلی موضوعیت نداشت چون رویدادها یک‌بارمصرف بودند).
- **جداسازی Formatter از Publisher**: در پروژه قبلی یک Code Node واحد (`قالب مستقل هر شبکه`) همه Templateها را در یک Object نگه می‌داشت. در این پروژه هر پلتفرم Formatter Node مستقل خودش را دارد تا افزودن پلتفرم جدید نیازی به دست‌زدن به Core نداشته باشد (اصل Adapter-based اجباری در این پروژه).
- Callback: پروژه قبلی به Backend امید۹۰ Callback می‌زد (چون Backend مالک وضعیت بود). اینجا WordPress نیازی به Callback ندارد؛ وضعیت فقط در Data Store و Dashboard ذخیره می‌شود.
- دو پلتفرم جدید کاملاً متفاوت (X, LinkedIn) با OAuth2 واقعی اضافه شدند که هیچ مشابهی در پروژه قبلی نداشتند.

### حذف می‌شود
- منطق خاص Omid90 (مسابقه، فرم، برنده، کیف پول، برداشت) کاملاً حذف شد — این پروژه هیچ دانشی از دامنه Omid90 ندارد.
- Callback دوطرفه به Backend امید۹۰.

### اضافه می‌شود
- Normalize Article Layer با یک مدل استاندارد داخلی (بخش ۷) که همه Adapterها فقط از آن می‌خوانند، نه از ساختار خام WordPress.
- Platform Adapter Layer واقعاً مستقل: Formatter و Publisher جدا برای Telegram / Bale / Eitaa / Rubika / X / LinkedIn.
- طبقه‌بندی صریح خطای دائمی در برابر موقتی (`permanent` flag) به‌جای فقط شمارش Attempts.
- Dashboard KPI اضافه‌تر: `totalArticles`, `byPlatform`, `byDate`, `avgLatencyMs`, `recentPublications`.
- `stopAndError` Node در Workflow 01 برای اتصال خطای واکشی WordPress به Error Workflow مرکزی (در پروژه قبلی این حالت وجود نداشت چون Event از قبل کامل بود).

---

## 1. معماری کلی

```text
WordPress (post.published / post.updated)
        │  Webhook سبک: {postId, eventType} + Secret
        ▼
┌─────────────────────────────────────────┐
│ WP 01 — Event Ingest + Dedup + Queue     │
│  validate → fetch full post (WP REST)    │
│  → normalize Article → dedup             │
│  → create N Publication Jobs (1/platform)│
└─────────────────────────────────────────┘
        │ omid90_events / omid90_publish_queue (Data Store)
        ▼
┌─────────────────────────────────────────┐
│ WP 02 — Queue Publisher + Adapters       │
│  every 1 min → pending jobs → lock       │
│  → Platform Adapter (Formatter+Publisher)│
│  → success/retry/failed → rate-limit wait│
└─────────────────────────────────────────┘
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

┌─────────────────────────────────────────┐
│ WP 04 — Publication Dashboard API        │
│  GET → KPI از سه Data Table              │
└─────────────────────────────────────────┘
```

---

## 2. فایل‌های Workflow

| فایل | نقش |
|---|---|
| `workflows/01-wordpress-event-ingest.json` | دریافت Event، واکشی Post کامل، Normalize، Dedup، ساخت Jobها |
| `workflows/02-queue-publisher.json` | صف، قفل، Adapterهای پلتفرم، Retry/Backoff، Rate Limit |
| `workflows/03-error-handler.json` | Error Trigger مرکزی، ثبت خطا، هشدار مدیر |
| `workflows/04-publication-dashboard.json` | Dashboard API با KPIهای کامل |

ترتیب Import: `03 → 01 → 02 → 04` (تا در Settings هر Workflow بتوانید `WP 03 — Error Handler + Admin Alert` را به‌عنوان Error Workflow انتخاب کنید). بعد از Import، همه غیرفعال می‌مانند.

---

## 3. مدل استاندارد Article

همه Adapterها فقط این ساختار را می‌بینند، نه Payload خام WordPress:

```json
{
  "postId": 555,
  "title": "...",
  "content": "<p>HTML خام...</p>",
  "contentText": "نسخه بدون تگ HTML",
  "excerpt": "...",
  "url": "https://site.com/post/555",
  "featuredImage": "https://site.com/img.jpg",
  "categories": ["دسته یک"],
  "tags": ["برچسب یک"],
  "author": "نام نویسنده",
  "publishedAt": "2026-08-01T10:00:00Z",
  "modifiedAt": "2026-08-01T10:00:00Z"
}
```

## 4. Publication Job و Idempotency

هر مقاله × هر پلتفرم فعال = یک Job مستقل.

```text
publication_key = job_id = {postId}:{platform}:{publicationVersion}
publicationVersion = article.modifiedAt (ISO string)
```

**چرا این طراحی؟**
- اگر همان نسخه پست دوباره Event بفرستد (مثلاً Retry شبکه در سمت WordPress) → همان `job_id` → Unique Constraint جلوی Job تکراری را می‌گیرد.
- اگر پست واقعاً ویرایش شود (`modifiedAt` تغییر کند) → `eventId` و `job_id` جدید ساخته می‌شود → یعنی می‌توانید عمداً محتوای به‌روزشده را دوباره منتشر کنید. اگر این رفتار مطلوب نیست (مثلاً فقط اولین انتشار مهم است)، به‌سادگی `eventId` را به `wp:{postId}` (بدون نسخه) تغییر دهید — این تصمیم محصولی است، نه فنی.
- شکست یک پلتفرم (مثلاً X) هرگز باعث ارسال دوباره پلتفرم موفق (مثلاً Telegram) نمی‌شود، چون وضعیت هر Job در ردیف مستقل خودش نگه‌داری می‌شود.

Dedup دو لایه است (دقیقاً مثل پروژه قبلی):
1. `event_id` یکتا در `omid90_events` (جلوگیری از پردازش دوباره کل Event).
2. `job_id` یکتا در `omid90_publish_queue` (جلوگیری از Job تکراری برای یک پلتفرم).

---

## 5. Retry Strategy

| نوع خطا | مثال | رفتار |
|---|---|---|
| موقتی (Temporary) | 408, 425, 429, 500, 502, 503, 504, Timeout | Exponential Backoff تا سقف `max_attempts` (پیش‌فرض ۵)، حداکثر تأخیر ۶۰ دقیقه |
| دائمی (Permanent) | 400, 401, 403, 404, 409, 422 | بلافاصله `failed` بدون Retry بیشتر، حتی در تلاش اول |

فرمول Backoff فعلی: `min(60, 2^attempts)` دقیقه — قابل تنظیم در Code Node `طبقه‌بندی خطا و محاسبه Retry/Backoff` در Workflow 02.

هر Job شکست نهایی‌خورده هم در `omid90_publish_queue.status=failed` ثبت می‌شود و هم یک ردیف مستقل در `omid90_errors` می‌سازد و هشدار مدیر ارسال می‌کند — این مسیر مستقل از `errorTrigger` است چون شکست یک Job یک خطای تجاری قابل پیش‌بینی است، نه یک Exception فنی؛ `errorTrigger`/Workflow 03 برای خطاهای واقعی اجرا (Node crash، Data Store قطع، خطای غیرمنتظره) رزرو شده است.

---

## 6. Rate Limit

هر پلتفرم فاصله مستقل خودش را دارد (از Variables خوانده می‌شود، پیش‌فرض‌ها در صورت نبود Variable):

```text
Telegram : 1s   (TELEGRAM_RATE_LIMIT_SECONDS)
Bale     : 2s   (BALE_RATE_LIMIT_SECONDS)
Eitaa    : 3s   (EITAA_RATE_LIMIT_SECONDS)
Rubika   : 3s   (RUBIKA_RATE_LIMIT_SECONDS)
X        : 2s   (X_RATE_LIMIT_SECONDS)
LinkedIn : 2s   (LINKEDIN_RATE_LIMIT_SECONDS)
```

⚠️ این مقادیر **قرارداد قطعی هیچ Provider نیستند** — به‌خصوص X (سقف واقعی به Pricing Tier شما بستگی دارد: Free=۵۰ Post/روز) و LinkedIn (Rate Limit روزانه بر اساس نوع اپلیکیشن). باید با مستندات رسمی و Load Test واقعی تنظیم شوند.

---

## 7. Platform Adapters — وضعیت واقعی API هر شبکه

| پلتفرم | Endpoint | Auth | یادداشت صادقانه |
|---|---|---|---|
| Telegram | `POST {TELEGRAM_API_BASE}/bot{token}/sendMessage` | Bot Token (Credential رسمی n8n) | مستند و پایدار. پیشنهاد: بعد از Import، HTTP Request را با Node رسمی `n8n-nodes-base.telegram` جایگزین کنید. |
| Bale | `POST {BALE_API_BASE}/sendMessage` | Header Auth (Gateway) | API بله عمومی/رسمی مستندسازی‌شده گسترده‌ای مثل Telegram ندارد؛ شکل Payload بر اساس سازگاری آن با Telegram Bot API فرض شده (طبق پروژه قبلی) — **قبل از Production با مستندات Gateway واقعی خودتان تطبیق دهید.** |
| Eitaa | `POST {EITAA_TEXT_ENDPOINT}` | Header Auth (Gateway) | هیچ API عمومی رسمی مستندی وجود ندارد؛ Payload (`destinationId/text/fileUrl`) فرضی و بر پایه الگوی پروژه قبلی Omid90 است، **نه یک استاندارد مستند**. حتماً با Gateway واقعی خودتان Validate کنید. |
| Rubika | `POST {RUBIKA_TEXT_ENDPOINT}` | Header Auth (Gateway) | مشابه Eitaa — فرضی، نیازمند تطبیق با API/Gateway واقعی شما. |
| X (Twitter) | `POST https://api.x.com/2/tweets` | OAuth 2.0 PKCE، user-context، scope=`tweet.write` | تأیید شده با مستندات فعلی X API v2 (مرداد ۱۴۰۵ / اوت ۲۰۲۶). محدودیت متن ۲۸۰ کاراکتر. **X هیچ Endpoint زمان‌بندی ندارد** — همه Retry باید داخل این Queue انجام شود. Free Tier فعلاً ۵۰ پست در روز. |
| LinkedIn | `POST https://api.linkedin.com/rest/posts` | OAuth 2.0، Header `LinkedIn-Version: YYYYMM`، `X-Restli-Protocol-Version: 2.0.0` | از **Posts API** رسمی فعلی استفاده شده (نه UGC Posts API قدیمی که منسوخ شده). نیازمند تأیید اپلیکیشن توسط LinkedIn برای Scope مربوطه (`w_member_social` یا `w_organization_social`). Post URN موفق در Header پاسخ `x-restli-id` برمی‌گردد، نه در Body. |

هیچ‌کدام از این Endpointها یا Payloadها ساختگی نیستند؛ اما برای Eitaa/Rubika تصریح شده که مستندات عمومی رسمی وجود ندارد و شکل دقیق باید با Gateway واقعی شما تطبیق داده شود.

---

## 8. Environment Variables

فایل کامل: [`./.env.example`](./.env.example)

دسته‌بندی:
- Infra: `N8N_*`, `POSTGRES_*`, `REDIS_PASSWORD`
- WordPress: `WORDPRESS_BASE_URL`, `WORDPRESS_WEBHOOK_SECRET` (+ Token در Credential، نه در env)
- عمومی: `ACTIVE_PLATFORMS`, `ADMIN_ALERT_ENDPOINT`, `ADMIN_ALERT_CHAT_ID`
- هر پلتفرم: `*_API_BASE` / `*_ENDPOINT`, `*_CHAT_ID` / `*_CHANNEL_ID` / `*_AUTHOR_URN`, `*_RATE_LIMIT_SECONDS`

Secretها (Tokenها، Access Tokenها) **هرگز** در `.env` یا Workflow JSON نیستند؛ فقط در n8n Credentials.

---

## 9. Docker / Self-host

فایل [`./docker-compose.yml`](./docker-compose.yml) بر پایه معماری Docker پروژه قبلی Omid90 است (n8n Main + Worker + Redis + Postgres، Queue Mode). تنها تغییرات: Pin شدن نسخه Image (Fix #8) و هماهنگی تنظیمات ذخیره Execution با سطح Workflow (Fix #12) — جزئیات در `ARCHITECTURE.md` و کامنت بالای همان فایل. برای مراحل کامل راه‌اندازی به [`DEPLOYMENT.md`](./DEPLOYMENT.md) مراجعه کنید.

---

## 10. افزودن پلتفرم جدید (مثلاً Instagram)

بدون تغییر Core، فقط:

1. یک Rule جدید به Switch Node «انتخاب Platform Adapter» در Workflow 02 اضافه کنید (`platform == 'instagram'`).
2. یک Code Node «Instagram Formatter» بسازید که از مدل استاندارد Article، Payload اینستاگرام را می‌سازد.
3. یک HTTP Request Node «Instagram Publisher» بسازید که به API واقعی اینستاگرام (Graph API) ارسال می‌کند.
4. خروجی Publisher را به همان Node مشترک «نرمال‌سازی نتیجه ارسال» وصل کنید.
5. `instagram` را به `ACTIVE_PLATFORMS` اضافه کنید.

Queue، Dedup، Retry، Error Handler و Dashboard بدون تغییر باقی می‌مانند.

---

## 11. Data Table Requirements

به بخش [`DATA_TABLES.md`](./DATA_TABLES.md) مراجعه کنید — طبق درخواست، جدول‌ها هنوز ساخته نشده‌اند؛ فقط Schema دقیق مستند شده تا در مرحله بعد ساخته شوند.

---

## 12. گزارش تست

به [`TESTING.md`](./TESTING.md) و [`FINAL-AUDIT.md`](./FINAL-AUDIT.md) مراجعه کنید (این دو فایل جایگزین `TEST_REPORT.md` قدیمی شدند).

**شفاف‌سازی مهم (بدون تغییر از ابتدای پروژه، همچنان صادق):** هیچ تماس واقعی به API واقعی Telegram/Bale/Eitaa/Rubika/X/LinkedIn یا یک نمونه واقعی WordPress برقرار نشد (چون Credential/Endpoint واقعی در اختیار من نیست). تست‌ها در سه سطح انجام شدند:

1. **تست منطقی واقعی (اجرا شد)** — کد دقیقاً همان `jsCode` داخل هر Code Node از فایل‌های `.json` نهایی استخراج و با Node.js روی ورودی‌های شبیه‌سازی‌شده (Mock) واقعاً اجرا شد؛ ۱۰۰/۱۰۰ چک PASS (`tests/run_tests.js`).
2. **تست ساختاری** — همه ۴ Workflow با JSON Parser Validate شدند، صحت تمام Connectionها و Configuration خام Nodeهای غیر-Code (fullResponse، filters، limit، credentials) به‌صورت برنامه‌نویسی‌شده بررسی شد.
3. **تست HTTP آماده، اجرا نشده** — اسکریپت‌های PowerShell در `tests/powershell/` برای اجرا روی یک نمونه n8n واقعی آماده‌اند اما در این محیط توسعه (بدون Docker/شبکه) اجرا نشدند؛ وضعیت `BLOCKED`.

آنچه تست **نشد** و صادقانه اعلام می‌شود: فراخوانی واقعی n8n Runtime (چون n8n نصب‌شده در این محیط نیست)، فراخوانی واقعی هر ۶ API پلتفرم، رفتار واقعی Data Table n8n (Unique Constraint، Filter syntax دقیق)، و تست هم‌زمانی واقعی (Fix #10).
