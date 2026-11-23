import os from 'node:os';
import path from 'node:path';
import 'dotenv/config';
import pkg from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { createConfig } from './config.js';
import { createLogger } from './logger.js';
import { CatalogDb } from './catalogDb.js';
import { KnowledgeLoader } from './knowledge.js';
import { RouterLLMClient } from './llm.js';
import { SessionStore } from './sessionStore.js';
import { CustomerServiceBot } from './bot.js';
import { createTestServer } from './server.js';

const { Client, LocalAuth, Location, MessageMedia } = pkg;

const config = createConfig();
const logger = createLogger({ dir: config.logDir, level: config.logLevel });
const catalogDb = new CatalogDb(config.catalogDbPath);
const knowledge = new KnowledgeLoader(config.skillPath, null, catalogDb);
const llm = new RouterLLMClient({
  baseUrl: config.routerBaseUrl,
  apiKey: config.routerApiKey,
  model: config.routerModel,
  fallbackModels: config.routerFallbackModels,
  timeoutMs: config.routerTimeoutMs,
  logger,
});
const sessions = new SessionStore({
  dir: config.sessionDir,
  maxMessages: config.maxHistoryMessages,
  ttlMinutes: config.historyTtlMinutes,
});

let waStatus = 'initializing';

const client = new Client({
  authStrategy: new LocalAuth({
    clientId: config.wwebjsClientId,
    dataPath: config.wwebjsDataPath,
  }),
  puppeteer: {
    headless: config.wwebjsHeadless,
    ...(config.wwebjsExecutablePath ? { executablePath: config.wwebjsExecutablePath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
});

const bot = new CustomerServiceBot({
  config,
  knowledge,
  llm,
  sessions,
  catalogDb,
  sendMessage: (chatId, text) => client.sendMessage(chatId, text, { sendSeen: false }),
  sendLocation: (chatId, loc) =>
    client.sendMessage(
      chatId,
      new Location(loc.lat, loc.lng, { name: loc.name }),
      { sendSeen: false }
    ),
  sendImage: async (chatId, product) => {
    const caption = product.variant ? `${product.name} (${product.variant})` : product.name;
    let media;
    if (product.image_url.startsWith('/uploads/')) {
      const filePath = path.resolve('data', 'uploads', path.basename(product.image_url));
      media = MessageMedia.fromFilePath(filePath);
    } else {
      media = await MessageMedia.fromUrl(product.image_url, { unsafeMime: true });
    }
    return client.sendMessage(chatId, media, { caption, sendSeen: false });
  },
  logger,
});

client.on('qr', (qr) => {
  waStatus = 'waiting_qr';
  logger.log('[WA] QR code baru dibuat. Silakan scan dengan WhatsApp di HP (Perangkat Tertaut).');
  qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
  waStatus = 'authenticated';
  logger.log(
    `[WA] Berhasil login! Session tersimpan di "${config.wwebjsDataPath}" (clientId: ${config.wwebjsClientId}).`
  );
});

client.on('auth_failure', (msg) => {
  waStatus = 'auth_failure';
  logger.error('[WA] Autentikasi gagal:', msg);
});

client.on('ready', () => {
  waStatus = 'ready';
  logger.log('[WA] WhatsApp Client siap menerima pesan CS!');
});

client.on('change_state', (state) => {
  logger.log(`[WA] State berubah: ${state}`);
});

client.on('disconnected', (reason) => {
  waStatus = `disconnected:${reason}`;
  logger.warn('[WA] Koneksi WhatsApp terputus:', reason);
});

client.on('message', async (message) => {
  await bot.handleIncomingMessage(message);
});

const app = createTestServer({
  config,
  bot,
  llm,
  sessions,
  catalogDb,
  getWaStatus: () => waStatus,
  logger,
});

app.listen(config.port, '0.0.0.0', () => {
  logger.log(`Server lokal aktif di http://localhost:${config.port}`);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) {
        logger.log(`- Akses LAN/HP : http://${net.address}:${config.port}/`);
      }
    }
  }
  logger.log(`- Dashboard    : http://localhost:${config.port}/`);
  logger.log(`- Health Check : http://localhost:${config.port}/health`);
  logger.log(`- Test Chat    : http://localhost:${config.port}/test-chat`);
  logger.log(`- Logs Viewer  : http://localhost:${config.port}/logs?type=error`);
  logger.log(`- Log Folder   : ${logger.dir}`);
  logger.log(
    `- 9router      : ${config.routerBaseUrl} (model: ${config.routerModel}, fallback: ${config.routerFallbackModels.join(', ') || '-'})`
  );
});

logger.log('[WA] Memulai whatsapp-web.js (memuat session tersimpan atau menyiapkan QR)...');
client.initialize().catch((err) => {
  logger.error('[WA] Gagal menginisialisasi WhatsApp client:', err);
});

process.on('uncaughtException', (err) => {
  logger.error('[SYS] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  logger.error('[SYS] Unhandled Rejection:', reason);
});

const shutdown = async () => {
  logger.log('[SYS] Menutup WhatsApp client...');
  await client.destroy().catch((err) => logger.error('[SYS] Error saat destroy client:', err));
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
