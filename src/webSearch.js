const LAPTOP_TRIGGER_RE =
  /\b(laptop|notebook|thinkpad|ideapad|vivobook|zenbook|tuf|rog|asus|acer|nitro|aspire|swift|lenovo|hp|pavilion|victus|omen|dell|latitude|inspiron|vostro|msi|axioo|advan|zyrex|macbook|kuat|angkat|lancar|spek|spec)\b/i;

const searchCache = new Map();

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract Bing `<li class="b_algo">` snippets into concise plain text.
 * @param {string} html
 * @returns {string}
 */
export function parseBingSnippets(html) {
  const snippets = [];
  const algoMatches = html.match(/<li class="b_algo"[\s\S]*?<\/li>/gi) || [];
  for (const block of algoMatches.slice(0, 4)) {
    const pMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const titleMatch = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i);
    const title = titleMatch ? stripHtml(titleMatch[1]) : '';
    const body = pMatch ? stripHtml(pMatch[1]) : stripHtml(block);
    const line = [title, body].filter(Boolean).join(' — ').slice(0, 220);
    if (line) snippets.push(`- ${line}`);
  }
  return snippets.join('\n');
}

/**
 * Determine if the conversation is asking about a laptop/PC model's capability.
 * @param {string} currentMessage
 * @param {Array<{ role: string, content: string }>} [history]
 * @returns {string | null}
 */
export function extractLaptopQuery(currentMessage, history = []) {
  const combined = [
    ...history.slice(-4).filter((m) => m.role === 'user').map((m) => m.content),
    currentMessage,
  ]
    .join(' ')
    .trim();

  if (!LAPTOP_TRIGGER_RE.test(combined)) {
    return null;
  }

  // Extract a concise query focusing on the laptop brand/model terms
  const modelMatch = combined.match(
    /(thinkpad|ideapad|vivobook|zenbook|tuf|rog|nitro|aspire|swift|pavilion|victus|omen|latitude|inspiron|vostro|macbook|asus|acer|lenovo|hp|dell|msi|axioo|advan|zyrex)\s+[a-z0-9\-]+(?:\s+[a-z0-9\-]+)?/i
  );
  if (modelMatch) {
    const cleaned = modelMatch[0]
      .replace(/\s+\b(kuat|angkat|lancar|bisa|ga|gak|nggak|kak|ram|ini|itu)\b/gi, '')
      .trim();
    return `${cleaned} specs processor GPU`;
  }
  return null;
}

/**
 * Search Bing (with Wikipedia fallback) for laptop CPU/GPU specifications.
 * @param {string} query
 * @returns {Promise<string>}
 */
export async function searchLaptopSpecs(query) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) return '';
  if (searchCache.has(cleanQuery)) {
    return searchCache.get(cleanQuery);
  }

  try {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(cleanQuery)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept-Language': 'en-US,id;q=0.9',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const html = await res.text();
      const parsed = parseBingSnippets(html);
      if (parsed) {
        searchCache.set(cleanQuery, parsed);
        return parsed;
      }
    }
  } catch {
    // Fallback to Wikipedia API below
  }

  try {
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanQuery.replace(/\s+specs.*$/i, ''))}&format=json`;
    const res = await fetch(wikiUrl, { signal: AbortSignal.timeout(4000) });
    if (res.ok) {
      const json = await res.json();
      const hits = (json?.query?.search || []).slice(0, 2);
      const text = hits.map((h) => `- ${h.title}: ${stripHtml(h.snippet)}`).join('\n');
      if (text) {
        searchCache.set(cleanQuery, text);
        return text;
      }
    }
  } catch {
    // Ignore search failure gracefully
  }

  return '';
}
