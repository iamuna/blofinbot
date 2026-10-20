# Switch the swarm to the BloFin DEMO account (real orders, fake money), or back to paper with -Off.
#   C:\swarm\app\swarm\deploy\windows\enable-demo.ps1        asks for the demo API key
#   C:\swarm\app\swarm\deploy\windows\enable-demo.ps1 -Off   back to paper, deletes the key
# Create the key in BloFin's DEMO trading with READ + TRADE only - never transfer or withdraw (the trader refuses
# such keys). It is kept in C:\swarm\blofin-demo.json, readable only by you, and never leaves this PC.
param([switch]$Off)
$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..')).Path
$keyFile = Join-Path $Root 'blofin-demo.json'; $localFile = Join-Path $Root 'swarm.local.json'
function Read-Secret($prompt) { $s = Read-Host $prompt -AsSecureString; $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) } }
$local = Get-Content $localFile -Raw | ConvertFrom-Json
if ($Off) {
  Remove-Item $keyFile -ErrorAction SilentlyContinue
  $local.trading.account = 'paper'
} else {
  $k = Read-Host 'BloFin DEMO API key'
  $s = Read-Secret 'API secret (hidden)'
  $p = Read-Secret 'API passphrase (hidden)'
  [IO.File]::WriteAllText($keyFile, (@{ BLOFIN_API_KEY = $k.Trim(); BLOFIN_API_SECRET = $s.Trim(); BLOFIN_PASSPHRASE = $p.Trim() } | ConvertTo-Json))
  & icacls $keyFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null
  $local.trading.account = 'demo'
}
[IO.File]::WriteAllText($localFile, ($local | ConvertTo-Json -Depth 10))
# restart: the runner reads keys and settings when it starts
Stop-ScheduledTask -TaskName 'Swarm' -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like '*swarm*run.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-ScheduledTask -TaskName 'Swarm'
Write-Host "Swarm restarted on the $($local.trading.account.ToUpper()) account. Strategies still need mode 'trade' to send orders."
