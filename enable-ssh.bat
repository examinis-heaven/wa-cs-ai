@echo off
setlocal
title Setup & Jalankan OpenSSH Server (sshd)

:: Cek hak akses Administrator, jika belum otomatis minta UAC Run as Administrator
net session >nul 2>&1
if errorlevel 1 (
  echo Meminta izin Administrator...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-Expression (([System.IO.File]::ReadAllText('%~f0') -split '(?m)^###PS_START###\r?$', 2)[1])"
echo.
pause
exit /b

###PS_START###
$ErrorActionPreference = 'Stop'
Write-Host '======================================================' -ForegroundColor Green
Write-Host '  Cek, Install, dan Jalankan OpenSSH Server (sshd)' -ForegroundColor Green
Write-Host '======================================================' -ForegroundColor Green

try {
  Write-Host "`n1/4 Mengecek paket OpenSSH Server..." -ForegroundColor Cyan
  $svc = Get-Service -Name sshd -ErrorAction SilentlyContinue

  if (-not $svc) {
    Write-Host 'Service sshd belum ada. Menginstall OpenSSH Server...' -ForegroundColor Yellow
    $installed = $false
    try {
      Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 -ErrorAction Stop | Out-Null
      $installed = $true
      Write-Host 'OpenSSH Server berhasil diinstall via Windows Capability.' -ForegroundColor Green
    } catch {
      Write-Host ('Add-WindowsCapability gagal: ' + $_.Exception.Message) -ForegroundColor Yellow
      if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host 'Mencoba fallback install via winget (Microsoft.OpenSSH.Beta)...' -ForegroundColor Yellow
        $ErrorActionPreference = 'Continue'
        & winget install -e --id Microsoft.OpenSSH.Beta --accept-source-agreements --accept-package-agreements
        $ErrorActionPreference = 'Stop'
        $installScript = 'C:\Program Files\OpenSSH\install-sshd.ps1'
        if (Test-Path $installScript) {
          & powershell -NoProfile -ExecutionPolicy Bypass -File $installScript
        }
        $installed = [bool](Get-Service -Name sshd -ErrorAction SilentlyContinue)
      }
    }

    if (-not $installed -and -not (Get-Service -Name sshd -ErrorAction SilentlyContinue)) {
      throw 'Gagal menginstall OpenSSH Server. Pastikan Windows Update aktif atau install OpenSSH Server di Settings > System > Optional features.'
    }
  } else {
    Write-Host 'OpenSSH Server sudah terpasang.' -ForegroundColor Green
  }

  Write-Host "`n2/4 Menjalankan service sshd & set Automatic..." -ForegroundColor Cyan
  $sshdSvc = Get-Service -Name sshd -ErrorAction Stop
  Set-Service -Name sshd -StartupType Automatic

  if ($sshdSvc.Status -ne 'Running') {
    try {
      Start-Service -Name sshd -ErrorAction Stop
    } catch {
      Write-Host 'Start-Service gagal, mencoba perbaikan otomatis host keys & permission C:\ProgramData\ssh...' -ForegroundColor Yellow
      $sshKeygen = Get-Command ssh-keygen -ErrorAction SilentlyContinue
      if (-not $sshKeygen -and (Test-Path 'C:\Program Files\OpenSSH\ssh-keygen.exe')) {
        $sshKeygen = 'C:\Program Files\OpenSSH\ssh-keygen.exe'
      }
      if ($sshKeygen) { & $sshKeygen -A 2>$null | Out-Null }

      $fixHost = 'C:\Program Files\OpenSSH\FixHostFilePermissions.ps1'
      if (Test-Path $fixHost) {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $fixHost -Confirm:$false 2>$null
      } elseif (Test-Path 'C:\ProgramData\ssh') {
        & icacls 'C:\ProgramData\ssh' /inheritance:r /grant 'SYSTEM:(OI)(CI)F' /grant 'Administrators:(OI)(CI)F' | Out-Null
      }

      try {
        Start-Service -Name sshd -ErrorAction Stop
      } catch {
        $sshdExe = (Get-Command sshd -ErrorAction SilentlyContinue).Source
        if (-not $sshdExe -and (Test-Path 'C:\Windows\System32\OpenSSH\sshd.exe')) { $sshdExe = 'C:\Windows\System32\OpenSSH\sshd.exe' }
        if (-not $sshdExe -and (Test-Path 'C:\Program Files\OpenSSH\sshd.exe')) { $sshdExe = 'C:\Program Files\OpenSSH\sshd.exe' }
        if ($sshdExe) {
          Write-Host 'Menjalankan diagnosa sshd -t:' -ForegroundColor Yellow
          & $sshdExe -t
        }
        throw
      }
    }
  }
  $sshdSvc = Get-Service -Name sshd
  Write-Host ('Status sshd: ' + $sshdSvc.Status) -ForegroundColor Green

  Write-Host "`n3/4 Mengecek Firewall port 22 (Profile Any)..." -ForegroundColor Cyan
  $fw = Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue
  if (-not $fw) {
    New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 -Profile Any | Out-Null
    Write-Host 'Rule firewall port 22 dibuat (Profile Any).' -ForegroundColor Green
  } else {
    Set-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -Enabled True -Profile Any | Out-Null
    Write-Host 'Firewall port 22 diaktifkan (Profile Any).' -ForegroundColor Green
  }

  Write-Host "`n4/4 Info koneksi SSH:" -ForegroundColor Cyan
  $ips = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress) -join ', '
  $local22 = Test-NetConnection -ComputerName 127.0.0.1 -Port 22 -InformationLevel Quiet -WarningAction SilentlyContinue
  Write-Host ('Username      : ' + $env:USERNAME) -ForegroundColor White
  Write-Host ('IP LAN        : ' + $ips) -ForegroundColor White
  Write-Host ('Port 22 Lokal : ' + $(if ($local22) { 'OPEN' } else { 'CLOSED' })) -ForegroundColor $(if ($local22) { 'Green' } else { 'Red' })
  Write-Host "`nSelesai! SSH Server siap menerima koneksi di port 22." -ForegroundColor Green
} catch {
  Write-Host "`n[ERROR] $($_.Exception.Message)" -ForegroundColor Red
}
