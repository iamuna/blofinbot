# Stop the swarm and remove its logon task. Keeps C:\swarm (code, data, logs, tokens) unless you delete it yourself.
$ErrorActionPreference = 'Continue'
Stop-ScheduledTask -TaskName 'Swarm' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'Swarm' -Confirm:$false -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -like '*swarm*run.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" | Where-Object { $_.CommandLine -like '*swarm*run.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host 'Swarm stopped and removed from startup. Your files are still in C:\swarm.'
