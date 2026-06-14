// @ts-nocheck
export class OpenAICompatibleProvider {
  constructor({
    baseUrl = 'https://api.openai.com/v1',
    apiKey,
    model,
    headers = {},
    defaults = {}
  } = {}) {
    if (!model) throw new TypeError('OpenAICompatibleProvider requires model');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.model = model;
    this.headers = headers;
    this.defaults = defaults;
  }

  async generate({ messages, temperature, maxTokens, extra = {} }) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        ...this.headers
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature,
        max_tokens: maxTokens,
        ...this.defaults,
        ...extra
      })
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Chat completion failed: ${response.status} ${body}`);
    }

    const json = await response.json();
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new Error('Chat completion response did not include message content');
    }

    return {
      content,
      raw: json
    };
  }

  static fromEnv(env = process.env) {
    return new OpenAICompatibleProvider({
      baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
      defaults: env.OPENAI_DEFAULTS ? JSON.parse(env.OPENAI_DEFAULTS) : {}
    });
  }
}

