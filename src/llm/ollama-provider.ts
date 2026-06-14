// @ts-nocheck
export class OllamaProvider {
  constructor({
    baseUrl = 'http://127.0.0.1:11434',
    apiKey,
    model,
    headers = {},
    defaults = {}
  } = {}) {
    if (!model) throw new TypeError('OllamaProvider requires model');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.apiKey = apiKey;
    this.model = model;
    this.headers = headers;
    this.defaults = defaults;
  }

  async generate({ messages, temperature, maxTokens, extra = {} }) {
    const options = {
      ...(isPlainObject(this.defaults.options) ? this.defaults.options : {}),
      ...(isPlainObject(extra.options) ? extra.options : {})
    };
    if (temperature !== undefined) options.temperature = temperature;
    if (maxTokens !== undefined) options.num_predict = maxTokens;

    const payload = {
      ...this.defaults,
      ...extra,
      model: this.model,
      messages: messages.map(toOllamaMessage),
      stream: false
    };
    if (Object.keys(options).length > 0) {
      payload.options = options;
    }

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        ...this.headers
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama chat failed: ${response.status} ${body}`);
    }

    const json = await response.json();
    const content = json.message?.content ?? json.response;
    if (typeof content !== 'string') {
      throw new Error('Ollama chat response did not include message content');
    }

    return {
      content,
      raw: json
    };
  }
}

function toOllamaMessage(message = {}) {
  return {
    role: message.role,
    content: String(message.content || '')
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
