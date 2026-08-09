# test-e2e.ps1
# سناریوی End-to-End: ارسال Event معتبر -> بررسی Dashboard (با/بدون Secret) -> بررسی وجود Job در Queue.
#
# نیازمند:
#   $env:N8N_BASE_URL
#   $env:WORDPRESS_WEBHOOK_SECRET
#   $env:DASHBOARD_API_SECRET
#
# این اسکریپت جایگزین بازرسی دستی Execution/Data Table در n8n UI نیست؛ فقط رفتار بیرونی HTTP را چک می‌کند.

$ErrorActionPreference = "Stop"
$baseUrl   = $env:N8N_BASE_URL
$wpSecret  = $env:WORDPRESS_WEBHOOK_SECRET
$dashSecret = $env:DASHBOARD_API_SECRET

foreach ($v in @(@{n='N8N_BASE_URL';val=$baseUrl}, @{n='WORDPRESS_WEBHOOK_SECRET';val=$wpSecret}, @{n='DASHBOARD_API_SECRET';val=$dashSecret})) {
    if (-not $v.val) { throw "لطفا `$env:$($v.n) را تنظیم کنید" }
}

Write-Host "== مرحله ۱: ارسال Event معتبر ==" -ForegroundColor Cyan
$ingestUri = "$baseUrl/webhook/wp-post-events-v1"
$ingestHeaders = @{ "X-WP-Webhook-Secret" = $wpSecret; "Content-Type" = "application/json" }
$ingestBody = @{ eventType = "post.published"; postId = 909 } | ConvertTo-Json
$ingestResp = Invoke-RestMethod -Uri $ingestUri -Method Post -Headers $ingestHeaders -Body $ingestBody -SkipHttpErrorCheck
Write-Host ($ingestResp | ConvertTo-Json -Depth 10)
if ($ingestResp.ok -ne $true) { Write-Error "مرحله ۱ شکست خورد"; exit 1 }
Write-Host "PASS: Event پذیرفته شد (eventId=$($ingestResp.eventId))."

Write-Host "`n== مرحله ۲: Dashboard بدون Secret باید 401 بدهد (Fix #4) ==" -ForegroundColor Cyan
$dashUri = "$baseUrl/webhook/wp-publication-dashboard"
$noAuthResp = Invoke-WebRequest -Uri $dashUri -Method Get -SkipHttpErrorCheck
if ($noAuthResp.StatusCode -ne 401) { Write-Error "انتظار 401 بود، دریافت شد: $($noAuthResp.StatusCode)"; exit 1 }
Write-Host "PASS: Dashboard بدون Secret به‌درستی 401 داد."

Write-Host "`n== مرحله ۳: Dashboard با Secret درست باید 200 بدهد و KPI برگرداند ==" -ForegroundColor Cyan
$dashHeaders = @{ "x-dashboard-api-secret" = $dashSecret }
$dashResp = Invoke-RestMethod -Uri $dashUri -Method Get -Headers $dashHeaders -SkipHttpErrorCheck
Write-Host ($dashResp.summary | ConvertTo-Json -Depth 5)
if (-not $dashResp.summary) { Write-Error "خروجی Dashboard شکل مورد انتظار را ندارد"; exit 1 }
Write-Host "PASS: Dashboard KPI با Secret معتبر برگردانده شد. totalJobs=$($dashResp.summary.totalJobs)"

Write-Host "`n== مرحله ۴: منتظر ماندن برای اجرای بعدی Worker (حداکثر ۹۰ ثانیه) و بررسی مجدد Dashboard ==" -ForegroundColor Cyan
Start-Sleep -Seconds 90
$dashResp2 = Invoke-RestMethod -Uri $dashUri -Method Get -Headers $dashHeaders -SkipHttpErrorCheck
Write-Host ($dashResp2.summary | ConvertTo-Json -Depth 5)
Write-Host "توجه: PASS نهایی این مرحله باید دستی تایید شود (وضعیت واقعی sent/failed به Credential های واقعی پلتفرم‌ها بستگی دارد)."
