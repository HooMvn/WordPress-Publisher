# Tests — WordPress → Multi-Platform Publisher

این پوشه دو لایه تست دارد:

## 1. لایه منطقی (اجرا شد، واقعی) — `run_tests.js`

```bash
cd tests
node run_tests.js
```

این اسکریپت دقیقاً همان `jsCode` را که داخل هر Code Node فایل‌های نهایی `../workflows/*.json` قرار دارد استخراج
می‌کند و با Node.js واقعی، روی ورودی‌های Mock واقعاً اجرا می‌کند. همچنین Configuration خام Nodeهای غیر-Code
(HTTP Request، If، Switch، Data Table) را مستقیماً از JSON می‌خواند و بررسی می‌کند (مثلاً `fullResponse: true`،
یا وجود `filters` روی Data Table). نتیجه در `results.json` ذخیره می‌شود.

آخرین اجرا: **۱۰۰/۱۰۰ چک منطقی PASS**.

این لایه **نمی‌تواند** موارد زیر را تست کند (چون به یک n8n واقعی نیاز دارند):
- ارزیابی واقعی Expression های `={{ ... }}` روی Nodeهای If/Switch/HTTP Request/Data Table توسط Engine خود n8n.
- رفتار واقعی Data Table (Unique Constraint، فیلترهای `filters.conditions`، `update` با شرط).
- فراخوانی واقعی API شش پلتفرم.
- رفتار هم‌زمانی واقعی (چند Execution موازی).

این موارد در `../FINAL-AUDIT.md` با وضعیت `BLOCKED` یا `STATICALLY VERIFIED` علامت‌گذاری شده‌اند، **نه** `PASS`.

## 2. لایه HTTP/PowerShell — `powershell/*.ps1`

برای تست علیه یک n8n واقعی (بعد از Import + Activate)، طبق `../SETUP.md`. این اسکریپت‌ها Secret واقعی
را Hardcode نمی‌کنند؛ از Environment Variable می‌خوانند:

```powershell
$env:N8N_BASE_URL = "https://n8n.example.com"
$env:WORDPRESS_WEBHOOK_SECRET = "<مقدار واقعی شما>"
$env:DASHBOARD_API_SECRET = "<مقدار واقعی شما>"

./powershell/test-valid.ps1
./powershell/test-invalid-secret.ps1
./powershell/test-duplicate.ps1
./powershell/test-multi-channel.ps1
./powershell/test-e2e.ps1
```

اجرای این اسکریپت‌ها در محیط توسعه فعلی (بدون n8n واقعی نصب‌شده) انجام **نشده** — طبق `../FINAL-AUDIT.md` وضعیت
`BLOCKED` است تا زمانی‌که یک نمونه n8n واقعی در دسترس باشد.

## 3. Fixtures — `fixtures/*.json`

نمونه Payload/سناریو برای هر مسیر اصلی (Event معتبر، تکراری، Secret نامعتبر، Payload نامعتبر، پلتفرم ناشناخته،
چندکاناله، محتوای فارسی، اجرای زمان‌بندی‌شده). این فایل‌ها هم به‌عنوان مستندسازی رفتار مورد انتظار و هم به‌عنوان
ورودی دستی برای Postman/curl/PowerShell قابل استفاده‌اند.

## نگاشت به Test Matrix

جدول کامل T01–T35 و این‌که هرکدام کجا پوشش داده شده در `../FINAL-AUDIT.md` آمده است.
