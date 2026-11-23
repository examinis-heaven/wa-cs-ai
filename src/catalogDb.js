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

  close() {
    this.db.close();
  }
}
