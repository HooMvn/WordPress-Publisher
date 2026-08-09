# test-duplicate.ps1
# همان Event را دو بار پشت‌سرهم می‌فرستد. دومی باید duplicate:true برگرداند و Job جدید نسازد.
#
# نیازمند: $env:N8N_BASE_URL, $env:WORDPRESS_WEBHOOK_SECRET

$ErrorActionPreference = "Stop"
$baseUrl = $env:N8N_BASE_URL
$secret  = $env:WORDPRESS_WEBHOOK_SECRET
if (-not $baseUrl) { throw "لطفا `$env:N8N_BASE_URL را تنظیم کنید" }
if (-not $secret)  { throw "لطفا `$env:WORDPRESS_WEBHOOK_SECRET را تنظیم کنید" }

$uri = "$baseUrl/webhook/wp-post-events-v1"
$headers = @{ "X-WP-Webhook-Secret" = $secret; "Content-Type" = "application/json" }
$body = @{ eventType = "post.published"; postId = 646 } | ConvertTo-Json

Write-Host "درخواست اول..."
$first = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body -SkipHttpErrorCheck
Write-Host ($first | ConvertTo-Json -Depth 10)

Start-Sleep -Seconds 1

Write-Host "درخواست دوم (تکراری)..."
$second = Invoke-RestMethod -Uri $uri -Method Post -Headers $headers -Body $body -SkipHttpErrorCheck
Write-Host ($second | ConvertTo-Json -Depth 10)

if ($second.duplicate -ne $true) {
    Write-Error "انتظار duplicate=true در پاسخ دوم بود."
    exit 1
}
Write-Host "PASS: درخواست دوم به‌درستی Duplicate تشخیص داده شد."

# --- تست هم‌زمانی (Fix #10 / T20): دو درخواست تقریبا هم‌زمان با یک postId جدید ---
$body2 = @{ eventType = "post.published"; postId = 647 } | ConvertTo-Json
$job1 = Start-Job -ScriptBlock {
    param($u,$h,$b)
    Invoke-RestMethod -Uri $u -Method Post -Headers $h -Body $b -SkipHttpErrorCheck
} -ArgumentList $uri, $headers, $body2
$job2 = Start-Job -ScriptBlock {
    param($u,$h,$b)
    Invoke-RestMethod -Uri $u -Method Post -Headers $h -Body $b -SkipHttpErrorCheck
} -ArgumentList $uri, $headers, $body2

$r1 = Receive-Job -Job $job1 -Wait
$r2 = Receive-Job -Job $job2 -Wait
Remove-Job $job1, $job2

$acceptedCount = @($r1, $r2) | Where-Object { $_.ok -eq $true -and $_.duplicate -ne $true } | Measure-Object | Select-Object -ExpandProperty Count
Write-Host "درخواست‌های هم‌زمان که واقعا Accepted شدند (نه Duplicate): $acceptedCount"
if ($acceptedCount -gt 1) {
    Write-Warning "بیش از یک درخواست هم‌زمان Accepted شد -> احتمال Race Condition (Fix #10 را طبق FINAL-AUDIT.md بررسی کنید؛ این مورد BLOCKED روی محیط واقعی است)."
} else {
    Write-Host "PASS: فقط یک درخواست هم‌زمان واقعا Accepted شد."
}
