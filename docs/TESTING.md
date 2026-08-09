# TESTING.md

## 1. لایه‌های تست این پروژه

| لایه | ابزار | چه‌چیزی را واقعاً تست می‌کند | وضعیت |
|---|---|---|---|
| منطق Code Node | `tests/run_tests.js` (Node.js واقعی) | `jsCode` استخراج‌شده از JSON نهایی، اجرا‌شده روی ورودی Mock | **اجرا شد، واقعی** |
| Config استاتیک | همان فایل، بخش‌های `STATIC:` | پارامترهای غیر-Code (fullResponse، filters، credentials، responseCode) مستقیماً از JSON خوانده و بررسی می‌شوند | **اجرا شد، واقعی** (نه اجرای Runtime n8n) |
| HTTP End-to-End | `tests/powershell/*.ps1` | رفتار واقعی یک n8n در حال اجرا از طریق HTTP | **BLOCKED** — نیاز به n8n واقعی دارد (بخش ۳) |

## 2. اجرای لایه منطقی

```bash
cd tests
node run_tests.js
```

خروجی مورد انتظار:

```text
100/100 logic checks passed
```

نتیجه کامل (شامل expected/actual هر مورد) در `tests/results.json` نوشته می‌شود. اگر Exit Code غیرصفر بود
(هر چک FAIL شد)، خروجی CI باید Fail شود — `run_tests.js` دقیقاً همین رفتار را دارد
(`process.exitCode = 1` وقتی حداقل یک FAIL باشد).

### چرا این لایه کافی نیست (و چرا صادقانه‌ایم درباره‌اش)
`node run_tests.js` کد داخل Code Nodeها را با Node.js واقعی اجرا می‌کند — این تست جعلی/Mock صرف نیست، واقعاً
منطق (`if/else`, string manipulation, redaction, retry backoff, ...) را با Assertion واقعی بررسی می‌کند. اما
چیزهایی که **نمی‌تواند** تست کند:
- تفسیر Expression های `={{ ... }}` توسط Engine خود n8n (مثلاً آیا `$vars.X_API_BASE` واقعاً در زمان اجرا
  Resolve می‌شود).
- رفتار واقعی Node های غیر-Code (`httpRequest`, `if`, `switch`, `dataTable`, `respondToWebhook`,
  `splitInBatches`).
- Constraintهای دیتابیس واقعی (`UNIQUE`)، همزمانی واقعی، Retry واقعی شبکه.

به همین دلیل در `FINAL-AUDIT.md` هر مورد با یکی از این چهار وضعیت مشخص شده، **نه فقط PASS**:
`PASS` (منطق واقعاً اجرا و بررسی شد) / `STATICALLY VERIFIED` (Configuration خام JSON بررسی شد ولی Runtime
اجرا نشد) / `BLOCKED` (نیاز به n8n/Docker/Credential واقعی) / `FAIL`.

## 3. اجرای لایه HTTP End-to-End (نیازمند n8n واقعی)

پیش‌نیاز: `docker compose up -d`، Import هر ۴ Workflow، ساخت Data Tableها طبق `DATA_TABLES.md`، تنظیم
Credentials/Variables طبق `CONFIGURATION.md`، Activate هر ۴ Workflow.

```powershell
$env:N8N_BASE_URL = "https://your-n8n-host"
$env:WORDPRESS_WEBHOOK_SECRET = "<مقدار واقعی>"
$env:DASHBOARD_API_SECRET = "<مقدار واقعی>"

cd tests/powershell
./test-valid.ps1          # T01, T13
./test-invalid-secret.ps1 # T14, T29, T30
./test-duplicate.ps1      # T19, T20
./test-multi-channel.ps1  # T07, T08, T34
./test-e2e.ps1            # T35 کامل روی n8n واقعی
```

این اسکریپت‌ها در محیط توسعه فعلی (بدون n8n نصب‌شده و بدون دسترسی شبکه) اجرا **نشدند** — طبق قانون صریح Task
(«هرگز برای چیزی که فقط بررسی کد شده، PASS ننویس») این‌ها `BLOCKED` علامت خورده‌اند، نه PASS ادعایی.

## 4. Test Matrix — نگاشت کامل T01–T35

| ID | شرح | پوشش | وضعیت |
|---|---|---|---|
| T01–T04 | WordPress 200/404/401/500 | `run_tests.js` (بخش Fix #1) | PASS |
| T05 | Unknown platform | `run_tests.js` (بخش Fix #2) | PASS |
| T06 | Known platform success | `run_tests.js` | PASS |
| T07–T08 | Respond to Webhook با 1/2/6 Job | `run_tests.js` (بخش Fix #3) | PASS |
| T09–T11 | Dashboard secret درست/غلط/غایب | `run_tests.js` (بخش Fix #4) | PASS |
| T12 | Redaction بازگشتی | `run_tests.js` (بخش Fix #5) | PASS |
| T13–T16 | Webhook secret درست/غلط/خالی/Legacy Header | `run_tests.js` (بخش Fix #6/#7) | PASS |
| T17–T18 | Telegram publish / credential failure | `run_tests.js` (STATIC) + `test-e2e.ps1` | STATICALLY VERIFIED / BLOCKED |
| T19–T20 | Duplicate ترتیبی/هم‌زمان | `run_tests.js` (بخش Fix #10) | PASS (شبیه‌سازی) / BLOCKED (اثبات واقعی) |
| T21–T24 | فیلتر/Limit صف و Dashboard | `run_tests.js` (STATIC، بخش Fix #11) | STATICALLY VERIFIED |
| T25 | هماهنگی تنظیمات Execution Save | `run_tests.js` (بخش Fix #12) | PASS |
| T26 | X_API_BASE واقعاً استفاده می‌شود | `run_tests.js` (بخش Fix #13) | PASS |
| T27–T28 | شکست دائمی/موقتی | `run_tests.js` | PASS |
| T29–T30 | 422/401 | `run_tests.js` (بخش Fix #15) | PASS |
| T31–T33 | فارسی/ایموجی/خط جدید | `run_tests.js` | PASS |
| T34 | Multi-channel | `run_tests.js` | PASS |
| T35 | End-to-end (زنجیره Code Node) | `run_tests.js` (بخش T35) | PASS (شبیه‌سازی زنجیره‌ای) / BLOCKED (n8n واقعی، `test-e2e.ps1`) |

جزئیات کامل هر ردیف (فایل/Node/دلیل Status) در `FINAL-AUDIT.md`.

## 5. Regression

هر بار قبل از تحویل، `node run_tests.js` باید ۱۰۰٪ سبز باشد. اگر یک Fix آینده منطق یک Code Node را عوض کند،
تست مربوطه در همین فایل باید هم‌زمان به‌روزرسانی شود — تست‌ها به همان اسم دقیق Node (`getCode(wf, 'نام Node')`)
وابسته‌اند، پس تغییر نام یک Node بدون تغییر تست، باعث Throw فوری (`Node not found`) می‌شود، نه یک شکست خاموش.
