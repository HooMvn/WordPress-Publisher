# DEPLOYMENT.md

## پیش‌نیازها
- سروری با Docker + Docker Compose v2
- یک دامنه با TLS معتبر روبه‌روی n8n (Reverse Proxy پیشنهادی: Caddy/Traefik/Nginx با Let's Encrypt)
- دسترسی به WordPress با REST API فعال و امکان ارسال Webhook از پلاگین/Hook سفارشی
- Credential واقعی هر پلتفرمی که در `ACTIVE_PLATFORMS` فعال می‌کنید

## مراحل

### 1. آماده‌سازی محیط
```bash
cp .env.example .env
# همه CHANGE_ME‌ها را با مقادیر واقعی/تصادفی جایگزین کنید:
openssl rand -hex 32   # برای N8N_ENCRYPTION_KEY, WORDPRESS_WEBHOOK_SECRET, DASHBOARD_API_SECRET, POSTGRES_PASSWORD, REDIS_PASSWORD
```
مقادیر `N8N_ENCRYPTION_KEY` را بعد از اولین اجرا **هرگز تغییر ندهید** — تغییر آن یعنی همه Credentialهای
ذخیره‌شده در n8n غیرقابل‌رمزگشایی می‌شوند.

### 2. اجرای Docker Compose
```bash
docker compose --env-file .env up -d
docker compose ps   # صبر کنید postgres و redis healthy شوند
```
نسخه‌های Pin‌شده (`n8nio/n8n:1.94.1`, `postgres:16.4-alpine`, `redis:7.4-alpine`) دلیل انتخاب‌شان در بالای
`docker-compose.yml` مستند شده (Fix #8).

### 3. Reverse Proxy + TLS
`n8n-main` فقط روی `127.0.0.1:5678` منتشر شده (نه روی همه Interfaceها) — یک Reverse Proxy واقعی با TLS جلوی
آن قرار دهید و `N8N_HOST`/`WEBHOOK_URL` در `.env` را با همان دامنه هماهنگ نگه دارید.

### 4. Import و پیکربندی Workflowها
دقیقاً طبق `SETUP.md` (ترتیب `03 → 01 → 02 → 04`)، سپس `CONFIGURATION.md` برای Variables/Credentials/Data
Table Filters.

### 5. تست قبل از Activate عمومی
Webhook هر Workflow را روی حالت Test اجرا کنید (n8n → «Listen for Test Event») و یک درخواست نمونه از
`tests/fixtures/valid-event.json` بفرستید تا مطمئن شوید زنجیره کامل (تا ثبت در Data Table) بدون خطا اجرا
می‌شود، قبل از این‌که WordPress واقعی را به آن وصل کنید.

### 6. Activate
هر ۴ Workflow را Active کنید (ترتیب مهم نیست در این مرحله، چون Error Workflow از قبل در Settings تنظیم شده).

### 7. اتصال WordPress
در WordPress، یک Hook (`publish_post`/`post_updated` یا پلاگین Webhook) بسازید که به:
```text
POST https://<n8n-host>/webhook/wp-post-events-v1
Header: X-WP-Webhook-Secret: <همان مقدار WORDPRESS_WEBHOOK_SECRET>
Body: {"eventType":"post.published","postId": <ID پست>}
```
ارسال کند. WordPress نباید محتوای کامل پست را در همین درخواست بفرستد — Workflow 01 خودش محتوای کامل را از
REST API واکشی می‌کند (طراحی سبک Payload، `README.md` بخش ۰).

### 8. مانیتورینگ مستمر
- `GET /webhook/wp-publication-dashboard` با Header `X-Dashboard-Api-Secret` را به یک Dashboard/Alert خارجی
  (Grafana/Uptime tool) وصل کنید.
- `ADMIN_ALERT_ENDPOINT`/`ADMIN_ALERT_CHAT_ID` را برای هشدارهای Real-time (شکست نهایی Job، خطای فنی) تنظیم
  کنید — این مسیر مستقل از Dashboard است و فوری اعلام می‌کند.

### 9. Backup
- Volume `postgres_data` منبع حقیقت همه Workflow/Credential/Data Table است — Backup روزانه الزامی.
- Volume `n8n_data` شامل تنظیمات محلی n8n است؛ در Queue Mode معمولاً کمتر بحرانی است ولی همچنان Backup شود.

### 10. Scale کردن Workerها
```yaml
n8n-worker-3:
  <<: *n8n-common
  command: worker --concurrency=10
```
هر Worker جدید را به همین شکل به `docker-compose.yml` اضافه کنید؛ چون Fix #10 قفل را Optimistic (نه صفی)
پیاده کرده، افزودن Worker باعث Race بیشتر نمی‌شود — فقط رقابت روی همان مکانیزم Lock افزایش می‌یابد که
Idempotent است.
