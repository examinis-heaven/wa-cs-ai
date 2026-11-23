import fs from 'node:fs';
import path from 'node:path';

/**
 * Find installed Chrome or Edge executable on Windows/Linux/macOS if not explicitly set.
 * @returns {string | undefined}
 */
function detectBrowserExecutable() {
  const candidates = [
    process.env.WWEBJS_EXECUTABLE_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
      : '',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter(Boolean);

  return candidates.find((p) => fs.existsSync(p));
}

/**
 * Build runtime configuration from environment variables with optional overrides.
 * @param {Record<string, unknown>} [overrides]
 */
export function createConfig(overrides = {}) {
  const env = process.env;
  return {
    port: Number(env.PORT || 3001),
    wwebjsClientId: env.WWEBJS_CLIENT_ID || 'cs-bot',
    wwebjsDataPath: env.WWEBJS_DATA_PATH || '.wwebjs_auth',
    wwebjsHeadless: env.WWEBJS_HEADLESS !== 'false',
    wwebjsExecutablePath: detectBrowserExecutable(),
    routerBaseUrl: (env.ROUTER_BASE_URL || 'http://127.0.0.1:20128/v1').replace(/\/+$/, ''),
    routerApiKey: env.ROUTER_API_KEY || '',
    routerModel: env.ROUTER_MODEL || 'CS',
    routerTimeoutMs: Number(env.ROUTER_TIMEOUT_MS || 90000),
    routerFallbackModels: (env.ROUTER_FALLBACK_MODELS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    skillPath: env.SKILL_PATH || path.resolve('skills', 'cs-produk-marketplace', 'SKILL.md'),
    knowledgePath: env.KNOWLEDGE_PATH || path.resolve('skills', 'cs-produk-marketplace', 'references', 'produk.md'),
    sessionDir: env.SESSION_DIR || 'sessions',
    catalogDbPath: env.CATALOG_DB_PATH || path.resolve('data', 'catalog.db'),
    messageDebounceMs: Number(env.MESSAGE_DEBOUNCE_MS ?? 10000),
    maxHistoryMessages: Number(env.MAX_HISTORY_MESSAGES || 20),
    historyTtlMinutes: Number(env.HISTORY_TTL_MINUTES ?? 1440),
    ownerNotifyChatId: env.OWNER_NOTIFY_CHAT_ID || '',
    logDir: env.LOG_DIR || 'logs',
    logLevel: env.LOG_LEVEL || 'info',
    locations: {
      cod: {
        lat: env.LOCATION_COD_LAT ? Number(env.LOCATION_COD_LAT) : null,
        lng: env.LOCATION_COD_LNG ? Number(env.LOCATION_COD_LNG) : null,
        name: env.LOCATION_COD_NAME || 'STK Sedulur Tunggal Kopi (STK KUSBANG)',
        url: env.LOCATION_COD_URL || 'https://maps.google.com/?q=-7.2513688,112.749925',
      },
    },
    ...overrides,
  };
}
