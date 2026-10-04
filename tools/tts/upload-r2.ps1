# Uploads the audiobook set to Cloudflare R2.
#
# Credentials come from .env, which is gitignored, and are passed to rclone as
# RCLONE_CONFIG_* environment variables rather than written into rclone's global
# config file — so nothing lands on disk outside .env.
#
#   powershell -File tools\tts\upload-r2.ps1
#   powershell -File tools\tts\upload-r2.ps1 -DryRun
#   powershell -File tools\tts\upload-r2.ps1 -Verify

param(
  [switch]$DryRun,
  [switch]$Verify,
  [int]$Transfers = 16
)

$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')

# --- load .env into this process only -------------------------------------
$envFile = Join-Path (Get-Location) '.env'
if (-not (Test-Path $envFile)) {
  Write-Error ".env not found. Add R2_ACCOUNT_ID, R2_BUCKET, R2_ENDPOINT, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY."
  exit 1
}
foreach ($line in Get-Content $envFile) {
  if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
  $name, $value = $line -split '=', 2
  $name = $name.Trim()
  $value = $value.Trim()
  if ([Environment]::GetEnvironmentVariable($name) -eq $null -or $name -like 'R2_*' -or $name -eq 'AUDIO_CDN_URL') {
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}

foreach ($need in @('R2_ACCOUNT_ID','R2_BUCKET','R2_ENDPOINT','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY')) {
  if (-not (Get-Item "env:$need" -EA SilentlyContinue) -or -not [Environment]::GetEnvironmentVariable($need)) {
    Write-Error "$need is missing from .env"
    exit 1
  }
}

$remote = "upscbooks:$($env:R2_BUCKET)"
$audio  = Join-Path (Get-Location) 'audio'

Write-Host "account : $env:R2_ACCOUNT_ID"
Write-Host "bucket  : $($env:R2_BUCKET)"
Write-Host "remote  : $remote"
Write-Host ""

# --- rclone config, entirely from the environment --------------------------
$env:RCLONE_CONFIG_UPSCBOOKS_TYPE = 's3'
$env:RCLONE_CONFIG_UPSCBOOKS_PROVIDER = 'Cloudflare'
$env:RCLONE_CONFIG_UPSCBOOKS_ACCESS_KEY_ID = $env:R2_ACCESS_KEY_ID
$env:RCLONE_CONFIG_UPSCBOOKS_SECRET_ACCESS_KEY = $env:R2_SECRET_ACCESS_KEY
$env:RCLONE_CONFIG_UPSCBOOKS_ENDPOINT = $env:R2_ENDPOINT
# R2 has no regions; the S3 signature requires the literal string "auto".
$env:RCLONE_CONFIG_UPSCBOOKS_REGION = 'auto'
$env:RCLONE_CONFIG_UPSCBOOKS_ACL = 'private'
# The R2 S3 endpoint answers lsd / ListObjectsV2, which rclone needs for sync.
$env:RCLONE_CONFIG_UPSCBOOKS_LIST_VERSION = '2'

if ($Verify) {
  Write-Host '--- connectivity ---'
  # A bucket-scoped token cannot call ListBuckets, so look inside the bucket.
  rclone lsd $remote --timeout 30s
  if ($LASTEXITCODE -ne 0) {
    Write-Host ''
    Write-Host 'Access denied. The credentials in .env cannot list this bucket.'
    Write-Host 'Check, in order:'
    Write-Host '  1. the R2 bucket exists in account ' $env:R2_ACCOUNT_ID
    Write-Host '  2. the API token has "Workers R2 Storage: Edit" (or the Admin Read token template)'
    Write-Host '  3. the S3 access key pair still exists for that account'
    Write-Host '  4. AUDIO_CDN_URL is only needed for reading, not for uploading'
    exit $LASTEXITCODE
  }
  Write-Host ''
  Write-Host 'objects and total size already in the bucket:'
  rclone size $remote
  exit $LASTEXITCODE
}

$started = Get-Date
Write-Host '--- what will be sent ---'
$opus = @(Get-ChildItem $audio -Recurse -File -Filter *.opus)
$side = @(Get-ChildItem $audio -Recurse -File -Filter *.json | Where-Object { $_.FullName -notmatch '\\logs\\' -and $_.Name -ne 'audio-source.json' -and $_.Name -ne 'content-qa-report.json' })
$bytes = ($opus | Measure-Object Length -Sum).Sum
Write-Host ("  {0} opus  ({1:N2} GB)" -f $opus.Count, ($bytes / 1GB))
Write-Host ("  {0} json sidecars and sync indexes" -f $side.Count)
Write-Host ("  total  {0} files" -f ($opus.Count + $side.Count))
Write-Host ''

if ($DryRun) {
  rclone lsjson "$remote" --max-depth 2 --files-only 2>&1 | Select-Object -First 5
  Write-Host 'dry run: nothing uploaded'
  exit 0
}

# --- the upload -----------------------------------------------------------
# Media is content-stable: a chapter's bytes never change once written, so the
# default S3 behaviour is fine. rclone 1.74 has no S3 cache-control flag for
# sync, so the object TTL is set at the bucket level or via a custom domain's
# headers rather than per upload.
rclone sync $audio $remote `
  --include '*.opus' `
  --include '*.json' `
  --exclude 'logs/**' `
  --exclude 'audio-source.json' `
  --exclude 'content-qa-report.json' `
  --transfers $Transfers `
  --checkers 32 `
  --s3-upload-cutoff 32M `
  --fast-list `
  --stats 30s `
  --stats-one-line `
  --log-level INFO

$code = $LASTEXITCODE
Write-Host ''
Write-Host "=== finished in $([math]::Round(((Get-Date) - $started).TotalMinutes, 1)) min (exit $code) ==="

if ($code -eq 0) {
  Write-Host ''
  Write-Host '--- remote summary ---'
  rclone size $remote
  Write-Host ''
  Write-Host 'Next: set AUDIO_CDN_URL in .env to the bucket'"'"'s public domain, then verify with:'
  Write-Host '  powershell -File tools\tts\upload-r2.ps1 -Verify'
  Write-Host '  node tools\check-audio.mjs'
}
exit $code