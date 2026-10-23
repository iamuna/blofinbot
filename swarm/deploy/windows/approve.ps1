# Ibrahim's approval for a swarm update that touches protected code (risk limits, risk/trader/guardian/Herald code,
# the bus, the installers). Right-click -> Run with PowerShell, or in PowerShell:
#   C:\swarm\app\swarm\deploy\windows\approve.ps1
# Shows what changed since the installed version and asks yes/no. On yes, the runner installs it within 10 minutes
# (tests first; rolled back if it crashes). Changed risk limits are signed right here, after you have read them.
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$App = Join-Path $Root 'app'; $Branch = if ($env:SWARM_BRANCH) { $env:SWARM_BRANCH } else { 'main' }
& git -C $App fetch -q origin "+refs/heads/${Branch}:refs/remotes/origin/${Branch}"
$old = (& git -C $App rev-parse HEAD).Trim(); $new = (& git -C $App rev-parse "origin/$Branch").Trim()
if ($old -eq $new) { Write-Host "Nothing new: $($old.Substring(0,12)) is installed."; Read-Host 'Press Enter to close'; return }
$account = 'paper'; try { $c = Get-Content (Join-Path $Root 'swarm.local.json') -Raw | ConvertFrom-Json; if ($c.trading.account) { $account = $c.trading.account } } catch { }
Write-Host "Installed: $($old.Substring(0,12))   New: $($new.Substring(0,12))   Account: $account`n"
& git -C $App log --format='  %h %s' "$old..$new"
Write-Host ''
& git -C $App diff --stat $old $new -- swarm
Write-Host "`nGate: $((& node (Join-Path $App 'swarm\src\tools\update_gate.js') --repo $App --old $old --new $new --account $account) -join ' ')"
& git -C $App diff --quiet $old $new -- swarm/config/risk.json
$riskChanged = ($LASTEXITCODE -ne 0)
if ($riskChanged) { Write-Host "`nThe risk limits change:"; & git -C $App diff $old $new -- swarm/config/risk.json }
$a = Read-Host "`nInstall $($new.Substring(0,12))? (yes/no)"
if ($a -ne 'yes') { Write-Host 'Not approved.'; Read-Host 'Press Enter to close'; return }
New-Item -ItemType File -Force -Path (Join-Path $Root "approved\$new") | Out-Null
if ($riskChanged) {
  # the exact bytes the new commit will put on disk (node reads git's output unchanged)
  $sha = & node -e "const b=require('child_process').execFileSync('git',['-C',process.argv[1],'show',process.argv[2]+':swarm/config/risk.json']);process.stdout.write(require('crypto').createHash('sha256').update(b).digest('hex'))" $App $new
  [IO.File]::WriteAllText((Join-Path $Root 'risk.sha256'), "$sha  risk.json`n")
  Write-Host 'Risk limits signed. If the guardian paused trading meanwhile, send /resume on Telegram.'
}
Write-Host 'Approved: the swarm installs it within 10 minutes (tests first).'
Read-Host 'Press Enter to close'
