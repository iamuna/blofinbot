# Swarm on Windows - no Ubuntu, no WSL. Run in PowerShell opened as administrator:
#
#   irm https://raw.githubusercontent.com/iamuna/blofinbot/main/swarm/deploy/windows/install.ps1 | iex
#
# Installs Node.js and Git (winget) if missing, puts the code in C:\swarm\app, asks once for the optional tokens
# (GitHub for the status/daily review, Telegram for alerts and commands), and registers a task that starts the
# swarm hidden every time you log in. The runner (run.ps1) keeps it going and installs updates the careful way:
# the update gate from the code already installed, all offline tests first, rollback if it then keeps crashing.
# PAPER account; nothing here touches money. Running this again updates the installation and keeps your tokens.
#
# Environment overrides (tests): SWARM_ROOT, SWARM_BRANCH, SWARM_SOURCE (a local git checkout instead of GitHub),
# SWARM_NO_PROMPT=1 (no questions), SWARM_NO_TASK=1 (no logon task, nothing started).

# native tools (git, winget) write progress to stderr; that must not count as a failure, so errors are checked
# through exit codes and -ErrorAction Stop on the cmdlets that matter
$ErrorActionPreference = 'Continue'
$Root = if ($env:SWARM_ROOT) { $env:SWARM_ROOT } else { 'C:\swarm' }
$Branch = if ($env:SWARM_BRANCH) { $env:SWARM_BRANCH } else { 'main' }   # the swarm moved from branch 'swarm' to 'main' on 2026-10-23
$Repo = 'https://github.com/iamuna/blofinbot.git'
$App = Join-Path $Root 'app'
function Write-Step($t) { Write-Host "`n== $t" -ForegroundColor Cyan }
function Save-Text($path, $text) { [IO.File]::WriteAllText($path, $text) }   # UTF-8 without BOM (Node's JSON.parse rejects a BOM)
function Read-Secret($prompt) {
  $s = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
function Refresh-Path { $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User') }

Write-Host 'Installing the swarm (paper account) in' $Root

# 1. Node.js 22+ and Git
Write-Step 'Node.js and Git'
Refresh-Path
# 22.13+: the brain runs under Node's permission model (src/core/isolate.js)
function Test-NodeOk { if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }; return ((& node -p "const [a,b]=process.versions.node.split('.').map(Number); a>22||(a===22&&b>=13)") -eq 'true') }
if (-not (Test-NodeOk)) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'winget is missing: install "App Installer" from the Microsoft Store, or Node.js 22.13+ from nodejs.org, then run this again.' }
  if (Get-Command node -ErrorAction SilentlyContinue) { winget upgrade -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements | Out-Host }
  else { winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements | Out-Host }
  Refresh-Path
  if (-not (Test-NodeOk)) { throw 'Node.js 22.13 or newer is needed: install the LTS version from nodejs.org, then run this again.' }
}
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  winget install -e --id Git.Git --silent --accept-source-agreements --accept-package-agreements | Out-Host
  Refresh-Path
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git did not install: install it from git-scm.com, then run this again.' }
}
& node --version; & git --version

# 2. the code
Write-Step 'Code'
New-Item -ItemType Directory -Force -Path $Root, "$Root\data", "$Root\logs", "$Root\approved" -ErrorAction Stop | Out-Null
$src = if ($env:SWARM_SOURCE) { $env:SWARM_SOURCE } else { $Repo }
if (Test-Path "$App\.git") {
  & git -C $App config core.autocrlf false
  # an explicit refspec: the clone may have been made for another branch (single-branch, e.g. 'swarm')
  & git -C $App fetch -q origin "+refs/heads/${Branch}:refs/remotes/origin/${Branch}"
  & git -C $App reset -q --hard "origin/$Branch"
  if ($LASTEXITCODE -ne 0) { throw "could not update the code in $App" }
} else {
  $depth = if ($env:SWARM_SOURCE) { @() } else { @('--depth', '50') }   # a local source clones whole
  & git clone -q --config core.autocrlf=false @depth --branch $Branch $src $App
  if ($LASTEXITCODE -ne 0) { throw "git clone failed ($src, branch $Branch)" }
}
& git -C $App log --format='installed %h %s' -1

# 3. local settings: paper account, where the risk-limit signature lives
Write-Step 'Settings'
$localFile = Join-Path $Root 'swarm.local.json'
$local = if (Test-Path $localFile) { Get-Content $localFile -Raw | ConvertFrom-Json } else { New-Object PSObject }
if (-not $local.PSObject.Properties['trading']) { $local | Add-Member trading (New-Object PSObject) }
if (-not $local.trading.PSObject.Properties['account']) { $local.trading | Add-Member account 'paper' }
if (-not $local.PSObject.Properties['guardian']) { $local | Add-Member guardian (New-Object PSObject) }
if (-not $local.guardian.PSObject.Properties['signatureFile']) { $local.guardian | Add-Member signatureFile (Join-Path $Root 'risk.sha256') }
Save-Text $localFile ($local | ConvertTo-Json -Depth 10)
Write-Host "account: $($local.trading.account)"

# bus key: orders, commands and account updates are signed with it (src/core/auth.js)
$keyFile = Join-Path $Root 'bus.key'
if (-not (Test-Path $keyFile)) { Save-Text $keyFile (& node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))") }
# the risk limits as they are now count as signed; after a change, sign-risk.ps1 signs the new ones
$sigFile = Join-Path $Root 'risk.sha256'
if (-not (Test-Path $sigFile)) { Save-Text $sigFile ((Get-FileHash "$App\swarm\config\risk.json" -Algorithm SHA256).Hash.ToLower() + "  risk.json`n") }

# 4. tokens (asked once; kept in C:\swarm\secrets.json, readable only by you). Running the installer again asks
#    for any token that is still missing and looks for the Telegram chat again if it was not found.
function Stop-Swarm {
  Stop-ScheduledTask -TaskName 'Swarm' -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name = 'powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*swarm*run.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*swarm*run.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
Stop-Swarm   # a running swarm reads Telegram itself; stop it while the installer looks for your chat, and restart it after
$secretsFile = Join-Path $Root 'secrets.json'
$sec = @{ GITHUB_TOKEN = ''; TELEGRAM_BOT_TOKEN = ''; TELEGRAM_CHAT_ID = '' }
if (Test-Path $secretsFile) { $old = Get-Content $secretsFile -Raw | ConvertFrom-Json; foreach ($k in @($sec.Keys)) { if ($old.$k) { $sec[$k] = [string]$old.$k } } }
if (-not $env:SWARM_NO_PROMPT -and (-not $sec.GITHUB_TOKEN -or -not $sec.TELEGRAM_BOT_TOKEN)) {
  Write-Step 'Tokens (press Enter to skip one)'
  if (-not $sec.GITHUB_TOKEN) {
    Write-Host '1) GitHub fine-grained token - repository iamuna/blofinbot only, Contents: Read and write.'
    $sec.GITHUB_TOKEN = (Read-Secret '   GitHub token (hidden)').Trim()
  }
  if (-not $sec.TELEGRAM_BOT_TOKEN) {
    Write-Host '2) Telegram bot token from @BotFather.'
    $sec.TELEGRAM_BOT_TOKEN = (Read-Secret '   Telegram bot token (hidden)').Trim()
  }
}
if ($sec.TELEGRAM_BOT_TOKEN) {
  Write-Step 'Telegram'
  $tg = $sec.TELEGRAM_BOT_TOKEN
  try {
    $me = Invoke-RestMethod "https://api.telegram.org/bot$tg/getMe" -TimeoutSec 20
    Write-Host "   Bot: @$($me.result.username)"
    if (-not $sec.TELEGRAM_CHAT_ID -and $env:SWARM_NO_PROMPT) {
      Write-Host '   No Telegram chat linked yet: run this installer again without SWARM_NO_PROMPT to link it.' -ForegroundColor Yellow
    } elseif (-not $sec.TELEGRAM_CHAT_ID) {
      # whoever controls the chat controls /flatten and /mode: link only the private chat that sends this one-time code
      # (anyone can message a bot, so "the last chat that wrote" is not good enough)
      $bytes = New-Object byte[] 4; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
      $code = 'swarm-' + (-join ($bytes | ForEach-Object { $_.ToString('x2') }))
      Write-Host "   In Telegram, send this to @$($me.result.username):  $code" -ForegroundColor Green
      Write-Host '   Waiting up to 3 minutes...'
      $offset = 0; $deadline = (Get-Date).AddMinutes(3)
      while (-not $sec.TELEGRAM_CHAT_ID -and (Get-Date) -lt $deadline) {
        try { $u = Invoke-RestMethod "https://api.telegram.org/bot$tg/getUpdates?offset=$offset&timeout=20" -TimeoutSec 30 } catch { Start-Sleep -Seconds 3; continue }
        foreach ($x in @($u.result)) {
          $offset = [int64]$x.update_id + 1
          if ($x.message -and $x.message.chat.type -eq 'private' -and "$($x.message.text)".Trim() -eq $code) { $sec.TELEGRAM_CHAT_ID = [string]$x.message.chat.id }
        }
      }
      if ($sec.TELEGRAM_CHAT_ID) { Write-Host "   Linked your chat: $($sec.TELEGRAM_CHAT_ID)" }
      else { Write-Host '   The code did not arrive in time. Run this installer again to get a new one.' -ForegroundColor Yellow }
    } else { Write-Host "   Your chat: $($sec.TELEGRAM_CHAT_ID)" }
  } catch {
    Write-Host "   Telegram does not accept that bot token ($($_.Exception.Message)). Copy it again from @BotFather; to enter it again, delete C:\swarm\secrets.json and run this installer again." -ForegroundColor Yellow
  }
}
Save-Text $secretsFile ($sec | ConvertTo-Json)
& icacls $secretsFile /inheritance:r /grant:r "$($env:USERNAME):(R,W)" | Out-Null

# 5. keep the PC awake while plugged in (the swarm watches the market around the clock)
if (-not $env:SWARM_NO_TASK) {
  Write-Step 'Power'
  & powercfg /change standby-timeout-ac 0
  Write-Host 'Sleep when plugged in: Never (the screen can still turn off). Undo: powercfg /change standby-timeout-ac 30'
}

# 6. start at every logon, hidden; restart the runner if it ever stops
if (-not $env:SWARM_NO_TASK) {
  Write-Step 'Start at logon'
  $run = Join-Path $App 'swarm\deploy\windows\run.ps1'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$run`""
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew
  Unregister-ScheduledTask -TaskName 'Swarm' -Confirm:$false -ErrorAction SilentlyContinue
  Register-ScheduledTask -TaskName 'Swarm' -Action $action -Trigger $trigger -Settings $settings -Description 'BloFin swarm (paper): starts at logon, see C:\swarm\logs' -ErrorAction Stop | Out-Null
  Start-ScheduledTask -TaskName 'Swarm' -ErrorAction Stop
  if ($sec.TELEGRAM_BOT_TOKEN -and $sec.TELEGRAM_CHAT_ID) {
    try { Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$($sec.TELEGRAM_BOT_TOKEN)/sendMessage" -Body @{ chat_id = $sec.TELEGRAM_CHAT_ID; text = "Swarm installed on $env:COMPUTERNAME (paper account). It is starting up: send /status in a minute." } -TimeoutSec 15 | Out-Null; Write-Host 'Sent you a hello on Telegram.' }
    catch { Write-Host "Could not message you on Telegram: $($_.Exception.Message)" -ForegroundColor Yellow }
  }
  Start-Sleep -Seconds 25
  $log = Get-ChildItem "$Root\logs\swarm-*.log" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
  if ($log) { Write-Host "`nFirst lines of $($log.Name):"; Get-Content $log.FullName -Tail 8 }
  Write-Host "`nInstalled and running (PAPER account). In Telegram, send /status to your bot."
  Write-Host 'Logs: C:\swarm\logs   Stop: Stop-ScheduledTask Swarm; Get-Process node | Stop-Process   Remove: C:\swarm\app\swarm\deploy\windows\uninstall.ps1'
} else { Write-Host "`nInstalled (no logon task: SWARM_NO_TASK)." }
