import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_HTML_PATH = path.resolve(__dirname, '..', 'public', 'dashboard.html');
const UPLOADS_DIR = path.resolve(__dirname, '..', 'data', 'uploads');

/**
 * Local HTTP server for single-page product catalog dashboard,
 * health checks, logs, and testing AI replies.
 * @param {{
 *   config: ReturnType<import('./config.js').createConfig>,
 *   bot: import('./bot.js').CustomerServiceBot,
 *   llm: import('./llm.js').RouterLLMClient,
 *   sessions: import('./sessionStore.js').SessionStore,
 *   catalogDb?: import('./catalogDb.js').CatalogDb,
 *   getWaStatus: () => string,
 *   logger?: ReturnType<import('./logger.js').createLogger>
 * }} deps
 */
export function createTestServer({ config, bot, llm, sessions, catalogDb, getWaStatus, logger }) {
  const app = express();
  app.use(express.json({ limit: '5mb' }));
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  app.use('/uploads', express.static(UPLOADS_DIR));

  const sendDashboard = (_req, res) => {
    res.sendFile(DASHBOARD_HTML_PATH);
  };
  app.get('/', sendDashboard);
  app.get('/dashboard', sendDashboard);

  app.post('/api/upload', (req, res) => {
    const dataUrl = typeof req.body?.dataUrl === 'string' ? req.body.dataUrl : '';
    const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([A-Za-z0-9+/=]+)$/i);
    if (!match) {
      return res.status(400).json({ ok: false, error: 'Format gambar harus PNG, JPG, WEBP, atau GIF' });
    }
    const ext = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase();
    const filename = `prod-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), Buffer.from(match[2], 'base64'));
    return res.status(201).json({ ok: true, url: `/uploads/${filename}` });
  });

  app.get('/health', async (_req, res) => {
    const routerHealth = await llm.healthCheck();
    res.json({
      status: 'ok',
      whatsapp: getWaStatus(),
      model: config.routerModel,
      router: routerHealth,
    });
  });

  // --- SQLite Product Catalog API ---
  app.get('/api/products', (_req, res) => {
    if (!catalogDb) {
      return res.status(503).json({ ok: false, error: 'Catalog database tidak aktif' });
    }
    return res.json({ ok: true, products: catalogDb.list() });
  });

  app.post('/api/products', (req, res) => {
    if (!catalogDb) {
      return res.status(503).json({ ok: false, error: 'Catalog database tidak aktif' });
    }
    try {
      const product = catalogDb.create(req.body || {});
      return res.status(201).json({ ok: true, product });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/products/:id', (req, res) => {
    if (!catalogDb) {
      return res.status(503).json({ ok: false, error: 'Catalog database tidak aktif' });
    }
    try {
      const updated = catalogDb.update(Number(req.params.id), req.body || {});
      if (!updated) {
        return res.status(404).json({ ok: false, error: 'Produk tidak ditemukan' });
      }
      return res.json({ ok: true, product: updated });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.patch('/api/products/:id/stock', (req, res) => {
    if (!catalogDb) {
      return res.status(503).json({ ok: false, error: 'Catalog database tidak aktif' });
    }
    const id = Number(req.params.id);
    const hasDelta = req.body?.delta !== undefined;
    const hasStock = req.body?.stock !== undefined;
    if (!hasDelta && !hasStock) {
      return res.status(400).json({ ok: false, error: 'Kirim field "delta" atau "stock"' });
    }

    const updated = hasDelta
      ? catalogDb.adjustStock(id, Number(req.body.delta))
      : catalogDb.update(id, { stock: Number(req.body.stock) });

    if (!updated) {
      return res.status(404).json({ ok: false, error: 'Produk tidak ditemukan' });
    }
    return res.json({ ok: true, product: updated });
  });

  app.delete('/api/products/:id', (req, res) => {
    if (!catalogDb) {
      return res.status(503).json({ ok: false, error: 'Catalog database tidak aktif' });
    }
    const removed = catalogDb.remove(Number(req.params.id));
    if (!removed) {
      return res.status(404).json({ ok: false, error: 'Produk tidak ditemukan' });
    }
    return res.json({ ok: true });
  });

  // --- COD Orders API (Titik STK) ---
  app.get('/api/cod', (_req, res) => {
    if (!catalogDb) {
      return res.status(503).json({ ok: false, error: 'Catalog database tidak aktif' });
    }
    return res.json({ ok: true, orders: catalogDb.listCodOrders() });
  });

  app.post('/api/cod', (req, res) => {
    if (!catalogDb) {
      return res.status(503).json({ ok: false, error: 'Catalog database tidak aktif' });
    }
    try {
      const order = catalogDb.createCodOrder(req.body || {});
      return res.status(201).json({ ok: true, order });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.patch('/api/cod/:id/status', (req, res) => {
    if (!catalogDb) {
      return res.status(503).json({ ok: false, error: 'Catalog database tidak aktif' });
    }
    try {
      const updated = catalogDb.updateCodStatus(Number(req.params.id), req.body?.status);
      if (!updated) {
        return res.status(404).json({ ok: false, error: 'Jadwal COD tidak ditemukan' });
      }
      return res.json({ ok: true, order: updated });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/cod/:id', (req, res) => {
    if (!catalogDb) {
      return res.status(503).json({ ok: false, error: 'Catalog database tidak aktif' });
    }
    const removed = catalogDb.removeCodOrder(Number(req.params.id));
    if (!removed) {
      return res.status(404).json({ ok: false, error: 'Jadwal COD tidak ditemukan' });
    }
    return res.json({ ok: true });
  });

  app.post('/test-chat', async (req, res) => {
    const chatId =
      typeof req.body?.chatId === 'string' && req.body.chatId.trim()
        ? req.body.chatId.trim()
        : 'local-test';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';

    if (!message) {
      return res.status(400).json({ ok: false, error: 'Field "message" wajib diisi' });
    }

    try {
      const result = await bot.generateReply({ chatId, text: message });
      return res.json({ ok: true, chatId, ...result });
    } catch (err) {
      return res.status(502).json({ ok: false, error: err.message });
    }
  });

  app.post('/test-chat/reset', (req, res) => {
    const chatId =
      typeof req.body?.chatId === 'string' && req.body.chatId.trim()
        ? req.body.chatId.trim()
        : 'local-test';
    sessions.clear(chatId);
    return res.json({ ok: true, cleared: chatId });
  });

  app.get('/logs', (req, res) => {
    if (!logger || typeof logger.readRecent !== 'function') {
      return res.status(404).json({ ok: false, error: 'File logger tidak aktif' });
    }
    const type = req.query.type === 'error' ? 'error' : 'app';
    const lines = Number(req.query.lines || 100);
    return res.json({
      ok: true,
      type,
      dir: logger.dir,
      lines: logger.readRecent({ type, lines }),
    });
  });

  return app;
}
