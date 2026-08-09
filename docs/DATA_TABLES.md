# Data Table Requirements — WordPress → Multi-Platform Publisher

طبق درخواست، این جدول‌ها هنوز در n8n ساخته نشده‌اند. این سند فقط Schema دقیق موردنیاز Workflowها را مشخص می‌کند تا در مرحله بعد ساخته شوند.

---

## `omid90_events`

هدف: ثبت هر Event WordPress و Deduplication در سطح مقاله.

| ستون | نوع | توضیح |
|---|---|---|
| `event_id` | Text (**Unique**) | `wp:{postId}:{modifiedAt}` |
| `event_type` | Text | `post.published` یا `post.updated` |
| `entity_id` | Text | `postId` به‌صورت رشته |
| `status` | Text | `accepted` / `completed` / `failed` |
| `priority` | Number | پیش‌فرض ۵۰ |
| `publication_version` | Text | همان `modifiedAt` — برای ردیابی نسخه |
| `received_at` | DateTime | زمان دریافت Webhook |
| `payload_json` | Text | مدل کامل Article نرمال‌شده (JSON) |
| `last_error` | Text | آخرین خطا در صورت وجود |
| `retry_count` | Number | پیش‌فرض ۰ |

قانون اجباری: `UNIQUE(event_id)` در سطح دیتابیس (نه فقط منطق Workflow) تا Race Condition در محیط چند Worker مدیریت شود.

---

## `omid90_publish_queue`

هدف: صف انتشار، وضعیت هر پلتفرم، Retry.

| ستون | نوع | توضیح |
|---|---|---|
| `job_id` | Text (**Unique**) | `{postId}:{platform}:{publicationVersion}` |
| `event_id` | Text | ارجاع به `omid90_events.event_id` |
| `event_type` | Text | |
| `platform` | Text | `telegram` / `bale` / `eitaa` / `rubika` / `x` / `linkedin` / آینده |
| `status` | Text | `pending` / `processing` / `retry_wait` / `sent` / `failed` / `skipped` |
| `priority` | Number | |
| `attempts` | Number | پیش‌فرض ۰ |
| `max_attempts` | Number | پیش‌فرض ۵ |
| `next_attempt_at` | DateTime | زمان مجاز تلاش بعدی |
| `article_json` | Text | مدل Article نرمال‌شده (JSON) — مصرف Formatterها |
| `created_at` | DateTime | |
| `started_at` | DateTime | زمان قفل‌شدن توسط Worker |
| `sent_at` | DateTime | زمان ارسال موفق |
| `worker_id` | Text | `$execution.id` |
| `provider_status_code` | Number | کد HTTP پاسخ Provider |
| `provider_response_json` | Text | پاسخ Provider (فقط برای خطا Redacted ذخیره شود) |
| `last_error` | Text | |

قانون اجباری: `UNIQUE(job_id)`.

---

## `omid90_errors`

هدف: خطاهای فنی Workflow (از `errorTrigger`) و شکست نهایی Jobها.

| ستون | نوع | توضیح |
|---|---|---|
| `error_id` | Text (**Unique**) | |
| `workflow_id` | Text | |
| `workflow_name` | Text | |
| `execution_id` | Text | |
| `node_name` | Text | |
| `error_message` | Text | |
| `stack` | Text | فقط برای خطاهای فنی Workflow 03؛ برای Job Failure خالی |
| `severity` | Text | `critical` / `high` / `medium` / `low` |
| `status` | Text | `open` / `resolved` |
| `occurred_at` | DateTime | |
| `resolved_at` | DateTime | Nullable |
| `job_id` | Text | Nullable — فقط برای خطاهای مرتبط با Job |
| `platform` | Text | Nullable — فقط برای خطاهای مرتبط با Job |

---

## نکات پیاده‌سازی

- روی `event_id` و `job_id` حتماً محدودیت Unique در سطح دیتابیس (نه فقط جست‌وجوی Read-before-write در Code Node) اعمال شود تا در اجرای هم‌زمان چند Worker، Race Condition رخ ندهد.
- `article_json` و `provider_response_json` می‌توانند حجیم باشند؛ Retention/Pruning دوره‌ای برای رکوردهای قدیمی `sent` توصیه می‌شود.
- هیچ ستونی نباید Token یا Secret خام ذخیره کند؛ `provider_response_json` باید قبل از ذخیره Redact شود (حذف فیلدهای `authorization`, `token`, `secret`, `cookie`).

---

## Fix #10 — وضعیت واقعی Race Condition (صادقانه، نه ادعایی)

`CODE_REVIEW.md` مورد #10 به‌درستی اشاره کرد که `read → check → insert` (Workflow 01) و
`read pending → lock` (Workflow 02) به‌خودی‌خود Atomic نیستند. این سند **ادعا نمی‌کند** که مشکل
۱۰۰٪ در سطح Data Table حل شده، چون:

1. این‌که n8n Data Table Node واقعاً از یک قید `UNIQUE` سطح دیتابیس با خطای قابل‌تشخیص در خروجی
   Node پشتیبانی می‌کند یا نه، **فقط با یک نمونه n8n واقعی قابل تایید است** (این محیط توسعه به
   n8n/Docker دسترسی ندارد). اگر پشتیبانی می‌کند، آن را روی هر دو ستون `event_id` (جدول
   `omid90_events`) و `job_id` (جدول `omid90_publish_queue`) تنظیم کنید.
2. مستقل از این‌که آن قید واقعاً در دسترس است یا نه، این پروژه دو لایه Mitigation در سطح Workflow
   اضافه کرده که بدون تکیه بر رفتار خاص Data Table کار می‌کنند:
   - **Workflow 01** — Node «ثبت Event در Data Store» با `onError: continueRegularOutput` اجرا
     می‌شود؛ Node بعدی «بررسی نتیجه ثبت Event (Race Detection)» خروجی را برای الگوهای متداول خطای
     Unique Violation (`error`, پیام حاوی `unique`/`duplicate`/`constraint`) بررسی می‌کند و در
     صورت تشخیص، رویداد را به‌جای ادامه پردازش، «تکراری» در نظر می‌گیرد (نه اینکه فرض کند Insert
     همیشه موفق بوده — باگ قبلی).
   - **Workflow 02** — Node «قفل Job و تغییر به processing» اکنون Update **شرطی** است
     (`job_id AND status='pending'`، نه فقط `job_id`)؛ Node «تایید Lock (Skip در صورت رقابت)»
     بعد از آن بررسی می‌کند آیا واقعاً همین Worker ردیف را قفل کرد یا خیر (Optimistic Locking).
     اگر Worker دیگری زودتر برنده شده باشد، این Worker بدون پردازش دوباره، مستقیم به Loop
     برمی‌گردد.
3. **این‌که آیا واقعاً هیچ Race باقی نمی‌ماند، وابسته به این است که آیا Update شرطی در Data Table
   n8n واقعاً Atomic اجرا می‌شود** (یعنی خود عملیات Update، نه صرفاً شرط Query آن، سطح تراکنشی
   دارد). این هم فقط با تست هم‌زمانی واقعی روی یک نمونه n8n قابل اثبات نهایی است —
   `tests/powershell/test-duplicate.ps1` برای همین منظور آماده شده.

**نتیجه صادقانه:** ریسک Race Condition به‌طور قابل‌توجهی کاهش یافت (از «هیچ محافظتی» به «Optimistic
Lock + تشخیص خطای Insert»)، اما بدون یک محیط n8n واقعی برای تست هم‌زمانی، نمی‌توان ادعای «۱۰۰٪
حذف شد» کرد. این مورد در `FINAL-AUDIT.md` به‌صراحت `BLOCKED` برای اثبات نهایی علامت خورده است.
