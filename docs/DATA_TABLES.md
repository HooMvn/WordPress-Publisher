# Data Table Requirements — WordPress → Multi-Platform Publisher

طبق درخواست، این جدول‌ها هنوز در n8n ساخته نشده‌اند. این سند فقط Schema دقیق موردنیاز Workflowها را مشخص می‌کند تا در مرحله بعد ساخته شوند.

---

## `wordpress-publisher_events`

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

## `wordpress-publisher_publish_queue`

هدف: صف انتشار، وضعیت هر پلتفرم، Retry.

| ستون | نوع | توضیح |
|---|---|---|
| `job_id` | Text (**Unique**) | `{postId}:{platform}:{publicationVersion}` |
| `event_id` | Text | ارجاع به `wordpress-publisher_events.event_id` |
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

## `wordpress-publisher_errors`

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
