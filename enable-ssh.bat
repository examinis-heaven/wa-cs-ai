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

echo ======================================================
echo   Cek, Install, dan Jalankan OpenSSH Server (sshd)
echo ======================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop'; ^
   Write-Host '1/4 Mengecek paket OpenSSH Server...' -ForegroundColor Cyan; ^
   $cap = Get-WindowsCapability -Online | Where-Object { $_.Name -like 'OpenSSH.Server*' } | Select-Object -First 1; ^
   if (-not $cap -or $cap.State -ne 'Installed') { ^
     Write-Host 'OpenSSH Server belum terpasang. Menginstall OpenSSH.Server~~~~0.0.1.0...' -ForegroundColor Yellow; ^
     Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0 | Out-Null; ^
     Write-Host 'OpenSSH Server berhasil diinstall.' -ForegroundColor Green; ^
   } else { ^
     Write-Host ('OpenSSH Server sudah terpasang: ' + $cap.Name) -ForegroundColor Green; ^
   } ^
   Write-Host '2/4 Menjalankan service sshd & set Automatic...' -ForegroundColor Cyan; ^
   Set-Service -Name sshd -StartupType Automatic; ^
   if ((Get-Service sshd).Status -ne 'Running') { Start-Service sshd }; ^
   Write-Host ('Status sshd: ' + (Get-Service sshd).Status) -ForegroundColor Green; ^
   Write-Host '3/4 Mengecek Firewall port 22...' -ForegroundColor Cyan; ^
   $fw = Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue; ^
   if (-not $fw) { ^
     New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server (sshd)' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null; ^
     Write-Host 'Rule firewall port 22 dibuat.' -ForegroundColor Green; ^
   } else { ^
     Enable-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' | Out-Null; ^
     Write-Host 'Firewall port 22 sudah aktif.' -ForegroundColor Green; ^
   } ^
   Write-Host '4/4 Info koneksi SSH:' -ForegroundColor Cyan; ^
   $ips = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress) -join ', '; ^
   Write-Host ('Username : ' + $env:USERNAME) -ForegroundColor White; ^
   Write-Host ('IP LAN   : ' + $ips) -ForegroundColor White;"

if errorlevel 1 (
  echo.
  echo [ERROR] Gagal menjalankan OpenSSH Server.
) else (
  echo.
  echo Selesai! SSH Server siap menerima koneksi di port 22.
)
echo.
pause
