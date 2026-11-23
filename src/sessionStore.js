import fs from 'node:fs';
import path from 'node:path';

/**
 * Sanitize WhatsApp chatId into a safe filename.
 * @param {string} chatId
 * @returns {string}
 */
function toSafeFilename(chatId) {
  return String(chatId || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_');
}

/**
 * Per-customer conversation history store persisted to disk (`sessions/<chatId>.json`),
 * plus message ID deduplication to guard against duplicate processing.
 */
export class SessionStore {
  /**
   * @param {{ dir?: string, maxMessages?: number, ttlMinutes?: number, maxSeenIds?: number }} [options]
   */
  constructor({ dir = '', maxMessages = 20, ttlMinutes = 1440, maxSeenIds = 2000 } = {}) {
    this.dir = dir ? path.resolve(dir) : '';
    this.maxMessages = maxMessages;
    this.ttlMs = ttlMinutes > 0 ? ttlMinutes * 60 * 1000 : 0;
    this.maxSeenIds = maxSeenIds;
    /** @type {Map<string, { updatedAt: number, messages: Array<{ role: 'user' | 'assistant', content: string, timestamp?: string }> }>} */
    this.chats = new Map();
    /** @type {Set<string>} */
    this.seenMessageIds = new Set();

    if (this.dir) {
      fs.mkdirSync(this.dir, { recursive: true });
    }
  }

  /**
   * @param {string} chatId
   * @returns {string | null}
   */
  #filePath(chatId) {
    if (!this.dir) return null;
    return path.join(this.dir, `${toSafeFilename(chatId)}.json`);
  }

  /**
   * @param {string} chatId
   */
  #loadFromDisk(chatId) {
    const file = this.#filePath(chatId);
    if (!file || !fs.existsSync(file)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed && Array.isArray(parsed.messages)) {
        return {
          updatedAt: Number(parsed.updatedAt) || Date.now(),
          messages: parsed.messages,
        };
      }
    } catch {
      // Ignore corrupted session file and start fresh
    }
    return null;
  }

  /**
   * @param {string} chatId
   * @param {{ updatedAt: number, messages: Array<{ role: 'user' | 'assistant', content: string, timestamp?: string }> }} entry
   */
  #saveToDisk(chatId, entry) {
    const file = this.#filePath(chatId);
    if (!file) return;
    try {
      fs.writeFileSync(
        file,
        JSON.stringify({ chatId, updatedAt: entry.updatedAt, messages: entry.messages }, null, 2),
        'utf8'
      );
    } catch {
      // Avoid crashing chat flow if disk write fails
    }
  }

  /**
   * Returns true if messageId has already been seen; otherwise records it.
   * @param {string | undefined} messageId
   * @returns {boolean}
   */
  markSeenIfNew(messageId) {
    if (!messageId) return false;
    if (this.seenMessageIds.has(messageId)) {
      return true;
    }
    this.seenMessageIds.add(messageId);
    if (this.seenMessageIds.size > this.maxSeenIds) {
      const oldest = this.seenMessageIds.values().next().value;
      this.seenMessageIds.delete(oldest);
    }
    return false;
  }

  /**
   * Get non-expired history messages for a chatId (formatted for LLM `{ role, content }`).
   * @param {string} chatId
   * @returns {Array<{ role: 'user' | 'assistant', content: string }>}
   */
  getHistory(chatId) {
    let entry = this.chats.get(chatId);
    if (!entry) {
      entry = this.#loadFromDisk(chatId);
      if (entry) {
        this.chats.set(chatId, entry);
      }
    }
    if (!entry) return [];

    if (this.ttlMs > 0 && Date.now() - entry.updatedAt > this.ttlMs) {
      this.clear(chatId);
      return [];
    }

    return entry.messages.map(({ role, content }) => ({ role, content }));
  }

  /**
   * Append a user + assistant turn to chat history and persist to disk.
   * @param {string} chatId
   * @param {string} userText
   * @param {string} assistantText
   */
  appendTurn(chatId, userText, assistantText) {
    const existing = this.chats.get(chatId) || this.#loadFromDisk(chatId);
    const baseMessages =
      existing && (this.ttlMs === 0 || Date.now() - existing.updatedAt <= this.ttlMs)
        ? existing.messages
        : [];

    const nowIso = new Date().toISOString();
    const updatedMessages = [
      ...baseMessages,
      { role: 'user', content: userText, timestamp: nowIso },
      { role: 'assistant', content: assistantText, timestamp: nowIso },
    ].slice(-this.maxMessages);

    const entry = {
      updatedAt: Date.now(),
      messages: updatedMessages,
    };
    this.chats.set(chatId, entry);
    this.#saveToDisk(chatId, entry);
  }

  /**
   * Clear history for a chatId in memory and on disk.
   * @param {string} chatId
   */
  clear(chatId) {
    this.chats.delete(chatId);
    const file = this.#filePath(chatId);
    if (file && fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch {
        // Ignore unlink error
      }
    }
  }
}
