# test-multi-channel.ps1
# بررسی می‌کند که تعداد Jobهای ساخته‌شده دقیقا برابر تعداد پلتفرم‌های ACTIVE_PLATFORMS باشد (Fix #3).
#
# نیازمند: $env:N8N_BASE_URL, $env:WORDPRESS_WEBHOOK_SECRET
# نکته: مقدار EXPECTED_PLATFORM_COUNT را با تعداد واقعی مقادیر ACTIVE_PLATFORMS در n8n Variables خودتان یکی کنید.

$ErrorActionPreference = "Stop"
$baseUrl = $env:N8N_BASE_URL
$secret  = $env:WORDPRESS_WEBHOOK_SECRET
$expectedCount = if ($env:EXPECTED_PLATFORM_COUNT) { [int]$env:EXPECTED_PLATFORM_COUNT } else { 6 }

if (-not $baseUrl) { throw "لطفا `$env:N8N_BASE_URL را تنظیم کنید" }
if (-not $secret)  { throw "لطفا `$env:WORDPRESS_WEBHOOK_SECRET را تنظیم کنید" }

$uri = "$baseUrl/webhook/wp-post-events-v1"
$headers = @{ "X-WP-Webhook-Secret" = $secret; "Content-Type" = "application/json" }
$body = @{ eventType = "post.published"; postId = 777 } | ConvertTo-Json

$response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body -SkipHttpErrorCheck
Write-Host ($response | ConvertTo-Json -Depth 10)

if ($response.jobsCreated -ne $expectedCount) {
    Write-Error "انتظار jobsCreated=$expectedCount بود، دریافت شد: $($response.jobsCreated)"
    exit 1
}
Write-Host "PASS: دقیقا $expectedCount Job برای $expectedCount پلتفرم فعال ساخته شد (نه بیشتر/کمتر، Fix #3)."
