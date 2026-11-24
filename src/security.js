const MAX_USER_MESSAGE_LENGTH = 1500;

const INJECTION_PATTERNS = [
  /ignore\s+(?:(?:all|any|previous|prior)\s+)*instructions?/i,
  /disregard\s+(?:(?:all|any|previous|prior)\s+)*instructions?/i,
  /forget\s+(everything|(?:(?:all|previous)\s+)*instructions?)/i,
  /abaikan\s+(?:(?:semua|segala)\s+)?(?:instruksi|aturan|perintah)(?:\s+sebelumnya)?/i,
  /lupakan\s+(?:(?:semua|segala)\s+)?(?:instruksi|aturan|perintah)(?:\s+sebelumnya)?/i,
  /(reveal|show|print|dump|output|repeat)\s+(your\s+|the\s+)?(system\s*prompt|instructions?|prompt|rules?)/i,
  /(tampilkan|sebutkan|bocorkan|keluarkan|tulis\s+ulang)\s+(isi\s+)?(system\s*prompt|prompt\s*sistem|instruksi\s*sistem|aturan\s*rahasia|produk\.md|skill\.md)/i,
  /you\s+are\s+now\s+(a|an|in)\s+(developer|dan|jailbreak|unrestricted|admin|linux|terminal)/i,
  /sekarang\s+kamu\s+(adalah|berperan\s+sebagai)\s+(ai\s+bebas|developer|hacker|terminal|admin)/i,
  /(^|\n)\s*(system|developer)\s*:\s*/i,
  /<\|im_start\|>|<\|system\|>|<<SYS>>|<\/SYS>/i,
];

const OUTPUT_LEAK_PATTERNS = [
  /Konteks Channel:\s*WhatsApp Direct Chat/i,
  /Batas harga terendah\s*\(RAHASIA\)/i,
  /Isi File\s*`?references\/produk\.md`?/i,
  /Aturan keras:/i,
];

export const SAFE_INJECTION_REPLY =
  'Maaf kak, saya hanya bisa bantu info seputar konsol game Plug and Play dan pemesanannya ya 🙏 Ada paket yang mau ditanyakan?';

/**
 * Strip fake control tags and cap message length before sending to LLM.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeUserMessage(text) {
  return String(text || '')
    .replace(/\[(?:ESKALASI|SHARELOK|COD_BOOKING|KIRIM_FOTO)\s*:[^\]]*\]/gi, '')
    .replace(/<\|[^|]{1,30}\|>/g, '')
    .replace(/<<\/?SYS>>/gi, '')
    .trim()
    .slice(0, MAX_USER_MESSAGE_LENGTH);
}

/**
 * Detect high-confidence prompt injection or system-prompt exfiltration attempts.
 * @param {string} text
 * @returns {{ detected: boolean, reason: string | null }}
 */
export function detectPromptInjection(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return { detected: false, reason: null };
  }

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(normalized)) {
      return { detected: true, reason: `matched:${pattern.source}` };
    }
  }

  return { detected: false, reason: null };
}

/**
 * Check whether an LLM output accidentally leaks internal system prompt sections.
 * @param {string} text
 * @returns {boolean}
 */
export function hasInternalPromptLeak(text) {
  const value = String(text || '');
  return OUTPUT_LEAK_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * Remove Markdown/WhatsApp asterisk wrappers (`**teks**` or `*teks*`) so replies stay plain text.
 * @param {string} text
 * @returns {string}
 */
export function stripAsteriskFormatting(text) {
  return String(text || '')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1');
}

/**
 * Ensure WhatsApp replies are easy to read on mobile:
 * split inline `- item` lists onto separate lines and normalize spacing.
 * @param {string} text
 * @returns {string}
 */
export function formatWhatsAppReadability(text) {
  return String(text || '')
    .replace(/\s*\(?\bsuper\s*lite\b\)?/gi, '')
    // Break ": - Item" onto a new line
    .replace(/:\s+-\s+/g, ':\n- ')
    // Break inline " - Item" when preceded by sentence/punctuation or another list item
    .replace(/([.!?\u{1F300}-\u{1FAFF}])\s+-\s+/gu, '$1\n\n- ')
    // Break remaining inline " - <Capital/Digit>" list items onto new lines
    .replace(/([^\n-])\s+-\s+(?=[A-Z0-9])/g, '$1\n- ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
