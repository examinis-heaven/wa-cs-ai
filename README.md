# Classic Project — WhatsApp AI Seller & Catalog Dashboard

![Node.js](https://img.shields.io/badge/Node.js-24%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![WhatsApp Web](https://img.shields.io/badge/whatsapp--web.js-LocalAuth-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-node%3Asqlite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![GSAP](https://img.shields.io/badge/UI-GSAP%20Motion-88CE02?style=for-the-badge&logo=greensock&logoColor=black)
![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

Asisten penjual WhatsApp otomatis berbasis **AI + Knowledge Markdown + SQLite Catalog** dengan gaya bahasa penjual asli Indonesia, dilengkapi **Dashboard Single-Page (GSAP Motion, Responsif Mobile)** untuk manajemen katalog produk, stok real-time, gambar produk, serta pencatatan jadwal COD.

---

## Arsitektur Sistem

```mermaid
flowchart LR
    WA["WhatsApp Pembeli<br/>(@c.us / @lid)"] -->|QR + LocalAuth| WWEB["whatsapp-web.js"]
    WWEB -->|Debounce 10s per nomor| BOT["CustomerServiceBot<br/>+ Anti-Prompt Injection"]
    BOT -->|Prompt + Live Stok| LLM["9router (/v1/chat/completions)"]
    SQL["SQLite (data/catalog.db)<br/>Produk & Jadwal COD STK"] <-->|Real-Time| BOT
    SKILL["skills/cs-produk-marketplace<br/>SKILL.md + produk.md"] -->|Hot-Reload| BOT
    DASH["Dashboard Single-Page<br/>(GSAP + Mobile UI)"] <-->|REST API| SQL
    BOT -->|Simpan chat per customer| SESS["sessions/*.json"]
```

---

## Fitur Utama

### 1. WhatsApp Bot (`whatsapp-web.js` + `LocalAuth`)
- **Login QR Sekali Saja**: Scan QR barcode di terminal pada pemakaian pertama; session tersimpan di `.wwebjs_auth/` untuk dipakai ulang saat restart.
- **Debounce 10 Detik Per Nomor**: Beberapa *bubble* chat cepat dari satu nomor WA digabung menjadi satu konteks sebelum dijawab.
- **Resolusi Nomor Asli `@lid`**: Otomatis mengambil nomor telepon asli (`08...`) dan nama kontak WA melalui `getContact()` agar mudah dicari saat HP dibawa COD.
- **Shareloc Pin Peta WhatsApp Asli**: Mendukung pengiriman pin `Location` bawaan WhatsApp untuk titik COD tanpa mengirim link mentah.
- **Memori Percakapan Persisten**: Riwayat obrolan disimpan per customer di `sessions/*.json` agar tetap nyambung meski bot di-restart.

### 2. Persona Penjual & Knowledge Hot-Reload
- **Gaya Penjual Asli Indonesia**: Membalas santai, singkat, dan terstruktur dengan baris baru (Enter) serta list yang nyaman dibaca di HP—tanpa tanda bintang Markdown (`*...*`) dan tanpa terdengar seperti bot.
- **Hot-Reload**: Setiap perubahan di [SKILL.md](skills/cs-produk-marketplace/SKILL.md) dan [produk.md](skills/cs-produk-marketplace/references/produk.md) langsung terbaca otomatis tanpa restart.
- **Kerahasiaan Jumlah Stok**: Tidak membocorkan angka sisa stok kecuali pembeli meminta jumlah melebihi stok yang tersedia.

### 3. Dashboard Single-Page (GSAP Motion + Mobile Responsive)
- **Animasi Halus (GSAP)**: Transisi tab, kartu statistik, modal form, dan notifikasi toast yang responsif di desktop maupun HP.
- **Katalog Produk SQLite (`node:sqlite`)**: Tambah, edit, hapus, upload/URL gambar produk, pencarian, filter status (`Tersedia` / `Habis`), dan tombol cepat stok `-1` / `+1`.
- **Form & Daftar Jadwal COD (STK)**: Mencatat jadwal COD di titik `STK Sedulur Tunggal Kopi (STK KUSBANG)`—baik input manual dari dashboard maupun otomatis dari chat WhatsApp—lengkap dengan tombol **Chat WA** langsung.
- **Akses Jaringan Lokal (LAN/HP)**: Server listen di `0.0.0.0:3001` sehingga bisa dibuka dari HP dalam satu jaringan WiFi.

### 4. Keamanan & Logging
- **Anti-Prompt Injection 3 Lapis**: Sanitasi tag kontrol palsu, deteksi pola jailbreak/exfiltration sebelum memanggil LLM, delimiter `<pesan_pembeli>`, dan guard kebocoran output.
- **Daily Logs**: Log aktivitas & error tersimpan rapi di `logs/app-YYYY-MM-DD.log` dan `logs/error-YYYY-MM-DD.log` (juga bisa dilihat via `GET /logs`).

---

## Struktur Proyek

```text
├── public/
│   └── dashboard.html          # Single-page UI (GSAP Motion + Mobile Responsive)
├── skills/
│   └── cs-produk-marketplace/
│       ├── SKILL.md            # Persona penjual & aturan komunikasi
│       └── references/
│           └── produk.md       # Knowledge produk, harga, FAQ, lokasi COD
├── src/
│   ├── bot.js                  # Orkestrator chat, debounce 10s, COD & shareloc
│   ├── catalogDb.js            # SQLite database (products & cod_orders)
│   ├── config.js               # Konfigurasi & deteksi browser Chrome/Edge
│   ├── index.js                # Entrypoint WhatsApp Client + Express server
│   ├── knowledge.js            # Hot-reload loader + parser tag internal
│   ├── llm.js                  # Client 9router (/v1/chat/completions)
│   ├── logger.js               # File & console logger harian
│   ├── security.js             # Anti-prompt injection & readability formatter
│   ├── server.js               # REST API katalog, upload gambar, COD, test-chat
│   └── sessionStore.js         # Memori percakapan persisten per customer
├── test/
│   └── bot.test.js             # Unit & integration tests (node:test)
├── .env.example                # Contoh konfigurasi environment
├── LICENSE                     # MIT License
└── package.json
```

---

## Cara Menjalankan

1. **Install dependencies** (Node.js 24+):
   ```bash
   npm install
   ```
2. **Salin dan sesuaikan konfigurasi**:
   ```bash
   cp .env.example .env
   ```
   Pastikan `ROUTER_BASE_URL`, `ROUTER_API_KEY`, dan `ROUTER_MODEL` sudah sesuai dengan instance **9router** Anda.
3. **Jalankan bot & dashboard**:
   ```bash
   npm start
   ```
4. **Scan QR WhatsApp** yang muncul di terminal lewat *Perangkat Tertaut* di HP Anda (cukup sekali saat awal).
5. **Buka Dashboard**:
   - Di laptop: `http://localhost:3001/`
   - Di HP (satu jaringan WiFi): gunakan URL `Akses LAN/HP` yang tampil di terminal saat startup.

---

## API Endpoints

| Method | Endpoint | Fungsi |
|---|---|---|
| `GET` | `/` atau `/dashboard` | Halaman dashboard single-page |
| `GET` | `/health` | Status WhatsApp & koneksi 9router |
| `GET` | `/api/products` | Daftar produk dari SQLite |
| `POST` | `/api/products` | Tambah produk baru |
| `PUT` | `/api/products/:id` | Update data produk |
| `PATCH` | `/api/products/:id/stock` | Ubah stok cepat (`delta` / `stock`) |
| `DELETE` | `/api/products/:id` | Hapus produk |
| `POST` | `/api/upload` | Upload gambar produk |
| `GET` | `/api/cod` | Daftar jadwal COD (STK) |
| `POST` | `/api/cod` | Catat jadwal COD baru |
| `PATCH` | `/api/cod/:id/status` | Ubah status COD (`menunggu` / `selesai` / `batal`) |
| `POST` | `/test-chat` | Simulasi chat CS AI |
| `GET` | `/logs?type=error` | Lihat log harian |

---

## Pengujian

```bash
npm test
```

---

## Lisensi

Proyek ini dirilis di bawah lisensi [MIT](LICENSE).
