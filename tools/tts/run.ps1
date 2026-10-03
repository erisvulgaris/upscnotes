# Runs the Edge TTS audiobook build across N parallel worker processes.
# Resumable: synth.py skips any chapter that already has both .opus and .json.
#
#   powershell -File tools\tts\run.ps1 -Workers 6
#   powershell -File tools\tts\run.ps1 -Workers 6 -Slug modern-indian-history

param(
  [int]$Workers = 6,
  [string]$Voice = "male",
  [string]$Rate = "-5%",
  [string]$Slug = "",
  [int]$MaxMinutes = 0
)

$ErrorActionPreference = "Continue"
Set-Location (Join-Path $PSScriptRoot "..\..")

if (-not (Test-Path "audio\audio-source.json")) {
  Write-Host "extracting chapter text..."
  node tools\tts\extract.mjs
}

$audioDir = Join-Path (Get-Location) "audio"
$logDir = Join-Path $audioDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$started = Get-Date
Write-Host "=== Edge TTS build: $Workers workers, voice=$Voice rate=$Rate ==="
Write-Host "started $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

$procs = @()
for ($i = 0; $i -lt $Workers; $i++) {
  $log = Join-Path $logDir ("worker-{0}.log" -f $i)
  $err = Join-Path $logDir ("worker-{0}.err" -f $i)
  $argList = @("tools\tts\synth.py", "--worker-index", $i, "--workers", $Workers,
               "--voice", $Voice, "--rate", $Rate)
  if ($Slug) { $argList += @("--slug", $Slug) }
  $p = Start-Process -FilePath "python" -ArgumentList $argList `
        -RedirectStandardOutput $log -RedirectStandardError $err `
        -NoNewWindow -PassThru
  $procs += $p
  Write-Host ("  worker {0} pid={1} -> {2}" -f $i, $p.Id, (Split-Path $log -Leaf))
}

while ($true) {
  $running = @($procs | Where-Object { -not $_.HasExited })
  $done = @(Get-ChildItem -Recurse -Filter "*.opus" -Path $audioDir -ErrorAction SilentlyContinue)
  $totalBytes = ($done | Measure-Object -Property Length -Sum).Sum
  if ($null -eq $totalBytes) { $totalBytes = 0 }
  $mins = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)
  Write-Host ("[{0,6} min] chapters done: {1,4}   audio: {2,7:N0} MB   workers alive: {3}" -f `
      $mins, $done.Count, ($totalBytes / 1MB), $running.Count)

  if ($running.Count -eq 0) { break }
  if ($MaxMinutes -gt 0 -and $mins -ge $MaxMinutes) {
    Write-Host "time budget reached ($MaxMinutes min) - stopping workers"
    $running | ForEach-Object { try { $_.Kill() } catch {} }
    break
  }
  Start-Sleep -Seconds 60
}

$done = @(Get-ChildItem -Recurse -Filter "*.opus" -Path $audioDir -ErrorAction SilentlyContinue)
$totalBytes = ($done | Measure-Object -Property Length -Sum).Sum
if ($null -eq $totalBytes) { $totalBytes = 0 }
Write-Host ""
Write-Host "=== finished in $([math]::Round(((Get-Date) - $started).TotalMinutes, 1)) min ==="
Write-Host ("chapters: {0}   audio: {1:N0} MB" -f $done.Count, ($totalBytes / 1MB))
Write-Host "logs in $logDir"