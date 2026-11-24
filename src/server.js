import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import express from 'express';

const require = createRequire(import.meta.url);
const QRCodeMatrix = require('qrcode-terminal/vendor/QRCode');
const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_HTML_PATH = path.resolve(__dirname, '..', 'public', 'dashboard.html');
const UPLOADS_DIR = path.resolve(__dirname, '..', 'data', 'uploads');

function renderQrSvg(text) {
  if (!text) return null;
  try {
    const qr = new QRCodeMatrix(-1, QRErrorCorrectLevel.L);
    qr.addData(String(text));
    qr.make();
    const count = qr.getModuleCount();
    const margin = 4;
    const size = count + margin * 2;
    let d = '';
    for (let r = 0; r < count; r += 1) {
      for (let c = 0; c < count; c += 1) {
        if (qr.isDark(r, c)) {
          d += `M${c + margin},${r + margin}h1v1h-1z`;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" style="width:100%;height:100%;display:block;"><rect width="${size}" height="${size}" fill="#ffffff"/><path d="${d}" fill="#000000"/></svg>`;
  } catch {
    return null;
  }
}

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
 *   waControl?: {
 *     getInfo: () => { status: string, qr: string | null, user: { pushname?: string, wid?: string } | null, clientId: string, dataPath: string },
 *     logout: () => Promise<void>,
 *     restart: () => Promise<void>
 *   },
 *   logger?: ReturnType<import('./logger.js').createLogger>
 * }} deps
 */
export function createTestServer({ config, bot, llm, sessions, catalogDb, getWaStatus, waControl, logger }) {
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

  // --- Games & Systems Knowledge Base API ---
  app.get('/api/systems', (_req, res) => {
    if (!catalogDb) {
      return res.status(503).json({ ok: false, error: 'Catalog database tidak aktif' });
    }
    return res.json({ ok: true, systems: catalogDb.listSystemsWithGames() });
  });

  app.get('/api/games', (req, res) => {
    if (!catalogDb) {
      return res.status(503).json({ ok: false, error: 'Catalog database tidak aktif' });
    }
    const query = typeof req.query.q === 'string' ? req.query.q : '';
    const system = typeof req.query.system === 'string' ? req.query.system : '';
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 25);
    const result = catalogDb.searchGamesPaginated({ query, system, page, limit });
    return res.json({ ok: true, ...result });
  });

  app.post('/api/games', (req, res) => {
    if (!catalogDb) return res.status(503).json({ ok: false, error: 'Catalog database tidak aktif' });
    try {
      const game = catalogDb.createGame(req.body || {});
      return res.status(201).json({ ok: true, game });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.put('/api/games/:id', (req, res) => {
    if (!catalogDb) return res.status(503).json({ ok: false, error: 'Catalog database tidak aktif' });
    try {
      const game = catalogDb.updateGame(Number(req.params.id), req.body || {});
      if (!game) return res.status(404).json({ ok: false, error: 'Game tidak ditemukan' });
      return res.json({ ok: true, game });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.delete('/api/games/:id', (req, res) => {
    if (!catalogDb) return res.status(503).json({ ok: false, error: 'Catalog database tidak aktif' });
    const removed = catalogDb.removeGame(Number(req.params.id));
    if (!removed) return res.status(404).json({ ok: false, error: 'Game tidak ditemukan' });
    return res.json({ ok: true });
  });

  app.get('/api/kb/pc', (_req, res) => {
    if (!catalogDb) return res.status(503).json({ ok: false, error: 'Catalog database tidak aktif' });
    return res.json({ ok: true, kb: catalogDb.getPcKb() });
  });

  app.put('/api/kb/pc', (req, res) => {
    if (!catalogDb) return res.status(503).json({ ok: false, error: 'Catalog database tidak aktif' });
    try {
      const kb = catalogDb.savePcKb(req.body?.kb ?? req.body);
      return res.json({ ok: true, kb });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.get('/api/laptops', (_req, res) => {
    if (!catalogDb) return res.status(503).json({ ok: false, error: 'Catalog database tidak aktif' });
    return res.json({ ok: true, laptops: catalogDb.listLaptopSpecs() });
  });

  app.delete('/api/laptops/:id', (req, res) => {
    if (!catalogDb) return res.status(503).json({ ok: false, error: 'Catalog database tidak aktif' });
    const removed = catalogDb.removeLaptopSpec(Number(req.params.id));
    if (!removed) return res.status(404).json({ ok: false, error: 'Data laptop tidak ditemukan' });
    return res.json({ ok: true });
  });

  // --- Per-Customer AI ON/OFF ---
  app.get('/api/customers', (_req, res) => {
    if (!catalogDb) return res.status(503).json({ ok: false, error: 'Catalog database tidak aktif' });
    return res.json({ ok: true, customers: catalogDb.listCustomers() });
  });

  app.patch('/api/customers/:chatId/ai', (req, res) => {
    if (!catalogDb) return res.status(503).json({ ok: false, error: 'Catalog database tidak aktif' });
    if (req.body?.enabled === undefined) {
      return res.status(400).json({ ok: false, error: 'Field "enabled" wajib diisi (true/false)' });
    }
    try {
      const chatId = decodeURIComponent(req.params.chatId);
      const customer = catalogDb.setCustomerAiEnabled(chatId, Boolean(req.body.enabled));
      return res.json({ ok: true, customer });
    } catch (err) {
      return res.status(400).json({ ok: false, error: err.message });
    }
  });

  // --- WhatsApp Login & Session Control ---
  app.get('/api/wa/status', (_req, res) => {
    if (waControl && typeof waControl.getInfo === 'function') {
      const info = waControl.getInfo();
      return res.json({
        ok: true,
        ...info,
        qrSvg: info?.qr ? renderQrSvg(info.qr) : null,
      });
    }
    return res.json({
      ok: true,
      status: getWaStatus(),
      qr: null,
      qrSvg: null,
      user: null,
      clientId: config.wwebjsClientId,
      dataPath: config.wwebjsDataPath,
    });
  });

  app.post('/api/wa/logout', async (_req, res) => {
    if (!waControl?.logout) return res.status(503).json({ ok: false, error: 'Kontrol WA tidak aktif' });
    try {
      await waControl.logout();
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.post('/api/wa/restart', async (_req, res) => {
    if (!waControl?.restart) return res.status(503).json({ ok: false, error: 'Kontrol WA tidak aktif' });
    try {
      await waControl.restart();
      return res.json({ ok: true });
    } catch (err) {
      return res.status(500).json({ ok: false, error: err.message });
    }
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
