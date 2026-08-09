# test-invalid-secret.ps1
# با یک Secret اشتباه درخواست می‌فرستد و انتظار HTTP 401 (نه 422) دارد — تایید Fix #15.
#
# نیازمند: $env:N8N_BASE_URL

$ErrorActionPreference = "Stop"
$baseUrl = $env:N8N_BASE_URL
if (-not $baseUrl) { throw "لطفا `$env:N8N_BASE_URL را تنظیم کنید" }

$uri = "$baseUrl/webhook/wp-post-events-v1"
$headers = @{
    "X-WP-Webhook-Secret" = "definitely-the-wrong-secret"
    "Content-Type"        = "application/json"
}
$body = @{ eventType = "post.published"; postId = 555 } | ConvertTo-Json

$response = Invoke-WebRequest -Uri $uri -Method Post -Headers $headers -Body $body -SkipHttpErrorCheck
Write-Host "HTTP Status: $($response.StatusCode)"
Write-Host $response.Content

if ($response.StatusCode -ne 401) {
    Write-Error "انتظار 401 بود، دریافت شد: $($response.StatusCode)"
    exit 1
}
Write-Host "PASS: Secret نامعتبر به‌درستی 401 برگرداند."

# --- تست تکمیلی: Secret خالی هم باید 401 بدهد ---
$headersEmpty = @{ "Content-Type" = "application/json" }
$responseEmpty = Invoke-WebRequest -Uri $uri -Method Post -Headers $headersEmpty -Body $body -SkipHttpErrorCheck
if ($responseEmpty.StatusCode -ne 401) {
    Write-Error "انتظار 401 برای Secret خالی بود، دریافت شد: $($responseEmpty.StatusCode)"
    exit 1
}
Write-Host "PASS: Header Secret گمشده هم به‌درستی 401 برگرداند."

# --- تست تکمیلی Fix #15: Secret درست + payload نامعتبر باید 422 بدهد، نه 401 ---
$secret = $env:WORDPRESS_WEBHOOK_SECRET
if ($secret) {
    $headersValidAuth = @{ "X-WP-Webhook-Secret" = $secret; "Content-Type" = "application/json" }
    $badPayload = @{ eventType = "post.deleted"; postId = 555 } | ConvertTo-Json
    $responsePayload = Invoke-WebRequest -Uri $uri -Method Post -Headers $headersValidAuth -Body $badPayload -SkipHttpErrorCheck
    if ($responsePayload.StatusCode -ne 422) {
        Write-Error "انتظار 422 برای Payload نامعتبر با Secret درست بود، دریافت شد: $($responsePayload.StatusCode)"
        exit 1
    }
    Write-Host "PASS: Payload نامعتبر با Secret درست به‌درستی 422 برگرداند (نه 401)."
} else {
    Write-Host "SKIP: `$env:WORDPRESS_WEBHOOK_SECRET تنظیم نشده، تست 422 رد شد."
}
