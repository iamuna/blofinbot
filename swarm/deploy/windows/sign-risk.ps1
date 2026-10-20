# Sign the risk limits as they are now in C:\swarm\app\swarm\config\risk.json (the guardian stops trading if they
# change without a new signature). Shows them first and asks yes/no.
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$f = Join-Path $Root 'app\swarm\config\risk.json'
Get-Content $f
if ((Read-Host "`nSign these limits? (yes/no)") -ne 'yes') { Write-Host 'Not signed.'; return }
[IO.File]::WriteAllText((Join-Path $Root 'risk.sha256'), (Get-FileHash $f -Algorithm SHA256).Hash.ToLower() + "  risk.json`n")
Write-Host 'Signed.'
