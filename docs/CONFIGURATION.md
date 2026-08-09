# CONFIGURATION.md — پیکربندی دقیق ۴ Workflow بعد از Import

این سند مکمل `.env.example` است و روی چیزهایی تمرکز دارد که **در UI n8n** (نه در فایل env) باید تنظیم شوند:
Variables، Credentials، و Data Table Filters. تا این‌ها انجام نشوند، Workflowها با خطا یا رفتار نادرست اجرا
می‌شوند، حتی اگر JSON از نظر Syntax درست باشد.

---

## 1. n8n Variables (Settings → Variables)

همه متغیرهای `.env.example` باید به‌صورت n8n Variable هم وارد شوند (نه فقط در فایل `.env` سرور)، چون Expression
های داخل Workflow (`$vars.XXX`) از این مسیر خوانده می‌شوند، نه از `process.env` مستقیم:

| Variable | استفاده در Node | الزامی؟ |
|---|---|---|
| `WORDPRESS_BASE_URL` | «واکشی Post کامل از WordPress API» | بله |
| `WORDPRESS_WEBHOOK_SECRET` | «اعتبارسنجی Webhook» | بله |
| `DASHBOARD_API_SECRET` | «اعتبارسنجی Dashboard Secret» (Fix #4) | بله |
| `ACTIVE_PLATFORMS` | «ساخت Publication Job برای هر پلتفرم» | بله (پیش‌فرض داخلی هم دارد) |
| `ADMIN_ALERT_ENDPOINT` / `ADMIN_ALERT_CHAT_ID` | Workflow 03 + هشدار Job Failed در Workflow 02 | بله برای هشدار مدیر |
| `TELEGRAM_CHAT_ID`, `*_RATE_LIMIT_SECONDS` | Formatter/Publisher هر پلتفرم | بله برای پلتفرم‌های فعال |
| `BALE_API_BASE`, `BALE_CHAT_ID` | Bale | اگر `bale` در ACTIVE_PLATFORMS باشد |
| `EITAA_TEXT_ENDPOINT`, `EITAA_CHANNEL_ID` | Eitaa | اگر `eitaa` فعال باشد |
| `RUBIKA_TEXT_ENDPOINT`, `RUBIKA_CHANNEL_ID` | Rubika | اگر `rubika` فعال باشد |
| `X_API_BASE` (Fix #13) | X Publisher | خیر — Fallback به `https://api.x.com` |
| `LINKEDIN_API_VERSION`, `LINKEDIN_AUTHOR_URN` | LinkedIn | اگر `linkedin` فعال باشد |

---

## 2. Credentials (Settings → Credentials)

| نام Credential | نوع | استفاده در |
|---|---|---|
| `WordPress API Token` | Header Auth (`Authorization: Bearer <token>`) | «واکشی Post کامل از WordPress API» |
| `Telegram account` | Telegram API (رسمی n8n) | «Telegram Publisher» (Fix #9 — دیگر HTTP Request دستی نیست) |
| `WP Bale Header Auth` | Header Auth | «Bale Publisher» |
| `WP Eitaa Header Auth` | Header Auth | «Eitaa Publisher» |
| `WP Rubika Header Auth` | Header Auth | «Rubika Publisher» |
| `WP X OAuth2` | HTTP Bearer Auth (توکن OAuth2 PKCE) | «X Publisher» |
| `WP LinkedIn OAuth2` | HTTP Bearer Auth | «LinkedIn Publisher» |
| `WP Admin Alert Credential` | Header Auth | هشدارهای مدیر در Workflow 02/03 |

بعد از Import، هر Node که `credentials.id = "SELECT_AFTER_IMPORT"` دارد را دستی باز کنید و Credential واقعی
را انتخاب/بسازید. Import خودکار n8n هرگز Credential واقعی را با خودش نمی‌آورد (طراحی امنیتی خودِ n8n).

---

## 3. Data Table Filters (Fix #11) — تنظیم دستی بعد از ساخت جدول

هر ۳ جدول (`wordpress-publisher_events`, `wordpress-publisher_publish_queue`, `wordpress-publisher_errors`) باید طبق `DATA_TABLES.md` ساخته شوند.
شکل `filters.conditions` که در JSON این پروژه نوشته شده (`{keyName, condition, keyValue}`) **بهترین برداشت ما از
مستندات عمومی Data Table Node** است؛ ممکن است بین نسخه‌های n8n اسم فیلد کمی فرق کند. بعد از Import:

1. باز کنید Node «جستجوی eventId در Data Store» → تایید کنید فیلتر `event_id = {{$json.eventId}}` واقعاً در UI
   دیده می‌شود و `limit=1` اعمال شده.
2. باز کنید Node «خواندن Jobهای Pending» → تایید فیلتر `status = pending` و `limit=500` (فیلتر
   `next_attempt_at<=now` به‌صورت Code-level در Node بعدی «مرتب‌سازی و محدودسازی صف» انجام می‌شود، چون Data
   Table مقایسه پویا با `now()` را به‌صورت مستند پشتیبانی نمی‌کند).
3. هر ۳ Node Dashboard (`خواندن Events/Queue/Errors`) → تایید فیلتر `>= now-30d` و `limit=2000`.

اگر UI شکل دیگری از `filters` نشان داد (نسخه متفاوت n8n)، فیلتر را دستی در UI بازسازی کنید؛ منطق Code Nodeهای
پایین‌دستی (Sort/Limit/Dedup) به شکل دقیق پارامتر Data Table وابسته نیست و در هر صورت درست کار می‌کند — فقط
کارایی (خواندن داده کمتر) کاهش می‌یابد اگر فیلتر UI درست تنظیم نشود.

---

## 4. Unique Constraints (Fix #10 — پیش‌نیاز عملی Race-Mitigation)

```sql
-- روی جدول واقعی زیرین Data Table (یا معادل UI آن) اجرا شود:
ALTER TABLE wordpress-publisher_events ADD CONSTRAINT wordpress-publisher_events_event_id_key UNIQUE (event_id);
ALTER TABLE wordpress-publisher_publish_queue ADD CONSTRAINT wordpress-publisher_publish_queue_job_id_key UNIQUE (job_id);
```

بدون این Constraint، منطق Fix #10 (تشخیص خطای Insert به‌عنوان نشانه Race) هیچ‌وقت فعال نمی‌شود چون Insert
تکراری اصلاً خطا نمی‌دهد. این مورد در `FINAL-AUDIT.md` به‌صراحت `BLOCKED` علامت خورده چون در این محیط توسعه
Data Table واقعی در دسترس نبود.

---

## 5. Error Workflow (Settings → هر ۴ Workflow → Error Workflow)

در Settings هر یک از Workflow 01/02/04، مقدار «Error Workflow» را روی **«WP 03 — Error Handler + Admin Alert»**
تنظیم کنید. ترتیب Import پیشنهادی در `SETUP.md` دقیقاً به همین دلیل `03 → 01 → 02 → 04` است.
