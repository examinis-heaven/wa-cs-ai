<#
.SYNOPSIS
  Script setup otomatis WA CS AI (Classic Project) untuk laptop Windows baru.
  Menginstall Node.js 24+, mengecek browser Chrome/Edge, menginstall dependency npm,
  menyiapkan .env, membuat folder kerja, dan menjalankan npm test.
#>

$ErrorActionPreference = "Stop"

function Write-Step($msg) {
  Write-Host "`n==> $msg" -ForegroundColor Cyan
}

function Refresh-Path {
  $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

function Get-NodeMajorVersion {
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCmd) { return 0 }
  try {
    $ver = (& node -v).Trim().TrimStart("v")
    return [int]($ver.Split(".")[0])
  } catch {
    return 0
  }
}

Write-Host "======================================================" -ForegroundColor Green
Write-Host "  Setup Otomatis: WA CS AI (Classic Project)" -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Green

# 1. Cek & Install Node.js (>= 22, direkomendasikan v24 LTS agar node:sqlite tersedia)
Write-Step "1/6 Mengecek Node.js..."
$major = Get-NodeMajorVersion
if ($major -lt 22) {
  Write-Host "Node.js >= 22 belum terpasang (terdeteksi: v$major). Menginstall Node.js v24..." -ForegroundColor Yellow
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if ($winget) {
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
  } else {
    Write-Host "winget tidak ditemukan, mengunduh installer resmi Node.js v24..." -ForegroundColor Yellow
    $index = Invoke-RestMethod -Uri "https://nodejs.org/dist/latest-v24.x/index.json" -UseBasicParsing
    $msiFile = "node-$($index[0].version)-x64.msi"
    $msiUrl = "https://nodejs.org/dist/latest-v24.x/$msiFile"
    $tempMsi = Join-Path $env:TEMP $msiFile
    Invoke-WebRequest -Uri $msiUrl -OutFile $tempMsi -UseBasicParsing
    Start-Process msiexec.exe -Wait -ArgumentList "/i `"$tempMsi`" /qn /norestart"
    Remove-Item -Force -ErrorAction SilentlyContinue $tempMsi
  }
  Refresh-Path
  $major = Get-NodeMajorVersion
  if ($major -lt 22) {
    throw "Node.js gagal terdeteksi setelah instalasi. Tutup lalu buka ulang PowerShell dan jalankan .\setup.ps1 lagi."
  }
}
Write-Host "Node.js siap: $(& node -v) | npm: $(& npm -v)" -ForegroundColor Green

# 2. Cek Browser Chrome / Edge (dibutuhkan whatsapp-web.js Puppeteer)
Write-Step "2/6 Mengecek Google Chrome / Microsoft Edge..."
$browserCandidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$foundBrowser = $browserCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $foundBrowser) {
  Write-Host "Chrome/Edge tidak ditemukan. Menginstall Google Chrome..." -ForegroundColor Yellow
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install -e --id Google.Chrome --accept-source-agreements --accept-package-agreements
  } else {
    Write-Warning "Silakan install Google Chrome secara manual agar whatsapp-web.js bisa berjalan."
  }
} else {
  Write-Host "Browser ditemukan: $foundBrowser" -ForegroundColor Green
}

# 3. Cek & Install 9router (global npm package)
Write-Step "3/7 Mengecek 9router..."
$routerCmd = Get-Command 9router -ErrorAction SilentlyContinue
if (-not $routerCmd) {
  Write-Host "9router belum terpasang. Menginstall 9router secara global..." -ForegroundColor Yellow
  & npm install -g 9router
  if ($LASTEXITCODE -ne 0) { throw "Gagal menginstall 9router." }
  Refresh-Path
}
Write-Host "9router siap: $((Get-Command 9router -ErrorAction SilentlyContinue).Source)" -ForegroundColor Green

# 4. Install npm dependencies
Write-Step "4/7 Menginstall package npm (whatsapp-web.js, express, dotenv, qrcode-terminal)..."
& npm install
if ($LASTEXITCODE -ne 0) { throw "npm install gagal." }

# 5. Siapkan .env
Write-Step "5/7 Menyiapkan file konfigurasi .env..."
if (-not (Test-Path ".env")) {
  Copy-Item ".env.example" ".env"
  Write-Host ".env dibuat dari .env.example." -ForegroundColor Yellow
  $apiKey = Read-Host "Masukkan ROUTER_API_KEY 9router Anda (kosongkan jika pakai default/nanti)"
  if ($apiKey) {
    (Get-Content ".env") -replace "ROUTER_API_KEY=.*", "ROUTER_API_KEY=$apiKey" | Set-Content ".env"
  }
  $routerUrl = Read-Host "Masukkan ROUTER_BASE_URL [Enter untuk http://127.0.0.1:20128/v1]"
  if ($routerUrl) {
    (Get-Content ".env") -replace "ROUTER_BASE_URL=.*", "ROUTER_BASE_URL=$routerUrl" | Set-Content ".env"
  }
} else {
  Write-Host ".env sudah ada, tidak ditimpa." -ForegroundColor Green
}

# 6. Buat folder kerja & buka port firewall 3001 (jika Administrator)
Write-Step "6/7 Menyiapkan folder data, logs, sessions..."
New-Item -ItemType Directory -Force -Path "data", "data\uploads", "logs", "sessions" | Out-Null
try {
  $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  if ($isAdmin) {
    $existingRule = Get-NetFirewallRule -DisplayName "WA CS Dashboard 3001" -ErrorAction SilentlyContinue
    if (-not $existingRule) {
      New-NetFirewallRule -DisplayName "WA CS Dashboard 3001" -Direction Inbound -LocalPort 3001 -Protocol TCP -Action Allow | Out-Null
      Write-Host "Firewall port 3001 dibuka untuk akses LAN/HP." -ForegroundColor Green
    }
  } else {
    Write-Host "Info: Jalankan PowerShell sebagai Administrator jika ingin otomatis membuka Firewall port 3001 untuk akses HP." -ForegroundColor DarkGray
  }
} catch {
  # Abaikan jika cmdlet firewall tidak tersedia
}

# 7. Jalankan unit & integration tests
Write-Step "7/7 Menjalankan verifikasi (npm test)..."
& npm test
if ($LASTEXITCODE -ne 0) { throw "npm test gagal." }

Write-Host "`n======================================================" -ForegroundColor Green
Write-Host "  Setup Selesai! Semua siap dijalankan." -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Green
Write-Host "Langkah selanjutnya:"
Write-Host "1. Jalankan 9router di terminal terpisah:  9router"
Write-Host "2. Jalankan bot & dashboard:               npm start"
Write-Host "3. Scan QR WhatsApp di terminal atau di http://localhost:3001/ (tab Login WA)"
