import fs from 'node:fs';
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
if (!catalogDb.hasGameKnowledge()) {
  const imported = catalogDb.importProductJsonDir(path.resolve('product_json'));
  if (imported.games > 0 || imported.hasPcKb) {
    logger.log(
      `[KB] Imported product_json ke SQLite: ${imported.systems} sistem, ${imported.games} game, PC KB=${imported.hasPcKb}`
    );
  }
}
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
let latestQr = null;
/** @type {import('whatsapp-web.js').Client | null} */
let client = null;

function buildWaClient() {
  const instance = new Client({
    authStrategy: new LocalAuth({
      clientId: config.wwebjsClientId,
      dataPath: config.wwebjsDataPath,
    }),
    authTimeoutMs: 60000,
    puppeteer: {
      headless: config.wwebjsHeadless,
      ...(config.wwebjsExecutablePath ? { executablePath: config.wwebjsExecutablePath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    },
  });

  instance.on('qr', (qr) => {
    waStatus = 'waiting_qr';
    latestQr = qr;
    logger.log('[WA] QR code baru dibuat. Silakan scan dengan WhatsApp di HP (Perangkat Tertaut) atau buka Dashboard.');
    qrcode.generate(qr, { small: true });
  });

  instance.on('authenticated', () => {
    waStatus = 'authenticated';
    latestQr = null;
    logger.log(
      `[WA] Berhasil login! Session tersimpan di "${config.wwebjsDataPath}" (clientId: ${config.wwebjsClientId}).`
    );
  });

  instance.on('auth_failure', (msg) => {
    waStatus = 'auth_failure';
    latestQr = null;
    logger.error('[WA] Autentikasi gagal:', msg);
  });

  instance.on('ready', () => {
    waStatus = 'ready';
    latestQr = null;
    logger.log('[WA] WhatsApp Client siap menerima pesan CS!');
  });

  instance.on('change_state', (state) => {
    logger.log(`[WA] State berubah: ${state}`);
  });

  instance.on('disconnected', (reason) => {
    waStatus = `disconnected:${reason}`;
    latestQr = null;
    logger.warn('[WA] Koneksi WhatsApp terputus:', reason);
  });

  instance.on('message', async (message) => {
    await bot.handleIncomingMessage(message);
  });

  return instance;
}

const bot = new CustomerServiceBot({
  config,
  knowledge,
  llm,
  sessions,
  catalogDb,
  sendMessage: (chatId, text) => {
    if (!client) throw new Error('WhatsApp client belum siap');
    return client.sendMessage(chatId, text, { sendSeen: false });
  },
  sendLocation: (chatId, loc) => {
    if (!client) throw new Error('WhatsApp client belum siap');
    return client.sendMessage(
      chatId,
      new Location(loc.lat, loc.lng, { name: loc.name }),
      { sendSeen: false }
    );
  },
  sendImage: async (chatId, product) => {
    if (!client) throw new Error('WhatsApp client belum siap');
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

function startWaClient() {
  waStatus = 'initializing';
  latestQr = null;
  client = buildWaClient();
  logger.log('[WA] Memulai whatsapp-web.js (memuat session tersimpan atau menyiapkan QR)...');
  client.initialize().catch((err) => {
    waStatus = `error:${err.message || 'init_failed'}`;
    logger.error('[WA] Gagal menginisialisasi WhatsApp client:', err);
  });
}

async function closeClientSafely(targetClient) {
  if (!targetClient) return;
  try {
    await Promise.race([
      targetClient.logout().catch(() => {}),
      new Promise((r) => setTimeout(r, 3000)),
    ]);
  } catch {
    // ignore logout error
  }
  try {
    await targetClient.destroy().catch(() => {});
  } catch {
    // ignore destroy error
  }
  try {
    await targetClient.pupBrowser?.close?.().catch(() => {});
  } catch {
    // ignore browser close error
  }
}

function removeSavedSessions(dataPath) {
  const targets = [path.resolve(dataPath), path.resolve('.wwebjs_cache')];
  for (const dir of targets) {
    if (!fs.existsSync(dir)) continue;
    for (let i = 0; i < 5; i++) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
        break;
      } catch {
        // Wait briefly if Windows still holds lock
      }
    }
  }
}

const waControl = {
  getInfo: () => ({
    status: waStatus,
    qr: latestQr,
    user: client?.info
      ? {
          pushname: client.info.pushname || '',
          wid: client.info.wid?.user || '',
        }
      : null,
    clientId: config.wwebjsClientId,
    dataPath: config.wwebjsDataPath,
  }),
  logout: async () => {
    logger.log('[WA] Logout diminta: menghapus seluruh session tersimpan...');
    waStatus = 'logging_out';
    latestQr = null;
    const prev = client;
    client = null;
    await closeClientSafely(prev);
    setTimeout(() => {
      removeSavedSessions(config.wwebjsDataPath);
      logger.log(`[WA] Session "${config.wwebjsDataPath}" dihapus. Memulai client baru untuk QR...`);
      startWaClient();
    }, 2000);
  },
  restart: async () => {
    logger.log('[WA] Restart client diminta dari dashboard...');
    waStatus = 'restarting';
    latestQr = null;
    const prev = client;
    client = null;
    if (prev) {
      await prev.destroy().catch(() => {});
      await prev.pupBrowser?.close?.().catch(() => {});
    }
    setTimeout(() => startWaClient(), 1500);
  },
};

const app = createTestServer({
  config,
  bot,
  llm,
  sessions,
  catalogDb,
  getWaStatus: () => waStatus,
  waControl,
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

startWaClient();

process.on('uncaughtException', (err) => {
  logger.error('[SYS] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  logger.error('[SYS] Unhandled Rejection:', reason);
});

const shutdown = async () => {
  logger.log('[SYS] Menutup WhatsApp client...');
  if (client) {
    await client.destroy().catch((err) => logger.error('[SYS] Error saat destroy client:', err));
  }
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
