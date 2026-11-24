#!/usr/bin/env bash
set -euo pipefail

echo "======================================================"
echo "  Setup Otomatis: WA CS AI (Classic Project)"
echo "======================================================"

get_node_major() {
  if ! command -v node >/dev/null 2>&1; then
    echo 0
    return
  fi
  node -v | sed 's/^v//' | cut -d. -f1
}

echo ""
echo "==> 1/6 Mengecek Node.js (>= 22, direkomendasikan v24)..."
NODE_MAJOR=$(get_node_major)
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js >= 22 belum terpasang (terdeteksi: v$NODE_MAJOR). Menginstall Node.js v24..."
  OS_NAME=$(uname -s)
  if [ "$OS_NAME" = "Darwin" ]; then
    if command -v brew >/dev/null 2>&1; then
      brew install node@24 || brew install node
    else
      echo "Homebrew belum terpasang. Install Homebrew atau Node.js v24 dari https://nodejs.org/"
      exit 1
    fi
  elif [ "$OS_NAME" = "Linux" ]; then
    if command -v apt-get >/dev/null 2>&1; then
      curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
      sudo apt-get install -y nodejs
    elif command -v dnf >/dev/null 2>&1; then
      curl -fsSL https://rpm.nodesource.com/setup_24.x | sudo bash -
      sudo dnf install -y nodejs
    else
      echo "Package manager tidak dikenali. Silakan install Node.js v24 dari https://nodejs.org/"
      exit 1
    fi
  fi
fi
echo "Node.js siap: $(node -v) | npm: $(npm -v)"

echo ""
echo "==> 2/6 Mengecek Browser (Chrome / Chromium)..."
if command -v google-chrome >/dev/null 2>&1 || command -v chromium >/dev/null 2>&1 || command -v chromium-browser >/dev/null 2>&1 || [ -d "/Applications/Google Chrome.app" ]; then
  echo "Browser ditemukan."
else
  echo "Browser tidak ditemukan. Mencoba install Chromium..."
  if [ "$(uname -s)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    brew install --cask google-chrome || true
  elif command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y chromium || sudo apt-get install -y chromium-browser || true
  else
    echo "Peringatan: Install Google Chrome / Chromium secara manual agar whatsapp-web.js berjalan."
  fi
fi

echo ""
echo "==> 3/6 Menginstall package npm..."
npm install

echo ""
echo "==> 4/6 Menyiapkan file konfigurasi .env..."
if [ ! -f ".env" ]; then
  cp .env.example .env
  echo ".env dibuat dari .env.example."
  read -r -p "Masukkan ROUTER_API_KEY 9router Anda (kosongkan jika pakai default/nanti): " API_KEY || true
  if [ -n "${API_KEY:-}" ]; then
    sed -i.bak "s|^ROUTER_API_KEY=.*|ROUTER_API_KEY=${API_KEY}|" .env && rm -f .env.bak
  fi
  read -r -p "Masukkan ROUTER_BASE_URL [Enter untuk http://127.0.0.1:20128/v1]: " ROUTER_URL || true
  if [ -n "${ROUTER_URL:-}" ]; then
    sed -i.bak "s|^ROUTER_BASE_URL=.*|ROUTER_BASE_URL=${ROUTER_URL}|" .env && rm -f .env.bak
  fi
else
  echo ".env sudah ada, tidak ditimpa."
fi

echo ""
echo "==> 5/6 Menyiapkan folder data, logs, sessions..."
mkdir -p data data/uploads logs sessions

echo ""
echo "==> 6/6 Menjalankan verifikasi (npm test)..."
npm test

echo ""
echo "======================================================"
echo "  Setup Selesai! Semua siap dijalankan."
echo "======================================================"
echo "Langkah selanjutnya:"
echo "1. Pastikan 9router berjalan di http://127.0.0.1:20128/v1"
echo "2. Jalankan bot & dashboard:  npm start"
echo "3. Scan QR WhatsApp di terminal atau di http://localhost:3001/ (tab Login WA)"
