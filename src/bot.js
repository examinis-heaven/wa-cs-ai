import { parseEscalationTag } from './knowledge.js';
import { extractLaptopQuery, searchLaptopSpecs } from './webSearch.js';
import {
  SAFE_INJECTION_REPLY,
  detectPromptInjection,
  formatWhatsAppReadability,
  hasInternalPromptLeak,
  sanitizeUserMessage,
  stripAsteriskFormatting,
} from './security.js';

const NON_PRIVATE_SUFFIXES = ['@g.us', '@broadcast', '@newsletter'];

/**
 * Format Indonesian WhatsApp number (`628...`) to `08...` for easy WA search.
 * @param {string} rawNumber
 * @returns {string}
 */
export function formatDisplayPhone(rawNumber) {
  const digits = String(rawNumber || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('62')) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

/**
 * Core WhatsApp AI Customer Service orchestrator for whatsapp-web.js.
 */
export class CustomerServiceBot {
  /**
   * @param {{
   *   config: ReturnType<import('./config.js').createConfig>,
   *   knowledge: import('./knowledge.js').KnowledgeLoader,
   *   llm: import('./llm.js').RouterLLMClient,
   *   sessions: import('./sessionStore.js').SessionStore,
   *   catalogDb?: import('./catalogDb.js').CatalogDb | null,
   *   sendMessage: (chatId: string, text: string) => Promise<unknown>,
   *   sendLocation?: (chatId: string, loc: { lat: number, lng: number, name: string, url: string }) => Promise<unknown>,
   *   sendImage?: (chatId: string, product: { id: number, name: string, variant: string, image_url: string }) => Promise<unknown>,
   *   logger?: Pick<Console, 'log' | 'warn' | 'error'>
   * }} deps
   */
  constructor({ config, knowledge, llm, sessions, catalogDb = null, sendMessage, sendLocation, sendImage, searchSpecs = searchLaptopSpecs, logger = console }) {
    this.config = config;
    this.knowledge = knowledge;
    this.llm = llm;
    this.sessions = sessions;
    this.catalogDb = catalogDb;
    this.sendMessage = sendMessage;
    this.sendLocation = sendLocation;
    this.sendImage = sendImage;
    this.searchSpecs = searchSpecs;
    this.logger = logger;
    /** @type {Map<string, Promise<void>>} */
    this.chatQueues = new Map();
    /** @type {Map<string, { items: Array<{ chatId: string, text: string, hasMedia: boolean, rawMessage: any }>, timer: ReturnType<typeof setTimeout> | null, waiters: Array<{ resolve: Function, reject: Function }> }>} */
    this.pendingBatches = new Map();
  }

  /**
   * Validate whether an incoming whatsapp-web.js Message should be answered.
   * @param {any} message
   * @returns {{ ignore: true, reason: string } | { ignore: false, chatId: string, messageId?: string, text: string, hasMedia: boolean, rawMessage: any }}
   */
  parseMessage(message) {
    if (!message || typeof message !== 'object') {
      return { ignore: true, reason: 'empty_message_obj' };
    }

    if (message.fromMe === true) {
      return { ignore: true, reason: 'from_me' };
    }

    const chatId = message.from;
    if (!chatId || typeof chatId !== 'string') {
      return { ignore: true, reason: 'missing_chat_id' };
    }

    if (NON_PRIVATE_SUFFIXES.some((suffix) => chatId.endsWith(suffix))) {
      return { ignore: true, reason: 'non_private_chat' };
    }

    if (message.isStatus === true) {
      return { ignore: true, reason: 'status_message' };
    }

    const messageId =
      typeof message.id?._serialized === 'string'
        ? message.id._serialized
        : typeof message.id === 'string'
          ? message.id
          : undefined;

    if (this.sessions.markSeenIfNew(messageId)) {
      return { ignore: true, reason: 'duplicate_message' };
    }

    const text = typeof message.body === 'string' ? message.body.trim() : '';
    const hasMedia = Boolean(message.hasMedia);

    if (!text && !hasMedia) {
      return { ignore: true, reason: 'empty_message' };
    }

    return {
      ignore: false,
      chatId,
      messageId,
      text,
      hasMedia,
      rawMessage: message,
    };
  }

  /**
   * Generate a reply for a chat message (also used by `/test-chat`).
   * @param {{ chatId: string, text: string, customerPhone?: string, customerName?: string }} params
   * @returns {Promise<{ reply: string, escalation: string | null, shareloks: Array<'rumah' | 'cod'>, codBookings?: Array<any>, blocked?: boolean }>}
   */
  async generateReply({ chatId, text, customerPhone = '', customerName = '' }) {
    const cleanText = sanitizeUserMessage(text);
    const injection = detectPromptInjection(cleanText);
    if (injection.detected) {
      this.logger.warn(`[SECURITY] Prompt injection terdeteksi dari ${chatId} (${injection.reason})`);
      return {
        reply: SAFE_INJECTION_REPLY,
        escalation: `Terdeteksi percobaan prompt injection dari pembeli: "${cleanText.slice(0, 120)}"`,
        shareloks: [],
        blocked: true,
      };
    }

    const history = this.sessions.getHistory(chatId);
    let laptopSpecSnippet = '';
    const laptopQuery = extractLaptopQuery(cleanText, history);
    if (laptopQuery && typeof this.searchSpecs === 'function') {
      laptopSpecSnippet = await this.searchSpecs(laptopQuery).catch(() => '');
      if (laptopSpecSnippet) {
        this.logger.log(`[SEARCH] Spek laptop ditemukan untuk "${laptopQuery}"`);
      }
    }

    const systemPrompt = this.knowledge.getSystemPrompt(cleanText, { laptopSpecSnippet });

    const rawReply = await this.llm.chat({
      systemPrompt,
      history,
      userMessage: cleanText,
    });

    const { reply, escalation, shareloks, codBookings, photoIds } = parseEscalationTag(rawReply);
    if (hasInternalPromptLeak(reply)) {
      this.logger.warn(`[SECURITY] Output diblokir karena potensi kebocoran prompt internal untuk ${chatId}`);
      return {
        reply: SAFE_INJECTION_REPLY,
        escalation: 'Output AI diblokir oleh filter keamanan (indikasi kebocoran instruksi internal)',
        shareloks: [],
        codBookings: [],
        photoIds: [],
        blocked: true,
      };
    }

    if (codBookings.length > 0 && this.catalogDb) {
      const resolvedPhone = formatDisplayPhone(customerPhone) || (chatId.endsWith('@c.us') ? formatDisplayPhone(chatId.replace(/@c\.us$/, '')) : chatId);
      for (const booking of codBookings) {
        try {
          const finalName =
            (!booking.customer_name || booking.customer_name === 'Pembeli WA') && customerName
              ? customerName
              : booking.customer_name;
          this.catalogDb.createCodOrder({
            ...booking,
            customer_name: finalName,
            customer_phone: resolvedPhone,
          });
          this.logger.log(`[COD] Jadwal COD otomatis dicatat: ${finalName} (${resolvedPhone}) | ${booking.product_name} | ${booking.cod_time}`);
        } catch (err) {
          this.logger.warn(`[COD] Gagal mencatat COD otomatis untuk ${chatId}:`, err.message);
        }
      }
    }

    const cleanedReply = formatWhatsAppReadability(stripAsteriskFormatting(reply));
    const finalReply =
      cleanedReply || 'Sebentar ya kak, saya cek dulu barangnya, nanti langsung saya kabari 🙏';

    this.sessions.appendTurn(chatId, cleanText, finalReply);
    return { reply: finalReply, escalation, shareloks, codBookings, photoIds };
  }

  /**
   * Enqueue an incoming whatsapp-web.js Message sequentially per chatId,
   * using per-number debounce (`config.messageDebounceMs`) to merge rapid multi-bubble messages.
   * @param {any} rawMessage
   * @returns {Promise<{ ignored: boolean, reason?: string, mergedCount?: number }>}
   */
  async handleIncomingMessage(rawMessage) {
    const parsed = this.parseMessage(rawMessage);
    if (parsed.ignore) {
      return { ignored: true, reason: parsed.reason };
    }

    const debounceMs = Math.max(0, Number(this.config.messageDebounceMs ?? 0));
    if (debounceMs === 0) {
      await this.#enqueueCombined(parsed.chatId, [parsed]);
      return { ignored: false, mergedCount: 1 };
    }

    return new Promise((resolve, reject) => {
      let batch = this.pendingBatches.get(parsed.chatId);
      if (!batch) {
        batch = { items: [], timer: null, waiters: [] };
        this.pendingBatches.set(parsed.chatId, batch);
      }

      if (batch.timer) {
        clearTimeout(batch.timer);
      }

      batch.items.push(parsed);
      batch.waiters.push({ resolve, reject });

      batch.timer = setTimeout(() => {
        this.pendingBatches.delete(parsed.chatId);
        const items = batch.items;
        const waiters = batch.waiters;
        this.#enqueueCombined(parsed.chatId, items)
          .then(() => {
            for (const w of waiters) w.resolve({ ignored: false, mergedCount: items.length });
          })
          .catch((err) => {
            for (const w of waiters) w.reject(err);
          });
      }, debounceMs);
    });
  }

  /**
   * @param {string} chatId
   * @param {Array<{ chatId: string, text: string, hasMedia: boolean, rawMessage: any }>} items
   */
  async #enqueueCombined(chatId, items) {
    const combinedText = items
      .map((i) => i.text)
      .filter(Boolean)
      .join('\n')
      .trim();
    const hasMedia = items.some((i) => i.hasMedia);
    const lastRawMessage = items[items.length - 1].rawMessage;

    const merged = {
      chatId,
      text: combinedText,
      hasMedia,
      rawMessage: lastRawMessage,
      bubbleCount: items.length,
    };

    const prev = this.chatQueues.get(chatId) || Promise.resolve();
    const next = prev
      .then(() => this.#processMessage(merged))
      .catch((err) => {
        this.logger.error(`[CS] Error processing chat ${chatId}:`, err);
      })
      .finally(() => {
        if (this.chatQueues.get(chatId) === next) {
          this.chatQueues.delete(chatId);
        }
      });

    this.chatQueues.set(chatId, next);
    await next;
  }

  /**
   * @param {{ chatId: string, text: string, hasMedia: boolean, rawMessage: any, bubbleCount?: number }} msg
   */
  async #processMessage(msg) {
    const { chatId, text, hasMedia, rawMessage, bubbleCount = 1 } = msg;
    let chat = null;
    let customerPhone = chatId.endsWith('@c.us') ? chatId.replace(/@c\.us$/, '') : '';
    let customerName = '';

    if (typeof rawMessage?.getContact === 'function') {
      const contact = await rawMessage.getContact().catch(() => null);
      if (contact) {
        if (contact.number) customerPhone = String(contact.number);
        customerName = contact.name || contact.pushname || '';
      }
    }

    const displayPhone = formatDisplayPhone(customerPhone);
    const bubbleInfo = bubbleCount > 1 ? ` (${bubbleCount} bubble digabung)` : '';
    this.logger.log(
      `[CS] Pesan masuk dari ${displayPhone || chatId}${customerName ? ` (${customerName})` : ''}${bubbleInfo}: ${text || '<media tanpa teks>'}`
    );

    try {
      if (typeof rawMessage.getChat === 'function') {
        chat = await rawMessage.getChat().catch(() => null);
      }
      if (chat && typeof chat.sendSeen === 'function') {
        await chat.sendSeen().catch(() => {});
      }
      if (chat && typeof chat.sendStateTyping === 'function') {
        await chat.sendStateTyping().catch(() => {});
      }

      let replyText;
      let escalation = null;
      let shareloks = [];
      let photoIds = [];

      if (!text && hasMedia) {
        replyText =
          'Maaf kak, saya belum bisa memproses gambar/voice note tanpa teks. Boleh diketik pertanyaannya ya kak 🙏';
      } else {
        const result = await this.generateReply({ chatId, text, customerPhone, customerName });
        replyText = result.reply;
        escalation = result.escalation;
        shareloks = result.shareloks || [];
        photoIds = result.photoIds || [];
      }

      await this.sendMessage(chatId, replyText);
      this.logger.log(`[CS] Balasan terkirim ke ${chatId}: ${replyText.replace(/\s+/g, ' ').slice(0, 120)}`);

      if (photoIds.length > 0 && this.catalogDb && typeof this.sendImage === 'function') {
        for (const prodId of photoIds) {
          const product = this.catalogDb.getById(prodId);
          if (product && product.image_url) {
            await this.sendImage(chatId, product).catch((err) => {
              this.logger.warn(`[CS] Gagal kirim foto produk #${prodId} ke ${chatId}:`, err.message);
            });
            this.logger.log(`[CS] Foto produk #${prodId} (${product.name}) terkirim ke ${chatId}`);
          }
        }
      }

      if (shareloks.length > 0 && typeof this.sendLocation === 'function') {
        for (const kind of shareloks) {
          const loc = this.config.locations?.[kind];
          if (loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)) {
            await this.sendLocation(chatId, loc).catch((err) => {
              this.logger.warn(`[CS] Gagal kirim pin lokasi (${kind}) ke ${chatId}:`, err.message);
            });
            this.logger.log(`[CS] Pin lokasi (${kind}) terkirim ke ${chatId}`);
          }
        }
      }

      if (escalation) {
        this.logger.warn(`[ESKALASI] chat=${displayPhone || chatId} | info=${escalation}`);
        if (this.config.ownerNotifyChatId && this.config.ownerNotifyChatId !== chatId) {
          const alertText = [
            '⚠️ *Perlu Konfirmasi Penjual*',
            `Pembeli: ${customerName ? `${customerName} ` : ''}${displayPhone || chatId}`,
            `Pesan: ${text}`,
            `Catatan: ${escalation}`,
          ].join('\n');
          await this.sendMessage(this.config.ownerNotifyChatId, alertText).catch((err) => {
            this.logger.error('[CS] Gagal kirim notifikasi eskalasi ke penjual:', err);
          });
        }
      }
    } catch (err) {
      this.logger.error(`[CS] Gagal membalas ${chatId}:`, err);
      await this.sendMessage(
        chatId,
        'Maaf kak, sistem sedang sibuk sebentar. Boleh kirim ulang pesannya atau tunggu sebentar ya kak 🙏'
      ).catch((sendErr) => {
        this.logger.error(`[CS] Gagal kirim pesan fallback error ke ${chatId}:`, sendErr);
      });
    } finally {
      if (chat && typeof chat.clearState === 'function') {
        await chat.clearState().catch(() => {});
      }
    }
  }
}
