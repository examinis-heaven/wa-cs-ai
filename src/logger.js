import fs from 'node:fs';
import path from 'node:path';

const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Format local timestamp as YYYY-MM-DD HH:mm:ss.SSS
 * @param {Date} [date]
 * @returns {{ dateStr: string, timestamp: string }}
 */
function formatTimestamp(date = new Date()) {
  const pad = (n, len = 2) => String(n).padStart(len, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  const ss = pad(date.getSeconds());
  const ms = pad(date.getMilliseconds(), 3);
  return {
    dateStr: `${y}-${m}-${d}`,
    timestamp: `${y}-${m}-${d} ${hh}:${mm}:${ss}.${ms}`,
  };
}

/**
 * Serialize extra arguments (including Error stack traces) into a readable string.
 * @param {unknown[]} args
 * @returns {string}
 */
function formatArgs(args) {
  return args
    .map((arg) => {
      if (arg instanceof Error) {
        return arg.stack || `${arg.name}: ${arg.message}`;
      }
      if (typeof arg === 'object' && arg !== null) {
        try {
          return JSON.stringify(arg);
        } catch {
          return String(arg);
        }
      }
      return String(arg);
    })
    .join(' ');
}

/**
 * Create a console + daily file logger (`app-YYYY-MM-DD.log` and `error-YYYY-MM-DD.log`).
 * @param {{ dir?: string, level?: string, silentConsole?: boolean }} [options]
 */
export function createLogger({ dir = 'logs', level = 'info', silentConsole = false } = {}) {
  const minLevel = LEVELS[level.toLowerCase()] ?? LEVELS.info;
  const resolvedDir = path.resolve(dir);
  fs.mkdirSync(resolvedDir, { recursive: true });

  /**
   * @param {'debug' | 'info' | 'warn' | 'error'} lvl
   * @param {unknown[]} args
   */
  function write(lvl, args) {
    if (LEVELS[lvl] < minLevel) return;

    const { dateStr, timestamp } = formatTimestamp();
    const msg = formatArgs(args);
    const line = `[${timestamp}] [${lvl.toUpperCase()}] ${msg}`;

    if (!silentConsole) {
      if (lvl === 'error') {
        console.error(line);
      } else if (lvl === 'warn') {
        console.warn(line);
      } else {
        console.log(line);
      }
    }

    try {
      fs.appendFileSync(path.join(resolvedDir, `app-${dateStr}.log`), `${line}\n`, 'utf8');
      if (LEVELS[lvl] >= LEVELS.warn) {
        fs.appendFileSync(path.join(resolvedDir, `error-${dateStr}.log`), `${line}\n`, 'utf8');
      }
    } catch {
      // Avoid crashing app if disk write fails
    }
  }

  return {
    dir: resolvedDir,
    debug: (...args) => write('debug', args),
    info: (...args) => write('info', args),
    log: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
    /**
     * Read last N lines from today's app or error log.
     * @param {{ type?: 'app' | 'error', lines?: number }} [opts]
     * @returns {string[]}
     */
    readRecent({ type = 'app', lines = 100 } = {}) {
      const { dateStr } = formatTimestamp();
      const prefix = type === 'error' ? 'error' : 'app';
      const filePath = path.join(resolvedDir, `${prefix}-${dateStr}.log`);
      if (!fs.existsSync(filePath)) return [];
      const content = fs.readFileSync(filePath, 'utf8');
      const allLines = content.split(/\r?\n/).filter(Boolean);
      return allLines.slice(-Math.max(1, Math.min(lines, 500)));
    },
  };
}
