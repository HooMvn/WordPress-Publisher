# test-valid.ps1
# یک Event معتبر post.published به Workflow 01 ارسال می‌کند و انتظار 202/Accepted دارد.
#
# قبل از اجرا این متغیرهای محیطی را تنظیم کنید (یا مقادیر Placeholder را جایگزین کنید):
#   $env:N8N_BASE_URL              مثلا "https://n8n.example.com"
#   $env:WORDPRESS_WEBHOOK_SECRET   همان مقدار WORDPRESS_WEBHOOK_SECRET در .env شما
#
# هرگز Secret واقعی را داخل این فایل Hardcode نکنید.

$ErrorActionPreference = "Stop"

$baseUrl = $env:N8N_BASE_URL
$secret  = $env:WORDPRESS_WEBHOOK_SECRET

if (-not $baseUrl) { throw "لطفا $env:N8N_BASE_URL را تنظیم کنید (مثلا https://n8n.example.com)" }
if (-not $secret)  { throw "لطفا `$env:WORDPRESS_WEBHOOK_SECRET را تنظیم کنید" }

$uri = "$baseUrl/webhook/wp-post-events-v1"
$headers = @{
    "X-WP-Webhook-Secret" = $secret
    "Content-Type"        = "application/json"
}
$body = @{
    eventType = "post.published"
    postId    = 555
} | ConvertTo-Json

Write-Host "POST $uri"
$response = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body -SkipHttpErrorCheck
Write-Host ($response | ConvertTo-Json -Depth 10)

if ($response.ok -ne $true) {
    Write-Error "انتظار ok=true بود اما دریافت نشد."
    exit 1
}
Write-Host "PASS: Event پذیرفته شد. eventId=$($response.eventId) jobsCreated=$($response.jobsCreated)"
