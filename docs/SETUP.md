# SETUP — راه‌اندازی از صفر

این سند مراحل ۱ تا ۱۵ خواسته‌شده در تسک را به ترتیب پوشش می‌دهد. هر مرحله `[ ]` است تا هنگام اجرای واقعی
تیک بزنید.

## 1. نصب Docker

```bash
# Linux
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# نصب Docker Compose plugin (اگر از قبل نیست)
sudo apt-get install docker-compose-plugin
```
روی Windows/Mac: Docker Desktop را نصب کنید (نسخه‌ای که Compose v2 دارد).

`[ ]` تایید: `docker --version` و `docker compose version` بدون خطا اجرا شوند.

## 2. تنظیم `.env`

```bash
cp .env.example .env
```
سپس مقادیر زیر را حتماً با مقدار واقعی جایگزین کنید (نه CHANGE_ME):
- `N8N_ENCRYPTION_KEY` — با `openssl rand -hex 32` بسازید.
- `POSTGRES_PASSWORD`, `REDIS_PASSWORD` — رمز قوی.
- `WORDPRESS_BASE_URL`, `WORDPRESS_WEBHOOK_SECRET` (حداقل ۳۲ کاراکتر تصادفی).
- `DASHBOARD_API_SECRET` (Fix #4) — **باید متفاوت از** `WORDPRESS_WEBHOOK_SECRET` باشد.
- `ACTIVE_PLATFORMS`, و متغیرهای مخصوص هر پلتفرمی که فعال می‌کنید.

`[ ]` تایید: فایل `.env` هیچ `CHANGE_ME` باقی‌مانده‌ای ندارد (`grep CHANGE_ME .env` خالی برمی‌گردد).

## 3. اجرای `docker compose`

```bash
docker compose up -d
docker compose ps   # همه سرویس‌ها باید healthy/running باشند
docker compose logs -f n8n-main   # تا زمان آماده شدن n8n صبر کنید
```

`[ ]` تایید: n8n روی `http://127.0.0.1:5678` بالا آمده (یا از پشت Reverse Proxy روی `N8N_HOST`).

## 4. Import چهار Workflow

ترتیب import: **03 → 01 → 02 → 04** (تا بتوانید 03 را به‌عنوان Error Workflow در تنظیمات سه‌تای دیگر انتخاب کنید).

در n8n UI: `Workflows → Import from File` → هرکدام از فایل‌های `workflows/0X-*.json` را جدا Import کنید.
بعد از Import همه غیرفعال (`active: false`) می‌مانند — این عمدی است.

`[ ]` تایید: هر ۴ Workflow بدون خطای Parse باز می‌شوند (تست ساختاری همین را در `tests/run_tests.js` هم چک کرده، اما تایید نهایی فقط با n8n واقعی ممکن است).

## 5. ساخت Data Tableها

طبق [`DATA_TABLES.md`](./DATA_TABLES.md) سه جدول را در n8n UI (`Data Tables` یا `Data Store`، بسته به نسخه) بسازید:
- `wordpress-publisher_events`
- `wordpress-publisher_publish_queue`
- `wordpress-publisher_errors`

ستون‌های دقیق و نوع هرکدام در همان فایل آمده.

`[ ]` تایید: هر سه جدول با نام دقیق بالا و همه ستون‌های مستندشده ساخته شدند.

## 6. تنظیم Data Table filters

بعد از Import، هر Node از نوع `n8n-nodes-base.dataTable` را باز کنید و مطمئن شوید `dataTableId` واقعاً به
جدول ساخته‌شده در مرحله ۵ اشاره می‌کند (فیلد `cachedResultName` فقط یک Label است؛ باید دوباره از لیست واقعی
انتخاب کنید تا `value` درست پر شود). فیلترها (`filters.conditions`) و `limit` از قبل در JSON نوشته شده‌اند
(Fix #11) — فقط باید تایید کنید UI آن‌ها را همان‌طور نمایش می‌دهد که در فایل هست.

`[ ]` تایید: در هر Node، فیلتر و Limit در UI با آنچه در JSON هست مطابقت دارد.

## 7. تنظیم Credentials

| Credential | نوع | مصرف‌کننده |
|---|---|---|
| WordPress API Token | Header Auth | Workflow 01 |
| Telegram account | Telegram API (رسمی) | Workflow 02 (Fix #9) |
| WP Bale Header Auth | Header Auth | Workflow 02 |
| WP Eitaa Header Auth | Header Auth | Workflow 02 |
| WP Rubika Header Auth | Header Auth | Workflow 02 |
| WP X OAuth2 | HTTP Bearer Auth | Workflow 02 |
| WP LinkedIn OAuth2 | HTTP Bearer Auth | Workflow 02 |
| WP Admin Alert Credential | Header Auth | Workflow 02 و 03 |

هر Node که `credentials.id: "SELECT_AFTER_IMPORT"` دارد را باز کرده و Credential واقعی را انتخاب کنید.

`[ ]` تایید: هیچ Node ای دیگر `SELECT_AFTER_IMPORT` نشان نمی‌دهد.

## 8. فعال‌سازی Error Workflow

در تنظیمات هر ۳ Workflow دیگر (01, 02, 04): `Settings → Error Workflow → WP 03 — Error Handler + Admin Alert`.

`[ ]` تایید: هر ۳ Workflow، Error Workflow‌شان روی 03 تنظیم شده.

## 9. فعال‌سازی Workflowهای اصلی

ترتیب Activate: 03 → 01 → 02 → 04 (Toggle بالای هر Workflow).

`[ ]` تایید: هر ۴ Workflow فعال (`active: true`) هستند.

## 10. اجرای تست‌ها (منطقی)

```bash
cd tests
node run_tests.js
```
انتظار: `100/100 logic checks passed`.

`[ ]` تایید: خروجی واقعاً 100/100 است (نه Mock ادعایی).

## 11. تست PowerShell

```powershell
$env:N8N_BASE_URL = "https://your-n8n-host"
$env:WORDPRESS_WEBHOOK_SECRET = "<مقدار واقعی>"
$env:DASHBOARD_API_SECRET = "<مقدار واقعی>"

cd tests/powershell
./test-valid.ps1
./test-invalid-secret.ps1
./test-duplicate.ps1
./test-multi-channel.ps1
./test-e2e.ps1
```

`[ ]` تایید: هر ۵ اسکریپت PASS چاپ می‌کنند.

## 12. مشاهده Execution

در n8n UI → `Executions`. برای هر Webhook یا Tick زمان‌بندی‌شده باید یک Execution با وضعیت Success/Error دیده شود.
چون `saveDataSuccessExecution=none` (Fix #12)، فقط Executionهای Error کامل ذخیره می‌شوند؛ Success فقط به‌صورت
خلاصه دیده می‌شود — این عمدی است، نه باگ.

## 13. بررسی Queue

جدول `omid90_publish_queue` را مستقیماً یا از طریق Dashboard API (`GET /webhook/wp-publication-dashboard` با
Header `X-Dashboard-Api-Secret`) بررسی کنید. `status` باید بین `pending → processing → sent/failed` حرکت کند.

## 14. بررسی Errors

جدول `omid90_errors` را بررسی کنید؛ باید هم خطاهای فنی (از Workflow 03) و هم Jobهای شکست‌خورده نهایی
(از Workflow 02) را شامل شود.

## 15. Troubleshooting

به [`TROUBLESHOOTING.md`](./TROUBLESHOOTING.md) مراجعه کنید.
