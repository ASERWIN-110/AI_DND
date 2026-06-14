// @ts-nocheck
export class OpenAICompatibleEmbeddingProvider {
  constructor({
    baseUrl = 'https://api.openai.com/v1',
    apiKey,
    model = 'text-embedding-3-small',
    dimensions,
    headers = {},
    fetchImpl = globalThis.fetch,
    version
  } = {}) {
    if (!fetchImpl) throw new TypeError('OpenAICompatibleEmbeddingProvider requires fetch');
    this.baseUrl = String(baseUrl || '').replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.model = model;
    this.dimensions = dimensions;
    this.headers = headers;
    this.fetchImpl = fetchImpl;
    this.provider = 'openai-compatible';
    this.version = version || `${this.provider}:${this.model}:${this.dimensions || 'default'}`;
  }

  static fromEnv(env = process.env) {
    return new OpenAICompatibleEmbeddingProvider({
      baseUrl: env.AI_DND_EMBEDDING_BASE_URL || env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      apiKey: env.AI_DND_EMBEDDING_API_KEY || env.OPENAI_API_KEY,
      model: env.AI_DND_EMBEDDING_MODEL || 'text-embedding-3-small',
      dimensions: env.AI_DND_EMBEDDING_DIMENSIONS ? Number(env.AI_DND_EMBEDDING_DIMENSIONS) : undefined
    });
  }

  describe() {
    return {
      provider: this.provider,
      model: this.model,
      dimensions: this.dimensions,
      version: this.version
    };
  }

  async embed(text) {
    const body = {
      model: this.model,
      input: String(text || '')
    };
    if (Number.isInteger(this.dimensions) && this.dimensions > 0) {
      body.dimensions = this.dimensions;
    }

    const response = await this.fetchImpl(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
        ...this.headers
      },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Embedding request failed (${response.status}): ${detail.slice(0, 500)}`);
    }
    const payload = await response.json();
    const vector = payload?.data?.[0]?.embedding;
    if (!Array.isArray(vector)) throw new Error('Embedding response did not include data[0].embedding');
    if (!this.dimensions) this.dimensions = vector.length;
    return vector;
  }
}
