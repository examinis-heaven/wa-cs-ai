/**
 * OpenAI-compatible client for 9router (`/v1/chat/completions`).
 * Supports both `{ choices: [...] }` and `{ data: { choices: [...] } }` envelopes,
 * plus optional fallback models if the primary model fails or times out.
 */
export class RouterLLMClient {
  /**
   * @param {{ baseUrl: string, apiKey: string, model: string, fallbackModels?: string[], timeoutMs?: number, logger?: Pick<Console, 'log' | 'warn' | 'error'> }} config
   */
  constructor({ baseUrl, apiKey, model, fallbackModels = [], timeoutMs = 90000, logger = console }) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.model = model;
    this.fallbackModels = fallbackModels;
    this.timeoutMs = timeoutMs;
    this.logger = logger;
  }

  /**
   * Generate a reply from 9router, trying fallbackModels if the primary model errors.
   * @param {{ systemPrompt: string, history: Array<{ role: string, content: string }>, userMessage: string }} params
   * @returns {Promise<string>}
   */
  async chat({ systemPrompt, history, userMessage }) {
    const modelsToTry = [this.model, ...this.fallbackModels.filter((m) => m !== this.model)];
    let lastError = null;

    for (let i = 0; i < modelsToTry.length; i++) {
      const model = modelsToTry[i];
      try {
        const result = await this.#chatWithModel(model, { systemPrompt, history, userMessage });
        if (i > 0) {
          this.logger.log(`[LLM] Berhasil fallback ke model "${model}"`);
        }
        return result;
      } catch (err) {
        lastError = err;
        const hasNext = i < modelsToTry.length - 1;
        this.logger.warn(
          `[LLM] Model "${model}" gagal (${err.message})${hasNext ? `, mencoba fallback "${modelsToTry[i + 1]}"...` : ''}`
        );
      }
    }

    throw lastError || new Error('9router request failed');
  }

  /**
   * @param {string} model
   * @param {{ systemPrompt: string, history: Array<{ role: string, content: string }>, userMessage: string }} params
   * @returns {Promise<string>}
   */
  async #chatWithModel(model, { systemPrompt, history, userMessage }) {
    const url = `${this.baseUrl}/chat/completions`;
    const headers = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: `<pesan_pembeli>\n${userMessage}\n</pesan_pembeli>` },
    ];

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`9router (${model}) HTTP ${res.status}: ${errBody.slice(0, 300)}`);
    }

    const rawText = await res.text();
    const json = parseRouterResponseText(rawText, model);
    const choices = json?.choices || json?.data?.choices;
    const content = choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new Error(`9router (${model}) returned an empty completion`);
    }
    return content.trim();
  }

  /**
   * Check 9router `/models` endpoint availability.
   * @returns {Promise<{ ok: boolean, status?: number, error?: string }>}
   */
  async healthCheck() {
    try {
      const headers = this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {};
      const res = await fetch(`${this.baseUrl}/models`, {
        headers,
        signal: AbortSignal.timeout(4000),
      });
      return { ok: res.ok, status: res.status };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

/**
 * Parse 9router response body, handling trailing `data: [DONE]` or SSE `data:` lines.
 * @param {string} rawText
 * @param {string} model
 * @returns {any}
 */
export function parseRouterResponseText(rawText, model = 'unknown') {
  const trimmed = rawText.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const cleaned = trimmed
      .replace(/\r?\ndata:\s*\[DONE\]\s*$/i, '')
      .replace(/^data:\s*/i, '')
      .trim();
    try {
      return JSON.parse(cleaned);
    } catch (err) {
      throw new Error(`9router (${model}) invalid JSON response: ${err.message}`);
    }
  }
}
