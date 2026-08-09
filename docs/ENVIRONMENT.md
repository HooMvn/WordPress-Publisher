# ENVIRONMENT.md — مرجع کامل متغیرهای محیطی

منبع اصلی: `.env.example`. این سند فقط یک نمای جدولی/دسته‌بندی‌شده برای مرجع سریع اضافه می‌کند؛ برای توضیح
هر متغیر، کامنت بالای همان متغیر در `.env.example` را بخوانید (توضیحات آنجا با ارجاع مستقیم به شماره Fix
مربوطه در `CODE_REVIEW.md` نوشته شده‌اند).

## دسته‌بندی

| دسته | متغیرها | فایل مصرف‌کننده |
|---|---|---|
| Infra | `N8N_HOST`, `N8N_ENCRYPTION_KEY`, `POSTGRES_*`, `REDIS_PASSWORD` | `docker-compose.yml` |
| WordPress | `WORDPRESS_BASE_URL`, `WORDPRESS_WEBHOOK_SECRET` | `01-wordpress-event-ingest.json` |
| Dashboard (Fix #4) | `DASHBOARD_API_SECRET` | `04-publication-dashboard.json` |
| عمومی | `ACTIVE_PLATFORMS`, `ADMIN_ALERT_ENDPOINT`, `ADMIN_ALERT_CHAT_ID` | `01`, `02`, `03` |
| Telegram | `TELEGRAM_CHAT_ID`, `TELEGRAM_RATE_LIMIT_SECONDS` | `02-queue-publisher.json` |
| Bale | `BALE_API_BASE`, `BALE_CHAT_ID`, `BALE_RATE_LIMIT_SECONDS` | `02-queue-publisher.json` |
| Eitaa | `EITAA_TEXT_ENDPOINT`, `EITAA_CHANNEL_ID`, `EITAA_RATE_LIMIT_SECONDS` | `02-queue-publisher.json` |
| Rubika | `RUBIKA_TEXT_ENDPOINT`, `RUBIKA_CHANNEL_ID`, `RUBIKA_RATE_LIMIT_SECONDS` | `02-queue-publisher.json` |
| X (Fix #13) | `X_API_BASE`, `X_RATE_LIMIT_SECONDS`, `X_USER_ID` | `02-queue-publisher.json` |
| LinkedIn | `LINKEDIN_API_VERSION`, `LINKEDIN_AUTHOR_URN`, `LINKEDIN_RATE_LIMIT_SECONDS` | `02-queue-publisher.json` |

## قوانین سخت‌گیرانه (بدون استثنا)

1. هیچ Token/Access Token/API Key خامی هرگز در `.env` نوشته نمی‌شود — فقط در n8n Credentials
   (`CONFIGURATION.md` بخش ۲). `.env.example` عمداً هیچ فیلد Tokenی ندارد که واقعاً پر شود.
2. `WORDPRESS_WEBHOOK_SECRET` و `DASHBOARD_API_SECRET` باید **مقادیر متفاوت** باشند (حداقل ۳۲ کاراکتر تصادفی).
   یکسان بودن آن‌ها یعنی لو رفتن یکی، هر دو مسیر Auth را لو می‌دهد — دقیقاً همان مشکلی که جداسازی آن‌ها
   (Fix #4) قرار بود حل کند.
3. `N8N_ENCRYPTION_KEY` بعد از اولین `docker compose up` هرگز عوض نشود (`DEPLOYMENT.md` بخش ۱).
4. مقادیر `*_RATE_LIMIT_SECONDS` قرارداد قطعی هیچ Providerی نیستند (`README.md` بخش ۶) — قبل از افزایش بار
   واقعی، با مستندات رسمی هر پلتفرم و یک Load Test واقعی تنظیم شوند.

## چک‌لیست قبل از هر Deploy

```text
[ ] همه CHANGE_ME در .env جایگزین شده
[ ] WORDPRESS_WEBHOOK_SECRET != DASHBOARD_API_SECRET
[ ] ACTIVE_PLATFORMS فقط شامل پلتفرم‌هایی است که Credential واقعی برایشان تنظیم شده
[ ] ADMIN_ALERT_ENDPOINT تنظیم شده (وگرنه هشدار مدیر بی‌صدا Fail می‌شود، هرچند onError=continueRegularOutput
    مانع توقف کل Workflow می‌شود)
[ ] X_API_BASE روی مقدار پیش‌فرض صحیح (https://api.x.com) یا Sandbox شما تنظیم شده
```
