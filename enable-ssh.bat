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
$ErrorActionPreference = 'Continue'
Write-Host '======================================================' -ForegroundColor Green
Write-Host '  Cek, Install, dan Jalankan OpenSSH Server (sshd)' -ForegroundColor Green
Write-Host '======================================================' -ForegroundColor Green

try {
  Write-Host "`n1/4 Mengecek paket OpenSSH Server..." -ForegroundColor Cyan
  $svc = Get-Service -Name sshd -ErrorAction SilentlyContinue
  $cap = Get-WindowsCapability -Online -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'OpenSSH.Server*' } | Select-Object -First 1

  if (-not $svc -and (-not $cap -or $cap.State -ne 'Installed')) {
    Write-Host 'OpenSSH Server belum terpasang. Menginstall OpenSSH.Server~~~~0.0.1.0...' -ForegroundColor Yellow
    Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null
    Write-Host 'OpenSSH Server berhasil diinstall.' -ForegroundColor Green
  } else {
    Write-Host 'OpenSSH Server sudah terpasang.' -ForegroundColor Green
  }

  Write-Host "`n2/4 Menjalankan service sshd & set Automatic..." -ForegroundColor Cyan
  Set-Service -Name sshd -StartupType Automatic
  if ((Get-Service -Name sshd).Status -ne 'Running') {
    Start-Service -Name sshd
  }
  Write-Host ('Status sshd: ' + (Get-Service -Name sshd).Status) -ForegroundColor Green

  Write-Host "`n3/4 Mengecek Firewall port 22..." -ForegroundColor Cyan
  $fw = Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue
  if (-not $fw) {
    New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null
    Write-Host 'Rule firewall port 22 dibuat.' -ForegroundColor Green
  } else {
    Enable-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' | Out-Null
    Write-Host 'Firewall port 22 sudah aktif.' -ForegroundColor Green
  }

  Write-Host "`n4/4 Info koneksi SSH:" -ForegroundColor Cyan
  $ips = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress) -join ', '
  Write-Host ('Username : ' + $env:USERNAME) -ForegroundColor White
  Write-Host ('IP LAN   : ' + $ips) -ForegroundColor White
  Write-Host "`nSelesai! SSH Server siap menerima koneksi di port 22." -ForegroundColor Green
} catch {
  Write-Host "`n[ERROR] $($_.Exception.Message)" -ForegroundColor Red
}
