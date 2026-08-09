# TROUBLESHOOTING.md

## علائم رایج و علت‌های محتمل

### ۱. Webhook همیشه 401 برمی‌گرداند حتی با Secret درست
- بررسی کنید Header دقیقاً `X-WP-Webhook-Secret` باشد (Header قدیمی `X-Omid90-Webhook-Secret` دیگر پذیرفته
  نمی‌شود — Fix #7).
- بررسی کنید n8n Variable با نام دقیق `WORDPRESS_WEBHOOK_SECRET` تنظیم شده (نه فقط در `.env` سرور —
  `CONFIGURATION.md` بخش ۱).
- طول Secret شما و Secret تنظیم‌شده باید دقیقاً برابر باشد؛ `crypto.timingSafeEqual` (Fix #6) با طول نابرابر
  همیشه `false` برمی‌گرداند، حتی اگر پیشوند یکسان باشد.

### ۲. یک درخواست معتبر 401 می‌گیرد ولی انتظار 422 دارید (یا برعکس)
طبق Fix #15، این پروژه این دو را عمداً تفکیک می‌کند: **401 = Secret نادرست/غایب**، **422 = Secret درست ولی
`eventType`/`postId` نامعتبر**. اگر رفتار برعکس دیدید، Node «طبقه‌بندی نتیجه اعتبارسنجی» (Switch) را چک کنید —
شاید ترتیب Ruleها یا مقدار `outcome` تغییر کرده.

### ۳. یک پست ویرایش‌شده در وردپرس دوباره منتشر نمی‌شود
این رفتار **عمدی** است (`README.md` بخش ۴): `eventId = wp:{postId}:{modifiedAt}`. اگر `modifiedAt` واقعاً در
WordPress تغییر نکرده باشد (مثلاً فقط یک Autosave بدون تغییر `modified_gmt`)، Event تکراری تشخیص داده می‌شود.
اگر می‌خواهید فقط اولین انتشار مهم باشد، `eventId` را به `wp:{postId}` (بدون نسخه) تغییر دهید — این یک تصمیم
محصولی است، نه باگ.

### ۴. یک پلتفرم به‌اشتباه «موفق» ثبت می‌شود با این‌که واقعاً ارسال نشده
این دقیقاً باگ اصلی گزارش‌شده در Fix #2 بود. اگر بعد از این Fix باز هم می‌بینید، بررسی کنید:
- آیا Node «نرمال‌سازی نتیجه ارسال» تغییر کرده و شرط `if (resp.delivery && ...)` حذف شده؟
- آیا یک Adapter جدید (طبق README بخش ۱۰) خروجی HTTP خودش را با `fullResponse:true` برنمی‌گرداند؟ اگر
  `fullResponse` نباشد، `resp.statusCode` وجود ندارد و پیش‌فرض به ۲۰۰ می‌افتد.

### ۵. `provider_response_json` هنوز شامل Token/Secret است
تابع `redact()` فقط کلیدهایی را می‌گیرد که با Regex `(authorization|token|secret|cookie)` (Case-insensitive)
مطابقت داشته باشند. اگر Provider جدید یک فیلد حساس با نام دیگر برگرداند (مثلاً `apiKey` یا `sessionId`)، این
Regex را در «نرمال‌سازی نتیجه ارسال» گسترش دهید.

### ۶. Dashboard 401 می‌دهد با این‌که فکر می‌کنید Secret درست است
Header باید دقیقاً `X-Dashboard-Api-Secret` باشد — این جدا از `X-WP-Webhook-Secret` است (Fix #4، عمداً دو
مسیر Auth مستقل). بررسی کنید n8n Variable `DASHBOARD_API_SECRET` (نه `WORDPRESS_WEBHOOK_SECRET`) تنظیم شده.

### ۷. صف هرگز خالی نمی‌شود / Jobها هیچ‌وقت `sent` نمی‌شوند
- بررسی کنید Workflow 02 واقعاً Active است (Schedule Trigger فقط وقتی Workflow Active است اجرا می‌شود).
- بررسی کنید Filter روی «خواندن Jobهای Pending» درست تنظیم شده (`CONFIGURATION.md` بخش ۳)؛ اگر Filter اشتباه
  باشد ممکن است هیچ ردیفی برنگردد.
- بررسی کنید `next_attempt_at` مقدار معتبر ISO دارد؛ مقدار خالی/نامعتبر باعث می‌شود شرط `<=now` در Node
  «مرتب‌سازی و محدودسازی صف» به‌درستی ارزیابی نشود.

### ۸. دو Execution هم‌زمان همان Job را دو بار ارسال می‌کنند
اگر `UNIQUE(job_id)` واقعاً روی جدول زیرین تعریف نشده باشد (`CONFIGURATION.md` بخش ۴)، Mitigation کد (Fix #10)
فقط پنجره Race را کوچک می‌کند، آن را صفر نمی‌کند. این محدودیت شناخته‌شده و صراحتاً در `FINAL-AUDIT.md` (#10)
مستند شده — راه‌حل قطعی، تعریف Constraint واقعی در دیتابیس است.

### ۹. `docker compose up` با خطای Image Pull شکست می‌خورد
تصویر Pin‌شده (`n8nio/n8n:1.94.1`، `postgres:16.4-alpine`، `redis:7.4-alpine`) باید در Registry شما در دسترس
باشد. اگر شبکه شما به Docker Hub دسترسی ندارد، از یک Mirror/Registry داخلی استفاده کنید یا نسخه را در
`docker-compose.yml` به نسخه در دسترس (با همان Minor، طبق دلیل نوشته‌شده در همان فایل) تغییر دهید.

### ۱۰. متن فارسی بعد از Normalize کاراکترهای عجیب دارد
`stripHtml` فقط `&nbsp; &amp; &#8217;/&#039; &#8220;/&#8221;/&quot;` را Decode می‌کند (محدودیت شناخته‌شده،
`ARCHITECTURE.md` بخش ۳). اگر محتوای WordPress شما از Entityهای دیگر HTML (مثلاً `&hellip;`, `&mdash;`, یا
اعداد عربی/فارسی Encode‌شده) استفاده می‌کند، این تابع را در Node «Normalize Article» گسترش دهید.

## لاگ‌ها و ابزار Debug

- **Execution ناموفق کامل ذخیره می‌شود** (`saveDataErrorExecution=all`، Fix #12) — از UI n8n → Executions →
  Filter by Failed برای دیدن دقیق Item ورودی/خروجی هر Node استفاده کنید.
- **Execution موفق ذخیره نمی‌شود** (`saveDataSuccessExecution=none`) — برای Debug موقت یک اجرای موفق، از
  «Execute Workflow» دستی در n8n UI استفاده کنید که همیشه نتیجه را نمایش می‌دهد، صرف‌نظر از تنظیم ذخیره‌سازی.
- خطاهای فنی (Node Crash و مشابه) در جدول `omid90_errors` با `severity=high` و بدون `job_id` ثبت می‌شوند؛
  شکست‌های تجاری Job (Retry تمام‌شده) با `job_id`/`platform` پر و `severity=high`/`medium` بسته به Permanent
  بودن.
