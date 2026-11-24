import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_SEED_PRODUCTS = [
  {
    name: 'Plug and Play by Classic Project',
    category: 'Konsol',
    variant: '160 GB',
    price: 250000,
    stock: 0,
    is_active: 0,
    notes: 'Paket tidak tersedia; arahkan ke 250 GB',
  },
  {
    name: 'Plug and Play by Classic Project',
    category: 'Konsol',
    variant: '250 GB',
    price: 300000,
    stock: 5,
    is_active: 1,
    notes: 'Paket termurah yang tersedia, 2.000-4.000 game tergantung paket',
  },
  {
    name: 'Plug and Play by Classic Project',
    category: 'Konsol',
    variant: '320 GB',
    price: 350000,
    stock: 5,
    is_active: 1,
    notes: 'Opsi menengah',
  },
  {
    name: 'Plug and Play by Classic Project',
    category: 'Konsol',
    variant: '500 GB',
    price: 400000,
    stock: 5,
    is_active: 1,
    notes: 'Selisih Rp 50.000 dari 320 GB, ruang jauh lebih lega',
  },
  {
    name: 'Plug and Play by Classic Project',
    category: 'Konsol',
    variant: '1 TB',
    price: 750000,
    stock: 3,
    is_active: 1,
    notes: 'Kapasitas terbesar',
  },
  {
    name: 'Stik PS3',
    category: 'Aksesori',
    variant: 'Satuan',
    price: 55000,
    stock: 10,
    is_active: 1,
    notes: 'Harga satuan Rp 55.000/pcs; jika beli bundling dengan PnP diskon Rp 5.000 menjadi Rp 50.000/pcs',
  },
  {
    name: 'Stik PS4',
    category: 'Aksesori',
    variant: 'Satuan',
    price: 110000,
    stock: 6,
    is_active: 1,
    notes: 'Harga satuan Rp 110.000/pcs; jika beli bundling dengan PnP diskon Rp 5.000 menjadi Rp 105.000/pcs',
  },
];

function formatRupiah(amount) {
  return `Rp ${Number(amount || 0).toLocaleString('id-ID')}`;
}

const STOP_WORDS = new Set([
  'kak', 'halo', 'hai', 'gan', 'bro', 'sis', 'mas', 'mbak', 'ada', 'game', 'games',
  'main', 'bisa', 'nggak', 'enggak', 'gak', 'ga', 'tidak', 'apa', 'aja', 'saja',
  'yang', 'yg', 'di', 'ke', 'dari', 'untuk', 'buat', 'mau', 'tanya', 'dong', 'nih',
  'ya', 'kah', 'spek', 'spec', 'pc', 'laptop', 'ram', 'cpu', 'gpu', 'vga', 'setting',
  'settingan', 'rekomendasi', 'konsol', 'emulator', 'daftar', 'list', 'punya', 'berapa',
]);

function cleanGameTitle(rawName) {
  return String(rawName || '')
    .replace(/\.[a-z0-9]{2,5}$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSearchTokens(text) {
  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
  return [...new Set(words)].slice(0, 6);
}

/**
 * SQLite-backed product & stock catalog using Node's built-in `node:sqlite`.
 */
export class CatalogDb {
  /**
   * @param {string} dbPath
   * @param {{ seedIfEmpty?: boolean }} [options]
   */
  constructor(dbPath = path.resolve('data', 'catalog.db'), { seedIfEmpty = true } = {}) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
    }
    this.dbPath = dbPath;
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'Produk',
        variant TEXT NOT NULL DEFAULT '',
        price INTEGER NOT NULL DEFAULT 0,
        stock INTEGER NOT NULL DEFAULT 0,
        is_active INTEGER NOT NULL DEFAULT 1,
        image_url TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS cod_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT NOT NULL DEFAULT '',
        customer_phone TEXT NOT NULL DEFAULT '',
        product_name TEXT NOT NULL,
        qty INTEGER NOT NULL DEFAULT 1,
        cod_date TEXT NOT NULL DEFAULT '',
        cod_time TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT 'STK Sedulur Tunggal Kopi (STK KUSBANG)',
        status TEXT NOT NULL DEFAULT 'menunggu',
        notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS systems_kb (
        system_code TEXT PRIMARY KEY,
        fullname TEXT NOT NULL DEFAULT '',
        hardware TEXT NOT NULL DEFAULT '',
        game_count INTEGER NOT NULL DEFAULT 0,
        min_cpu TEXT NOT NULL DEFAULT '',
        min_ram TEXT NOT NULL DEFAULT '',
        min_gpu TEXT NOT NULL DEFAULT '',
        emulator TEXT NOT NULL DEFAULT '',
        bios_status TEXT NOT NULL DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS games_kb (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        system_code TEXT NOT NULL,
        title TEXT NOT NULL,
        raw_name TEXT NOT NULL,
        size_mb REAL NOT NULL DEFAULT 0,
        sources TEXT NOT NULL DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_games_kb_title ON games_kb(title);
      CREATE INDEX IF NOT EXISTS idx_games_kb_sys ON games_kb(system_code);

      CREATE TABLE IF NOT EXISTS kb_docs (
        key TEXT PRIMARY KEY,
        content TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS laptop_specs_kb (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model_key TEXT NOT NULL UNIQUE,
        model_name TEXT NOT NULL,
        specs_text TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'web',
        updated_at TEXT NOT NULL
      );
    `);

    // Migrate existing catalog.db safely if image_url column does not exist yet
    const cols = this.db.prepare('PRAGMA table_info(products)').all();
    if (!cols.some((c) => c.name === 'image_url')) {
      this.db.exec("ALTER TABLE products ADD COLUMN image_url TEXT NOT NULL DEFAULT ''");
    }

    if (seedIfEmpty) {
      const row = this.db.prepare('SELECT COUNT(*) AS count FROM products').get();
      if (row.count === 0) {
        for (const item of DEFAULT_SEED_PRODUCTS) {
          this.create(item);
        }
      }
    }
  }

  /**
   * List all products ordered by category, price, and id.
   * @returns {Array<{ id: number, name: string, category: string, variant: string, price: number, stock: number, is_active: number, notes: string, updated_at: string }>}
   */
  list() {
    return this.db
      .prepare('SELECT id, name, category, variant, price, stock, is_active, image_url, notes, updated_at FROM products ORDER BY category ASC, price ASC, id ASC')
      .all();
  }

  /**
   * Get single product by id.
   * @param {number} id
   */
  getById(id) {
    return this.db
      .prepare('SELECT id, name, category, variant, price, stock, is_active, image_url, notes, updated_at FROM products WHERE id = ?')
      .get(Number(id)) || null;
  }

  /**
   * Create a new product.
   * @param {{ name: string, category?: string, variant?: string, price?: number, stock?: number, is_active?: number | boolean, image_url?: string, notes?: string }} input
   */
  create(input) {
    const name = String(input?.name || '').trim();
    if (!name) {
      throw new Error('Nama produk wajib diisi');
    }
    const category = String(input?.category || 'Produk').trim() || 'Produk';
    const variant = String(input?.variant || '').trim();
    const price = Math.max(0, Math.round(Number(input?.price || 0)));
    const stock = Math.max(0, Math.round(Number(input?.stock || 0)));
    const isActive = input?.is_active === false || Number(input?.is_active) === 0 ? 0 : 1;
    const imageUrl = String(input?.image_url || '').trim();
    const notes = String(input?.notes || '').trim();
    const updatedAt = new Date().toISOString();

    const info = this.db
      .prepare(
        `INSERT INTO products (name, category, variant, price, stock, is_active, image_url, notes, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(name, category, variant, price, stock, isActive, imageUrl, notes, updatedAt);

    return this.getById(Number(info.lastInsertRowid));
  }

  /**
   * Update an existing product.
   * @param {number} id
   * @param {Record<string, unknown>} patch
   */
  update(id, patch) {
    const existing = this.getById(id);
    if (!existing) return null;

    const name = patch.name !== undefined ? String(patch.name).trim() : existing.name;
    if (!name) {
      throw new Error('Nama produk tidak boleh kosong');
    }
    const category = patch.category !== undefined ? String(patch.category).trim() || 'Produk' : existing.category;
    const variant = patch.variant !== undefined ? String(patch.variant).trim() : existing.variant;
    const price = patch.price !== undefined ? Math.max(0, Math.round(Number(patch.price))) : existing.price;
    const stock = patch.stock !== undefined ? Math.max(0, Math.round(Number(patch.stock))) : existing.stock;
    const isActive =
      patch.is_active !== undefined
        ? patch.is_active === false || Number(patch.is_active) === 0
          ? 0
          : 1
        : existing.is_active;
    const imageUrl = patch.image_url !== undefined ? String(patch.image_url).trim() : existing.image_url;
    const notes = patch.notes !== undefined ? String(patch.notes).trim() : existing.notes;
    const updatedAt = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE products
         SET name = ?, category = ?, variant = ?, price = ?, stock = ?, is_active = ?, image_url = ?, notes = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(name, category, variant, price, stock, isActive, imageUrl, notes, updatedAt, Number(id));

    return this.getById(id);
  }

  /**
   * Adjust stock by delta (e.g. +1 or -1), clamped at 0.
   * @param {number} id
   * @param {number} delta
   */
  adjustStock(id, delta) {
    const existing = this.getById(id);
    if (!existing) return null;
    const nextStock = Math.max(0, existing.stock + Math.round(Number(delta || 0)));
    return this.update(id, { stock: nextStock });
  }

  /**
   * Delete a product by id.
   * @param {number} id
   * @returns {boolean}
   */
  remove(id) {
    const info = this.db.prepare('DELETE FROM products WHERE id = ?').run(Number(id));
    return info.changes > 0;
  }

  /**
   * Format live SQLite product catalog into a clear text block for the CS AI system prompt.
   * @returns {string}
   */
  formatForPrompt() {
    const items = this.list();
    if (items.length === 0) {
      return 'Belum ada data produk di database katalog.';
    }

    const lines = items.map((item) => {
      const label = item.variant ? `${item.name} (${item.variant})` : item.name;
      const available = item.is_active === 1 && item.stock > 0;
      const statusText = available
        ? `TERSEDIA (Stok: ${item.stock} pcs)`
        : 'HABIS / TIDAK TERSEDIA (Stok: 0)';
      const photoPart = item.image_url ? 'Foto: ADA' : 'Foto: belum ada';
      const notePart = item.notes ? ` | Catatan: ${item.notes}` : '';
      return `- [ID:${item.id}] [${item.category}] ${label} | Harga: ${formatRupiah(item.price)} | Status: ${statusText} | ${photoPart}${notePart}`;
    });

    return lines.join('\n');
  }

  // --- COD Orders (Titik STK) ---

  /**
   * List COD orders ordered by newest first.
   */
  listCodOrders() {
    return this.db
      .prepare(
        `SELECT id, customer_name, customer_phone, product_name, qty, cod_date, cod_time, location, status, notes, created_at, updated_at
         FROM cod_orders
         ORDER BY CASE status WHEN 'menunggu' THEN 0 WHEN 'selesai' THEN 1 ELSE 2 END, cod_date ASC, cod_time ASC, id DESC`
      )
      .all();
  }

  /**
   * Create a new COD order at STK.
   * @param {{ customer_name?: string, customer_phone?: string, product_name: string, qty?: number, cod_date?: string, cod_time: string, location?: string, notes?: string }} input
   */
  createCodOrder(input) {
    const productName = String(input?.product_name || '').trim();
    const codTime = String(input?.cod_time || '').trim();
    if (!productName) {
      throw new Error('Produk COD wajib dipilih');
    }
    if (!codTime) {
      throw new Error('Jam COD wajib diisi');
    }

    const customerName = String(input?.customer_name || 'Pembeli WA').trim() || 'Pembeli WA';
    const customerPhone = String(input?.customer_phone || '').trim();
    const qty = Math.max(1, Math.round(Number(input?.qty || 1)));
    const codDate = String(input?.cod_date || new Date().toISOString().slice(0, 10)).trim();
    const location =
      String(input?.location || 'STK Sedulur Tunggal Kopi (STK KUSBANG)').trim() ||
      'STK Sedulur Tunggal Kopi (STK KUSBANG)';
    const notes = String(input?.notes || '').trim();
    const now = new Date().toISOString();

    const info = this.db
      .prepare(
        `INSERT INTO cod_orders (customer_name, customer_phone, product_name, qty, cod_date, cod_time, location, status, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'menunggu', ?, ?, ?)`
      )
      .run(customerName, customerPhone, productName, qty, codDate, codTime, location, notes, now, now);

    return this.db.prepare('SELECT * FROM cod_orders WHERE id = ?').get(Number(info.lastInsertRowid));
  }

  /**
   * Update COD order status ('menunggu' | 'selesai' | 'batal').
   * @param {number} id
   * @param {string} status
   */
  updateCodStatus(id, status) {
    const allowed = new Set(['menunggu', 'selesai', 'batal']);
    const normalized = String(status || '').trim().toLowerCase();
    if (!allowed.has(normalized)) {
      throw new Error('Status COD harus menunggu, selesai, atau batal');
    }
    const existing = this.db.prepare('SELECT id FROM cod_orders WHERE id = ?').get(Number(id));
    if (!existing) return null;

    this.db
      .prepare('UPDATE cod_orders SET status = ?, updated_at = ? WHERE id = ?')
      .run(normalized, new Date().toISOString(), Number(id));
    return this.db.prepare('SELECT * FROM cod_orders WHERE id = ?').get(Number(id));
  }

  /**
   * Delete a COD order by id.
   * @param {number} id
   * @returns {boolean}
   */
  removeCodOrder(id) {
    const info = this.db.prepare('DELETE FROM cod_orders WHERE id = ?').run(Number(id));
    return info.changes > 0;
  }

  // --- Games, Systems & PC Recommendations Knowledge Base ---

  /**
   * Import JSON knowledge files from `product_json/` into SQLite tables.
   * @param {string} jsonDir
   * @returns {{ systems: number, games: number, hasPcKb: boolean }}
   */
  importProductJsonDir(jsonDir) {
    const resolvedDir = path.resolve(jsonDir);
    if (!fs.existsSync(resolvedDir)) {
      return { systems: 0, games: 0, hasPcKb: false };
    }

    const gamesPath = path.join(resolvedDir, 'all_games_and_min_specs.json');
    const emusPath = path.join(resolvedDir, 'ready_emulators.json');
    const pcKbPath = path.join(resolvedDir, 'batocera_pc_recommendations_kb.json');

    const emuMap = new Map();
    if (fs.existsSync(emusPath)) {
      const emusJson = JSON.parse(fs.readFileSync(emusPath, 'utf8'));
      for (const sys of emusJson.ready_systems || []) {
        if (sys?.system) {
          emuMap.set(String(sys.system).toLowerCase(), sys);
        }
      }
    }

    let systemsCount = 0;
    let gamesCount = 0;
    let hasPcKb = false;

    this.db.exec('BEGIN');
    try {
      if (fs.existsSync(gamesPath)) {
        const gamesJson = JSON.parse(fs.readFileSync(gamesPath, 'utf8'));
        const systemsObj = gamesJson.systems || {};

        this.db.exec('DELETE FROM games_kb; DELETE FROM systems_kb;');
        const insertSys = this.db.prepare(
          `INSERT INTO systems_kb (system_code, fullname, hardware, game_count, min_cpu, min_ram, min_gpu, emulator, bios_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        const insertGame = this.db.prepare(
          `INSERT INTO games_kb (system_code, title, raw_name, size_mb, sources)
           VALUES (?, ?, ?, ?, ?)`
        );

        for (const [rawCode, info] of Object.entries(systemsObj)) {
          const code = String(rawCode).toLowerCase();
          const emuMeta = emuMap.get(code);
          const specs = info?.minimum_specs || {};
          const gamesList = Array.isArray(info?.games) ? info.games : [];

          insertSys.run(
            code,
            emuMeta?.fullname || code.toUpperCase(),
            emuMeta?.hardware || '',
            Number(info?.count ?? gamesList.length),
            String(specs.cpu || ''),
            String(specs.ram || ''),
            String(specs.gpu || ''),
            String(specs.emulator || emuMeta?.default_emulator || ''),
            String(emuMeta?.bios_status || '')
          );
          systemsCount++;

          for (const g of gamesList) {
            const rawName = String(g?.name || '').trim();
            if (!rawName) continue;
            insertGame.run(
              code,
              cleanGameTitle(rawName),
              rawName,
              Number(g?.size_mb || 0),
              Array.isArray(g?.sources) ? g.sources.join(',') : ''
            );
            gamesCount++;
          }
        }
      }

      if (fs.existsSync(pcKbPath)) {
        const pcKbRaw = fs.readFileSync(pcKbPath, 'utf8');
        this.db
          .prepare('INSERT OR REPLACE INTO kb_docs (key, content) VALUES (?, ?)')
          .run('pc_recommendations', pcKbRaw);
        hasPcKb = true;
      }

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    return { systems: systemsCount, games: gamesCount, hasPcKb };
  }

  /**
   * Check whether games_kb already has imported rows.
   */
  hasGameKnowledge() {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM games_kb').get();
    return Number(row?.count || 0) > 0;
  }

  /**
   * List systems that have games (> 0).
   */
  listSystemsWithGames() {
    return this.db
      .prepare('SELECT * FROM systems_kb WHERE game_count > 0 ORDER BY game_count DESC, system_code ASC')
      .all();
  }

  /**
   * Search games by title or system_code.
   * @param {{ query?: string, system?: string, limit?: number }} [opts]
   */
  searchGames({ query = '', system = '', limit = 30 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit || 30), 200));
    const q = String(query || '').trim();
    const sys = String(system || '').trim().toLowerCase();

    if (sys && q) {
      return this.db
        .prepare('SELECT id, system_code, title, raw_name, size_mb FROM games_kb WHERE system_code = ? AND title LIKE ? ORDER BY title ASC LIMIT ?')
        .all(sys, `%${q}%`, safeLimit);
    }
    if (sys) {
      return this.db
        .prepare('SELECT id, system_code, title, raw_name, size_mb FROM games_kb WHERE system_code = ? ORDER BY title ASC LIMIT ?')
        .all(sys, safeLimit);
    }
    if (q) {
      return this.db
        .prepare('SELECT id, system_code, title, raw_name, size_mb FROM games_kb WHERE title LIKE ? ORDER BY title ASC LIMIT ?')
        .all(`%${q}%`, safeLimit);
    }
    return this.db
      .prepare('SELECT id, system_code, title, raw_name, size_mb FROM games_kb ORDER BY id DESC LIMIT ?')
      .all(safeLimit);
  }

  /**
   * Search games with smart pagination metadata (`total`, `page`, `limit`, `totalPages`).
   * @param {{ query?: string, system?: string, page?: number, limit?: number }} [opts]
   */
  searchGamesPaginated({ query = '', system = '', page = 1, limit = 25 } = {}) {
    const safeLimit = Math.max(1, Math.min(Number(limit || 25), 100));
    const q = String(query || '').trim();
    const sys = String(system || '').trim().toLowerCase();

    const whereParts = [];
    const params = [];
    if (sys) {
      whereParts.push('system_code = ?');
      params.push(sys);
    }
    if (q) {
      whereParts.push('title LIKE ?');
      params.push(`%${q}%`);
    }
    const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM games_kb ${whereSql}`)
      .get(...params);
    const total = Number(countRow?.total || 0);
    const totalPages = Math.max(1, Math.ceil(total / safeLimit));
    const safePage = Math.max(1, Math.min(Number(page || 1), totalPages));
    const offset = (safePage - 1) * safeLimit;

    const games = this.db
      .prepare(
        `SELECT id, system_code, title, raw_name, size_mb
         FROM games_kb ${whereSql}
         ORDER BY title ASC, id ASC
         LIMIT ? OFFSET ?`
      )
      .all(...params, safeLimit, offset);

    return { games, total, page: safePage, limit: safeLimit, totalPages };
  }

  /**
   * Add a game to games_kb and update systems_kb count.
   * @param {{ system_code: string, title: string, size_mb?: number }} input
   */
  createGame(input) {
    const systemCode = String(input?.system_code || '').trim().toLowerCase();
    const title = String(input?.title || '').trim();
    if (!systemCode) throw new Error('Kode konsol/sistem wajib diisi');
    if (!title) throw new Error('Judul game wajib diisi');
    const sizeMb = Math.max(0, Number(input?.size_mb || 0));

    const info = this.db
      .prepare('INSERT INTO games_kb (system_code, title, raw_name, size_mb, sources) VALUES (?, ?, ?, ?, ?)')
      .run(systemCode, title, title, sizeMb, 'manual');

    this.db
      .prepare(
        `INSERT INTO systems_kb (system_code, fullname, game_count) VALUES (?, ?, 1)
         ON CONFLICT(system_code) DO UPDATE SET game_count = (SELECT COUNT(*) FROM games_kb WHERE system_code = ?)`
      )
      .run(systemCode, systemCode.toUpperCase(), systemCode);

    return this.db.prepare('SELECT id, system_code, title, raw_name, size_mb FROM games_kb WHERE id = ?').get(Number(info.lastInsertRowid));
  }

  /**
   * Update a game in games_kb.
   * @param {number} id
   * @param {{ system_code?: string, title?: string, size_mb?: number }} patch
   */
  updateGame(id, patch) {
    const existing = this.db.prepare('SELECT * FROM games_kb WHERE id = ?').get(Number(id));
    if (!existing) return null;
    const systemCode = patch.system_code !== undefined ? String(patch.system_code).trim().toLowerCase() : existing.system_code;
    const title = patch.title !== undefined ? String(patch.title).trim() : existing.title;
    if (!systemCode || !title) throw new Error('Konsol dan judul game wajib diisi');
    const sizeMb = patch.size_mb !== undefined ? Math.max(0, Number(patch.size_mb)) : existing.size_mb;

    this.db
      .prepare('UPDATE games_kb SET system_code = ?, title = ?, size_mb = ? WHERE id = ?')
      .run(systemCode, title, sizeMb, Number(id));
    return this.db.prepare('SELECT id, system_code, title, raw_name, size_mb FROM games_kb WHERE id = ?').get(Number(id));
  }

  /**
   * Delete a game from games_kb.
   * @param {number} id
   */
  removeGame(id) {
    const existing = this.db.prepare('SELECT system_code FROM games_kb WHERE id = ?').get(Number(id));
    if (!existing) return false;
    const info = this.db.prepare('DELETE FROM games_kb WHERE id = ?').run(Number(id));
    this.db
      .prepare('UPDATE systems_kb SET game_count = (SELECT COUNT(*) FROM games_kb WHERE system_code = ?) WHERE system_code = ?')
      .run(existing.system_code, existing.system_code);
    return info.changes > 0;
  }

  /**
   * Get PC recommendations KB JSON object.
   */
  getPcKb() {
    const row = this.db.prepare("SELECT content FROM kb_docs WHERE key = 'pc_recommendations'").get();
    if (!row?.content) return null;
    return JSON.parse(row.content);
  }

  /**
   * Save PC recommendations KB JSON.
   * @param {unknown} data
   */
  savePcKb(data) {
    const parsed = typeof data === 'string' ? JSON.parse(data) : data;
    if (!parsed || typeof parsed !== 'object') {
      throw new Error('Format JSON KB spek PC tidak valid');
    }
    this.db
      .prepare("INSERT OR REPLACE INTO kb_docs (key, content) VALUES ('pc_recommendations', ?)")
      .run(JSON.stringify(parsed, null, 2));
    return parsed;
  }

  // --- Cached Laptop Specs KB ---

  /**
   * Find cached laptop specs by normalized model key.
   * @param {string} modelKey
   */
  getLaptopSpec(modelKey) {
    const key = String(modelKey || '').trim().toLowerCase();
    if (!key) return null;
    return this.db
      .prepare('SELECT id, model_key, model_name, specs_text, source, updated_at FROM laptop_specs_kb WHERE model_key = ?')
      .get(key) || null;
  }

  /**
   * Save or update searched laptop specs in SQLite.
   * @param {{ model_key: string, model_name?: string, specs_text: string, source?: string }} input
   */
  saveLaptopSpec({ model_key, model_name, specs_text, source = 'web' }) {
    const key = String(model_key || '').trim().toLowerCase();
    const text = String(specs_text || '').trim();
    if (!key || !text) return null;
    const name = String(model_name || key).trim();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO laptop_specs_kb (model_key, model_name, specs_text, source, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(model_key) DO UPDATE SET
           model_name = excluded.model_name,
           specs_text = excluded.specs_text,
           source = excluded.source,
           updated_at = excluded.updated_at`
      )
      .run(key, name, text, source, now);

    return this.getLaptopSpec(key);
  }

  listLaptopSpecs() {
    return this.db
      .prepare('SELECT id, model_key, model_name, specs_text, source, updated_at FROM laptop_specs_kb ORDER BY updated_at DESC, id DESC')
      .all();
  }

  removeLaptopSpec(id) {
    const info = this.db.prepare('DELETE FROM laptop_specs_kb WHERE id = ?').run(Number(id));
    return info.changes > 0;
  }

  /**
   * Build compact, relevant game/system/PC-spec context for a buyer's message.
   * @param {string} userMessage
   * @returns {string}
   */
  formatGameKnowledgeForPrompt(userMessage = '') {
    const systems = this.listSystemsWithGames();
    if (systems.length === 0) return '';

    const sections = [];
    const totalGames = systems.reduce((acc, s) => acc + s.game_count, 0);

    sections.push(`Total game di database: ${totalGames} game di ${systems.length} konsol/platform:`);
    sections.push(
      systems
        .map((s) => `- ${s.system_code} (${s.fullname}): ${s.game_count} game | Min spek: CPU ${s.min_cpu}, RAM ${s.min_ram}, GPU ${s.min_gpu}`)
        .join('\n')
    );

    const tokens = extractSearchTokens(userMessage);
    if (tokens.length > 0) {
      const matchedMap = new Map();
      for (const token of tokens) {
        const bySys = this.db
          .prepare('SELECT id, system_code, title, size_mb FROM games_kb WHERE system_code = ? LIMIT 15')
          .all(token);
        for (const g of bySys) matchedMap.set(g.id, g);

        const byTitle = this.db
          .prepare('SELECT id, system_code, title, size_mb FROM games_kb WHERE title LIKE ? LIMIT 15')
          .all(`%${token}%`);
        for (const g of byTitle) matchedMap.set(g.id, g);
      }

      const matches = [...matchedMap.values()].slice(0, 25);
      if (matches.length > 0) {
        const sysSpecMap = new Map(systems.map((s) => [s.system_code, s]));
        sections.push('\nHasil pencarian game yang termasuk dalam paket Plug and Play:');
        sections.push(
          matches
            .map((g) => {
              const sp = sysSpecMap.get(g.system_code);
              const specText = sp
                ? ` | Min spek: CPU ${sp.min_cpu || '-'}, RAM ${sp.min_ram || '-'}, GPU ${sp.min_gpu || '-'}`
                : '';
              return `- ${g.title} (${g.size_mb} MB)${specText}`;
            })
            .join('\n')
        );
      } else if (/(list|daftar|rekomendasi|game apa|apa aja)/i.test(String(userMessage || ''))) {
        const sampleGames = this.db
          .prepare(
            `SELECT g.title, g.size_mb, s.min_cpu, s.min_ram, s.min_gpu
             FROM games_kb g
             LEFT JOIN systems_kb s ON g.system_code = s.system_code
             WHERE g.system_code IN ('psx', 'ps1', 'ps2', 'ps3', 'ps4')
             ORDER BY CASE g.system_code WHEN 'ps4' THEN 1 WHEN 'ps3' THEN 2 WHEN 'ps2' THEN 3 ELSE 4 END, g.id ASC
             LIMIT 30`
          )
          .all();
        if (sampleGames.length > 0) {
          sections.push('\nDaftar game PS1-PS4 di paket Plug and Play (pilih 5 yang paling populer dan sesuai spek laptop pembeli, tanpa Nintendo):');
          sections.push(
            sampleGames
              .map((g) => `- ${g.title} | Min spek: CPU ${g.min_cpu || '-'}, RAM ${g.min_ram || '-'}, GPU ${g.min_gpu || '-'}`)
              .join('\n')
          );
        }
      }
    }

    const pcDoc = this.db.prepare("SELECT content FROM kb_docs WHERE key = 'pc_recommendations'").get();
    if (pcDoc?.content) {
      try {
        const kb = JSON.parse(pcDoc.content);
        const lowerMsg = String(userMessage || '').toLowerCase();
        const isSpecQuery = /(spek|spec|pc|laptop|ram|cpu|gpu|vga|celeron|pentium|i3|i5|i7|ryzen|gtx|rtx|lag|patah|setting|batocera|wine|windows|bezel|keluar|hotkey)/.test(lowerMsg);

        if (isSpecQuery) {
          sections.push('\nPanduan Spek PC & Rekomendasi Setting Batocera:');
          sections.push(JSON.stringify({
            general_rules: kb.general_rules,
            hardware_tiers: kb.hardware_tiers,
            windows_wine_games_kb: kb.windows_wine_games_kb,
            troubleshooting_rules: kb.troubleshooting_rules,
          }));
        } else if (Array.isArray(kb.hardware_tiers)) {
          sections.push('\nRingkasan Tier PC yang Didukung:');
          sections.push(
            kb.hardware_tiers
              .map((t) => `- ${t.label}: ${t.hardware_criteria?.cpu || ''}, RAM ${t.hardware_criteria?.ram || ''}`)
              .join('\n')
          );
        }
      } catch {
        // Ignore malformed KB JSON
      }
    }

    return sections.join('\n');
  }

  close() {
    this.db.close();
  }
}
