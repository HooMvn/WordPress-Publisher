# FINAL AUDIT — CODE_REVIEW.md #1 تا #15

مرور نهایی، دقیقاً به ترتیب شماره‌گذاری `CODE_REVIEW.md`. وضعیت‌ها فقط از این مجموعه انتخاب شده‌اند (طبق
دستور صریح Task):

```
PASS                — واقعاً تست شده (منطق JS با Node.js واقعی در tests/run_tests.js اجرا و Assert شد)
MOCK PASS           — فقط با ورودی شبیه‌سازی‌شده تست شد (بدون n8n واقعی)
STATICALLY VERIFIED — با بررسی مستقیم Configuration خام فایل JSON تأیید شده (نه اجرای Runtime n8n)
BLOCKED             — نیازمند n8n/Docker/Credential/Data Table واقعی که در این محیط توسعه در دسترس نبود
FAIL                — تست شکست خورده (هیچ مورد باقی‌مانده‌ای در این وضعیت نیست)
```

آخرین اجرای واقعی:
```
$ cd tests && node run_tests.js
100/100 logic checks passed
```
خروجی کامل (هر Assertion با expected/actual) در `tests/results.json`.

---

| # | Issue | File / Node | Fix | Test | Status |
|---|---|---|---|---|---|
| 1 | چک وضعیت WordPress همیشه True برمی‌گشت (نبود `fullResponse`) | `01-wordpress-event-ingest.json` → «واکشی Post کامل از WordPress API» + «واکشی موفق بود؟» | `fullResponse:true` اضافه شد؛ Node جدید «یکنواخت‌سازی پاسخ WordPress» خروجی خام n8n را به `{statusCode, body}` یکنواخت می‌کند؛ شرط IF از fallback `200` به `599` تغییر کرد (نبود statusCode = شکست، نه موفقیت پنهان) | `run_tests.js`: T01–T04، T04b (missing statusCode)، STATIC (fullResponse=true، عدم fallback به 200) | **PASS** (منطق) + **STATICALLY VERIFIED** (Config) / **BLOCKED**: رفتار دقیق شکل خروجی `fullResponse` در Runtime واقعی n8n فقط با Import و اجرای واقعی قابل تایید نهایی است |
| 2 | Unknown Platform به‌اشتباه «موفق» ثبت می‌شد | `02-queue-publisher.json` → «نرمال‌سازی نتیجه ارسال» | کد بازنویسی شد: اگر `resp.delivery` از قبل موجود باشد (مسیر «Platform ناشناخته»)، همان مقدار (فقط بعد از Redact) حفظ می‌شود، نه تحلیل مجدد از صفر روی `resp.statusCode`/`resp.body` که برای این مسیر اصلاً وجود ندارند | `run_tests.js`: T05 (Unknown platform → ok=false، permanent=true حفظ می‌شود — Regression guard مستقیم روی باگ قبلی)، T06 (known platform) | **PASS** |
| 3 | چند Item وارد Respond to Webhook می‌شد + `$json.length` نادرست (`undefined`) | `01-wordpress-event-ingest.json` → «ساخت Publication Job برای هر پلتفرم» → «پاسخ Accepted» | Node جدید «تجمیع نتیجه Jobها» با `$input.all().length` اضافه شد؛ همیشه دقیقاً ۱ Item خروجی می‌دهد؛ «پاسخ Accepted» اکنون از `$json.jobsCreated` (عدد واقعی) می‌خواند، نه `$json.length` | `run_tests.js`: T07 (۱ پلتفرم)، T08a/b (۲ و ۶ پلتفرم)، بررسی صریح طول خروجی=۱ در هر سه حالت | **PASS** (منطق تجمیع) / **BLOCKED**: تضمین این‌که `respondToWebhook` واقعی n8n با ورودی تک‌آیتمی بدون خطا اجرا می‌شود فقط با Runtime واقعی قابل تایید نهایی است (طراحی اکنون این ریسک را حذف می‌کند، اما اثبات Runtime باقی است) |
| 4 | Dashboard API کاملاً بدون Authentication | `04-publication-dashboard.json` | Nodeهای جدید «اعتبارسنجی Dashboard Secret» (Timing-Safe) + «معتبر است؟» قبل از هر سه خواندن Data Table اضافه شد؛ Header الزامی `X-Dashboard-Api-Secret`؛ متغیر مستقل `DASHBOARD_API_SECRET` (جدا از Webhook Secret WordPress) | `run_tests.js`: T09 (Secret درست)، T10 (غلط)، T11 (غایب)؛ STATIC (اتصال Auth Node قبل از خواندن‌ها، وجود Node پاسخ 401) | **PASS** (منطق Auth) / **BLOCKED**: کد HTTP واقعی 401/200 فقط با n8n در حال اجرا قابل مشاهده است؛ اسکریپت آماده در `tests/powershell/test-e2e.ps1` |
| 5 | `provider_response_json` بدون Redact ذخیره می‌شد | `02-queue-publisher.json` → «نرمال‌سازی نتیجه ارسال» | تابع `redact()` بازگشتی (حداکثر عمق ۸)، Case-insensitive، روی کلیدهای منطبق با `/authorization\|token\|secret\|cookie/i` قبل از قرارگیری در `delivery.response`؛ مقدار خام فقط موقتاً برای محاسبه `ok`/`permanent` استفاده و هرگز ذخیره نمی‌شود | `run_tests.js`: T12a–f (کلید top-level، nested، عمیق، داخل Array، فیلد امن دست‌نخورده، عدم خرابی محاسبه statusCode) | **PASS** |
| 6 | مقایسه Secret با `===` (بدون محافظت Timing Attack) | `01-wordpress-event-ingest.json` → «اعتبارسنجی Webhook»؛ همچنین `04` → «اعتبارسنجی Dashboard Secret» | `crypto.timingSafeEqual` با هندل صریح طول نابرابر (بدون Throw، بدون Early-exit قابل اندازه‌گیری)، Secret خالی/غایب همیشه `false`، Type غیر-String همیشه `false` | `run_tests.js`: T13 (درست)، T14 (غلط هم‌طول)، T15/T15c (خالی)، طول نابرابر، Type غیر-string — همه بدون Throw | **PASS** |
| 7 | Header قدیمی `x-omid90-webhook-secret` باقی‌مانده Omid90 | `01-wordpress-event-ingest.json` → «اعتبارسنجی Webhook» | حذف کامل خواندن این Header (فقط در یک کامنت توضیحی ذکر شده که چرا حذف شد)؛ تنها Header رسمی `X-WP-Webhook-Secret` باقی ماند؛ `.env.example`/`README.md`/`ENVIRONMENT.md` هماهنگ شدند | `run_tests.js`: T16 (ارسال فقط Header قدیمی → authorized=false) | **PASS** |
| 8 | `docker-compose` با تگ `:latest` | `docker-compose.yml` | Pin به `n8nio/n8n:1.94.1`؛ `postgres:16.4-alpine`؛ `redis:7.4-alpine`؛ دلیل انتخاب و سازگاری Node-typeهای استفاده‌شده در کامنت بالای فایل مستند شد | `run_tests.js`: STATIC (نبود `:latest`، وجود تگ عددی صریح) | **STATICALLY VERIFIED** / **BLOCKED**: Pull و اجرای واقعی این Image (بدون دسترسی شبکه/Docker در این محیط) تایید نشد — قبل از Production باید `docker compose up` واقعی اجرا شود (`DEPLOYMENT.md`) |
| 9 | `$credentials.telegramApi.accessToken` در URL دستی | `02-queue-publisher.json` → «Telegram Publisher» | جایگزین با Node رسمی `n8n-nodes-base.telegram` (resource=message, operation=sendMessage)؛ هیچ ارجاع مستقیم به `$credentials` در هیچ Expression این Workflow باقی نمانده | `run_tests.js`: STATIC (نوع Node = `n8n-nodes-base.telegram`، عدم وجود `$credentials` در پارامترهای هیچ Nodeای، وجود Credential مرجع) | **STATICALLY VERIFIED** (Config) / **BLOCKED**: ارسال واقعی پیام تلگرام نیازمند Bot Token واقعی است |
| 10 | Race Condition در Dedup (سطح Event) و Queue Lock (سطح Job) — TOCTOU | `01`: Insert Event → Node «بررسی نتیجه ثبت Event (Race Detection)» / `02`: «قفل Job و تغییر به processing» (اکنون شرطی: `job_id AND status=pending`) → «تایید Lock (Skip در صورت رقابت)» | Insert Event با `onError=continueRegularOutput` + تشخیص پیام خطای شبیه Unique Violation → مسیر Duplicate. Lock Job: Update شرطی + Node تایید که در صورت باخت رقابت (۰ ردیف Update شد)، Worker مستقیم Skip می‌کند بدون پردازش دوباره | `run_tests.js`: T19a/b (ترتیبی)، T20 (شبیه‌سازی TOCTOU — نشان می‌دهد چرا لایه Read به‌تنهایی کافی نیست)، T20b/c (تشخیص خطای Insert)، Lock verify won/lost | **PASS** (منطق Mitigation، دو لایه) / **BLOCKED صریح**: این کد فقط با `UNIQUE(event_id)`/`UNIQUE(job_id)` واقعی روی دیتابیس زیرین Data Table به یک تضمین واقعی تبدیل می‌شود (`CONFIGURATION.md` بخش ۴)؛ **این پروژه ادعا نمی‌کند** که فقط این JSON به‌تنهایی Race را ۱۰۰٪ حذف می‌کند — دقیقاً طبق دستور صریح Task از Overclaim خودداری شده |
| 11 | Nodeهای «get» روی Data Table بدون فیلتر/Limit واقعی (فقط در Note) | همه ۴ Workflow — تمام Nodeهای Data Table `get` | `filters.conditions` واقعی + `limit` عددی روی: جستجوی eventId (`limit=1`)، خواندن Jobهای Pending (`status=pending`, `limit=500`, فیلتر پویا `next_attempt_at<=now` در Code Node چون Data Table مقایسه با `now()` را مستند نمی‌کند)، هر سه Node Dashboard (فیلتر `>= now-30d`, `limit=2000`) | `run_tests.js`: T21 (event lookup)، T22/T22b (pending + next_attempt_at)، T23 (limit 50 در sort/limit code)، T24×3 (هر سه Node Dashboard) | **STATICALLY VERIFIED** (شکل `filters` بر پایه بهترین برداشت از مستندات عمومی Data Table Node نوشته شده) / **BLOCKED**: تایید دقیق شکل پارامتر `filters` فقط با UI واقعی n8n Data Table ممکن است (`CONFIGURATION.md` بخش ۳ توضیح می‌دهد چه‌کاری بعد از Import لازم است) |
| 12 | ناهم‌خوانی `EXECUTIONS_DATA_SAVE_ON_SUCCESS=none` (docker) در برابر `saveDataSuccessExecution=all` (هر ۴ Workflow) | `docker-compose.yml` + هر ۴ Workflow JSON | هر دو لایه روی «موفق=ذخیره نشود (`none`)، خطا=کامل ذخیره شود (`all`)» هماهنگ شدند؛ دلیل تصمیم (جلوگیری از رشد DB برای Workflow 02 که هر ۱ دقیقه اجرا می‌شود + حفظ داده کافی برای Debug خطا) در خود `docker-compose.yml` و `ARCHITECTURE.md` مستند شد | `run_tests.js`: T25a/b (docker-compose)، T25c/d ×۴ Workflow (۸ چک) | **PASS** |
| 13 | `X_API_BASE` در `.env` تعریف‌شده ولی استفاده نمی‌شد (URL Hardcode) | `02-queue-publisher.json` → «X Publisher» | URL اکنون از `($vars.X_API_BASE \|\| 'https://api.x.com').replace(...) + '/2/tweets'` ساخته می‌شود — دیگر Hardcode مطلق نیست؛ تغییر مقدار Variable واقعاً URL نهایی را عوض می‌کند | `run_tests.js`: STATIC (وجود ارجاع واقعی `$vars.X_API_BASE` در پارامتر url، نه فقط در کامنت) | **PASS** (Config verified) / **BLOCKED**: فراخوانی واقعی X API با این URL نیازمند Credential/Sandbox واقعی است |
| 14 | `temporaryCodes` تعریف‌شده ولی هرگز استفاده نمی‌شد | `02-queue-publisher.json` → «نرمال‌سازی نتیجه ارسال» | Option B انتخاب شد: `temporaryCodes` واقعاً در طبقه‌بندی استفاده می‌شود؛ یک فیلد صریح `delivery.classification` (`permanent`/`temporary`/`unknown`) اضافه شد؛ کد ناشناخته (مثلاً 418) به‌صورت ایمن `unknown` + `permanent=false` (پیش‌فرض Retry) طبقه‌بندی می‌شود، نه به‌اشتباه Permanent | `run_tests.js`: T27 (401→permanent)، T28/T28b (429/500→temporary)، تست کد ناشناخته 418→unknown+retry، STATIC (استفاده واقعی `temporaryCodes.has(...)` در کد) | **PASS** |
| 15 | Node «پاسخ 401/422» همیشه `responseCode:401` برمی‌گرداند، هیچ مسیر 422 واقعی نبود | `01-wordpress-event-ingest.json` → «اعتبارسنجی Webhook» + Node جدید Switch «طبقه‌بندی نتیجه اعتبارسنجی» | «اعتبارسنجی Webhook» اکنون `outcome` صریح (`ok`/`unauthorized`/`invalid_payload`) تولید می‌کند؛ یک Switch سه مسیر (ادامه پردازش / پاسخ 401 / پاسخ 422) را جدا می‌کند؛ Node مستقل «پاسخ 422 Payload نامعتبر» با `responseCode:422` اضافه شد؛ «پاسخ 401 غیرمجاز» فقط برای `unauthorized` صدا زده می‌شود | `run_tests.js`: T29/T29b (Auth درست + Payload نامعتبر → 422)، T30/T30b (Auth نادرست/غایب → 401)، STATIC (وجود هر دو Node پاسخ با کد صحیح) | **PASS** |

---

## موارد Minor (بخش 🟢 گزارش) — نیز بررسی و اصلاح شدند

- **`splitInBatches.batchSize`**: صریحاً `1` تنظیم شد در «Loop Over Jobs» (به‌جای اتکا به پیش‌فرض ضمنی نسخه).
  STATICALLY VERIFIED مستقیماً روی JSON.
- **Infinite Loop در Rate Limit/Loop**: بررسی شد — `splitInBatches` خودش شمارش Batch را مدیریت می‌کند و
  «Rate Limit Wait» همیشه دقیقاً یک مسیر بازگشت به Loop دارد؛ خطر Infinite Loop واقعی دیده نشد. اثبات کامل
  فقط با اجرای طولانی روی n8n واقعی ممکن است (BLOCKED).
- **Circuit Breaker per-platform**: عمداً اضافه **نشد**. دلیل فنی کامل در `ARCHITECTURE.md` بخش ۳ مستند شده
  (منطق فعلی Backoff نمایی + طبقه‌بندی صریح permanent/temporary همان مشکل اصلی را با پیچیدگی کمتر پوشش
  می‌دهد؛ افزودن Pause سراسری per-platform نیاز به جدول/هماهنگی جدید بین Workerها دارد که خارج از دامنه
  همین ۱۵ مورد است).
- **`stripHtml` پوشش محدود Entity**: بدون افزودن Dependency خارجی، پوشش گسترش داده نشد چون تست T31 نشان داد
  پوشش فعلی برای نمونه فارسی این پروژه کافی است؛ به‌عنوان محدودیت شناخته‌شده (نه باگ حل‌شده) در
  `TROUBLESHOOTING.md` مستند شد.

---

## خلاصه اجرای تست‌ها

```
$ cd tests && node run_tests.js
100/100 logic checks passed
```

خروجی کامل (هر مورد با expected/actual) در `tests/results.json`.

## فایل‌های تغییرکرده / جدید

```
workflows/01-wordpress-event-ingest.json   (بازنویسی — Fix #1,#3,#6,#7,#10,#11,#15)
workflows/02-queue-publisher.json          (بازنویسی — Fix #2,#5,#9,#10,#11,#13,#14,minor)
workflows/03-error-handler.json            (settings — Fix #12)
workflows/04-publication-dashboard.json    (بازنویسی — Fix #4,#11)
docker-compose.yml                          (بازنویسی — Fix #8,#12)
.env.example                                (به‌روزرسانی — Fix #4,#7,#13 + مستندسازی)
DATA_TABLES.md                              (به‌روزرسانی کامل — Fix #10,#11)
README.md, SETUP.md, CONFIGURATION.md, ARCHITECTURE.md, TESTING.md,
TROUBLESHOOTING.md, DEPLOYMENT.md, ENVIRONMENT.md, FINAL-AUDIT.md   (جدید/بازنویسی کامل)
tests/run_tests.js, tests/lib/harness.js, tests/README.md          (بازنویسی/جدید — ۱۰۰ چک)
tests/fixtures/*.json (۸ فایل)                                      (جدید)
tests/powershell/*.ps1 (۵ فایل)                                     (جدید)
```

## Blocked Items — دقیق و کامل

این‌ها فقط با یک محیط واقعی n8n + Docker + Credentialهای واقعی پلتفرم‌ها قابل تکمیل‌اند؛ در این محیط توسعه
(بدون دسترسی Network/Docker) ممکن نبودند و **هیچ‌کدام به‌اشتباه PASS علامت نخورده‌اند**:

1. Import واقعی هر ۴ Workflow در یک نمونه n8n و تایید این‌که Parser بدون خطا می‌پذیرد.
2. ساخت واقعی سه Data Table (`omid90_events`, `omid90_publish_queue`, `omid90_errors`) طبق `DATA_TABLES.md`
   و تایید این‌که پارامتر `filters` دقیقاً همین شکل را می‌پذیرد (ممکن است بین نسخه‌های n8n تفاوت داشته باشد).
3. تعریف واقعی `UNIQUE(event_id)`/`UNIQUE(job_id)` روی دیتابیس زیرین و تایید رفتار دقیق خطای Violation در
   خروجی Node (پیش‌نیاز قطعی برای این‌که Fix #10 یک تضمین واقعی باشد، نه فقط Mitigation).
4. فراخوانی واقعی API شش پلتفرم (Telegram/Bale/Eitaa/Rubika/X/LinkedIn) با Credential واقعی.
5. تست هم‌زمانی واقعی (دو Request موازی با `postId` یکسان) روی یک Instance واقعی n8n برای اثبات نهایی Fix
   #10 — اسکریپت آماده در `tests/powershell/test-duplicate.ps1`.
6. اجرای واقعی `docker compose up` با Image‌های Pin‌شده برای تایید نهایی سازگاری (Fix #8).
7. تایید کد HTTP واقعی 401 در برابر 422 (Fix #15) و 401 Dashboard (Fix #4) از طریق یک n8n در حال اجرا —
   اسکریپت‌های آماده: `tests/powershell/test-invalid-secret.ps1`, `tests/powershell/test-e2e.ps1`.

## نتیجه‌گیری

هر ۱۵ مورد `CODE_REVIEW.md` واقعاً در فایل‌های پروژه اصلاح شدند — نه فقط توضیح داده شدند. لایه منطقی با
`node tests/run_tests.js` واقعاً اجرا شد و **۱۰۰/۱۰۰ چک** (شامل هم تست منطق و هم بررسی مستقیم Configuration
خام JSON) سبز شد. بخش‌هایی که ذاتاً به یک n8n/Docker/Credential واقعی وابسته‌اند به‌صراحت `BLOCKED` علامت
خورده‌اند و اسکریپت PowerShell آماده برای تکمیل آن‌ها در `tests/powershell/` تحویل داده شده است.

**READY مشروط:** پروژه از نظر Code/Logic برای Import آماده است. قبل از استفاده در Production باید موارد
BLOCKED بالا (به‌خصوص #2, #3, #6 در همین بخش) با یک نمونه n8n واقعی طی شوند — چک‌لیست کامل قدم‌به‌قدم در
`SETUP.md` و `DEPLOYMENT.md` موجود است.
