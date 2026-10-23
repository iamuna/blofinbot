# Swarm runner for Windows (started hidden at logon by the "Swarm" task that install.ps1 registers).
#
# Runs every agent in one Node process on the in-memory bus, except the brain (the strategy plugins, code the Claude
# agents write): it runs in its own locked-down Node process without the tokens (--isolate brain, src/core/isolate.js).
# Restarts the swarm within a minute if it stops, and every
# 10 minutes looks for new code on the swarm branch (every step logged; git fetch and the tests have time limits, so
# a hang can no longer stop the runner — on 2026-10-20 it went silent for 10 hours before this). New code is installed the same way as on Linux:
#   1. the update gate - run from the code ALREADY installed - lets only self-service changes through on their own
#      (strategy plugins that pass the plugin check, shadow-mode settings, candidates, docs); anything else,
#      tests included, waits for approve.ps1;
#   2. every offline test passes in a scratch checkout, with the tokens and keys taken out of their environment;
#   3. if the new code then crashes within 3 minutes, the previous version is restored.
# An update that changes this script restarts the runner itself (with the rollback still armed).
# Ibrahim hears about each outcome on Telegram. Logs: C:\swarm\logs (kept 14 days).
# SWARM_RUN_MINUTES (tests): stop after that many minutes.
param([string]$RollbackTo = '')

$ErrorActionPreference = 'Continue'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$App = Join-Path $Root 'app'; $Data = Join-Path $Root 'data'; $Logs = Join-Path $Root 'logs'; $Approved = Join-Path $Root 'approved'
$Branch = if ($env:SWARM_BRANCH) { $env:SWARM_BRANCH } else { 'swarm' }
$Agents = 'universe,blofin-feed,binance-feed,guard,recorder,events,brain,coordinator,trader,accountant,watchdog,guardian,herald,state-sync'
New-Item -ItemType Directory -Force -Path $Data, $Logs, $Approved | Out-Null

function Write-Log($t) { Add-Content -Path (Join-Path $Logs 'runner.log') -Value ("{0:u} {1}" -f (Get-Date).ToUniversalTime(), $t) }
# secrets and settings for the node process (inherited environment)
# (their names are kept in $SecretVars: the update tests run without them)
$SecretVars = @('GITHUB_TOKEN', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'BLOFIN_API_KEY', 'BLOFIN_API_SECRET', 'BLOFIN_PASSPHRASE', 'SWARM_BUS_KEY_FILE')
if (Test-Path (Join-Path $Root 'secrets.json')) {
  $s = Get-Content (Join-Path $Root 'secrets.json') -Raw | ConvertFrom-Json
  foreach ($p in $s.PSObject.Properties) { if ($p.Value) { Set-Item -Path "env:$($p.Name)" -Value ([string]$p.Value); $SecretVars += $p.Name } }
}
foreach ($k in @('BLOFIN_API_KEY', 'BLOFIN_API_SECRET', 'BLOFIN_PASSPHRASE')) { Remove-Item "env:$k" -ErrorAction SilentlyContinue }
if (Test-Path (Join-Path $Root 'blofin-demo.json')) {
  $d = Get-Content (Join-Path $Root 'blofin-demo.json') -Raw | ConvertFrom-Json
  foreach ($p in $d.PSObject.Properties) { Set-Item -Path "env:$($p.Name)" -Value ([string]$p.Value); $SecretVars += $p.Name }
}
$env:SWARM_LOCAL_CONFIG = Join-Path $Root 'swarm.local.json'
$env:SWARM_BUS_KEY_FILE = Join-Path $Root 'bus.key'
$env:SWARM_BUS = 'memory'

function Say($text) {
  Write-Log $text
  if ($env:TELEGRAM_BOT_TOKEN -and $env:TELEGRAM_CHAT_ID) {
    try { Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$($env:TELEGRAM_BOT_TOKEN)/sendMessage" -Body @{ chat_id = $env:TELEGRAM_CHAT_ID; text = $text } -TimeoutSec 15 | Out-Null } catch { Write-Log "telegram: $($_.Exception.Message)" }
  }
}
# run a program with a time limit; output to $log (or nowhere); true when it finished with exit code 0
function Run-Timed($exe, $argv, $seconds, $log) {
  $o = if ($log) { $log } else { Join-Path $env:TEMP 'swarm-runtimed.out' }
  $p = Start-Process -FilePath $exe -ArgumentList $argv -WorkingDirectory (Get-Location).Path -RedirectStandardOutput $o -RedirectStandardError "$o.err" -WindowStyle Hidden -PassThru
  $null = $p.Handle
  if (-not $p.WaitForExit($seconds * 1000)) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; if ($log) { Add-Content $log "killed after $seconds s" }; return $false }
  if ($log -and (Test-Path "$o.err")) { Get-Content "$o.err" | Add-Content $log; Remove-Item "$o.err" -ErrorAction SilentlyContinue }
  return ($p.ExitCode -eq 0)
}
function Account {
  try { $c = Get-Content $env:SWARM_LOCAL_CONFIG -Raw | ConvertFrom-Json; if ($c.trading.account) { return [string]$c.trading.account } } catch { }
  return 'paper'
}
function Start-Swarm {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $out = Join-Path $Logs "swarm-$stamp.log"; $err = Join-Path $Logs "swarm-$stamp.err.log"
  # no heap cap: Node uses what is free on the PC (the watchdog reports the swarm's memory and the PC's free RAM)
  $argList = @("`"$App\swarm\src\run.js`"", '--agents', $Agents, '--isolate', 'brain', '--bus', 'memory', '--data-dir', "`"$Data`"")
  $p = Start-Process -FilePath 'node' -ArgumentList $argList -WorkingDirectory $App -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru
  $null = $p.Handle   # keeps the exit code readable after the process ends
  Write-Log "started node pid $($p.Id) at $(& git -C $App rev-parse --short HEAD) ($(Account) account)"
  return $p
}
function Stop-Swarm($p) {
  if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue; $p.WaitForExit(15000) | Out-Null }
}

# new code: gate (installed code judges), tests in a scratch checkout, then reset; returns the old commit or $null
function Try-Update {
  if (-not (Run-Timed 'git' @('-C', "`"$App`"", 'fetch', '-q', 'origin', $Branch) 120 $null)) { Write-Log 'update check: git fetch failed or took over 2 minutes'; return $null }
  $old = "$(& git -C $App rev-parse HEAD)".Trim(); $new = "$(& git -C $App rev-parse "origin/$Branch")".Trim()
  if (-not $new -or -not $old -or $old -eq $new) { return $null }
  $asked = Join-Path $Approved ".asked-$new"
  $gate = (& node (Join-Path $App 'swarm\src\tools\update_gate.js') --repo $App --old $old --new $new --account (Account)) -join ' '
  $seen = Join-Path $Approved ".seen-$new"
  if (-not (Test-Path $seen)) { New-Item -ItemType File -Path $seen | Out-Null; Write-Log "update check: $($old.Substring(0,7)) -> $($new.Substring(0,7)); gate: $gate" }
  if (Test-Path (Join-Path $Approved ".failed-$new")) { return $null } # its tests failed: wait for newer code
  if (-not $gate.StartsWith('auto') -and -not (Test-Path (Join-Path $Approved $new))) {
    if (-not (Test-Path $asked)) { New-Item -ItemType File -Path $asked | Out-Null; Say "Swarm update $($new.Substring(0,7)) needs your OK - $($gate -replace '^approval: ','').  To install it (Terminal as Admin): powershell -ExecutionPolicy Bypass -File C:\swarm\app\swarm\deploy\windows\approve.ps1" }
    return $null
  }
  $tmp = Join-Path $env:TEMP "swarm-update-$($new.Substring(0,12))"
  if (Test-Path $tmp) { & git -C $App worktree remove --force $tmp 2>$null; Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
  & git -C $App worktree add -q --detach $tmp $new 2>$null
  Push-Location (Join-Path $tmp 'swarm')
  $testLog = Join-Path $Logs "update-test-$($new.Substring(0,7)).log"
  Write-Log "update $($new.Substring(0,7)): tests started"
  # without the tokens and keys in their environment (the files stay readable: the gate is what keeps unapproved
  # test code from running here at all)
  $hidden = @{}
  foreach ($k in ($SecretVars | Select-Object -Unique)) { $v = [Environment]::GetEnvironmentVariable($k, 'Process'); if ($v) { $hidden[$k] = $v; Remove-Item "env:$k" } }
  try { $ok = Run-Timed 'node' @('--test', '--test-timeout=60000', 'test/*.test.js') 900 $testLog }   # 15 minutes at most
  finally { foreach ($k in $hidden.Keys) { Set-Item -Path "env:$k" -Value $hidden[$k] } }
  Write-Log "update $($new.Substring(0,7)): tests $(if ($ok) { 'passed' } else { 'failed or timed out' })"
  Pop-Location
  & git -C $App worktree remove --force $tmp 2>$null
  if (-not $ok) {
    $failed = Join-Path $Approved ".failed-$new"   # told once per commit (not the approval marker: an approved update that fails must still be reported)
    if (-not (Test-Path $failed)) { New-Item -ItemType File -Path $failed | Out-Null; Say "Swarm update $($new.Substring(0,7)) NOT installed: tests failed or timed out (see $testLog). The running version stays." }
    return $null
  }
  & git -C $App reset -q --hard $new
  Say "Swarm updated $($old.Substring(0,7)) -> $($new.Substring(0,7)): $(& git -C $App log --format=%s -1)"
  return $old
}

Get-ChildItem $Logs -Filter '*.log' -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) -and $_.Name -ne 'runner.log' } | Remove-Item -ErrorAction SilentlyContinue
Write-Log "runner started (pid $PID)"
$started = Get-Date; $lastCheck = Get-Date; $lastAlive = Get-Date; $rollbackTo = $null; $rollbackUntil = Get-Date
if ($RollbackTo) { $rollbackTo = $RollbackTo; $rollbackUntil = (Get-Date).AddMinutes(3); Write-Log "runner restarted for its own update; rollback to $($RollbackTo.Substring(0,7)) armed for 3 minutes" }
$proc = Start-Swarm
while ($true) {
  Start-Sleep -Seconds 20
  if ($env:SWARM_RUN_MINUTES -and ((Get-Date) - $started).TotalMinutes -ge [double]$env:SWARM_RUN_MINUTES) { Stop-Swarm $proc; Write-Log 'runner stopped (SWARM_RUN_MINUTES)'; break }
  if ($proc.HasExited) {
    if ($rollbackTo -and (Get-Date) -lt $rollbackUntil) {
      & git -C $App reset -q --hard $rollbackTo
      Say "Swarm update rolled back to $($rollbackTo.Substring(0,7)): the new code stopped within 3 minutes (exit code $($proc.ExitCode))."
      $rollbackTo = $null
    } else { Write-Log "node exited (code $($proc.ExitCode)); restarting" }
    Start-Sleep -Seconds 5
    $proc = Start-Swarm
    continue
  }
  if (((Get-Date) - $lastAlive).TotalMinutes -ge 60) { $lastAlive = Get-Date; Write-Log "alive: node pid $($proc.Id), code $(& git -C $App rev-parse --short HEAD)" }
  if (((Get-Date) - $lastCheck).TotalMinutes -ge 10) {
    $lastCheck = Get-Date
    $old = Try-Update
    if ($old) {
      Stop-Swarm $proc
      & git -C $App diff --quiet $old HEAD -- swarm/deploy/windows/run.ps1
      if ($LASTEXITCODE -ne 0) {
        # this script changed: start the new one (it starts the swarm and keeps the rollback armed), and end here
        Write-Log 'run.ps1 changed: restarting the runner'
        Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', "`"$PSCommandPath`"", '-RollbackTo', $old) -WindowStyle Hidden
        break
      }
      $rollbackTo = $old; $rollbackUntil = (Get-Date).AddMinutes(3); $proc = Start-Swarm
    }
  }
}
