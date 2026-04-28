import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

mock.module('../src/core/embedding.ts', () => ({
  embed: async (_text: string) => new Float32Array([1, 0, 0]),
  embeddingConfigFromEnv: (env: NodeJS.ProcessEnv = process.env) => ({
    model: 'test-model',
    dimensions: 3,
    apiKey: env.GBRAIN_EMBEDDING_API_KEY || env.GBRAIN_EMBED_API_KEY || env.SILICONFLOW_API_KEY || env.OPENAI_API_KEY,
    baseURL: env.GBRAIN_EMBEDDING_BASE_URL || env.GBRAIN_EMBED_BASE_URL || env.OPENAI_BASE_URL,
  }),
}));

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function makeEngine() {
  const calls = { vector: 0, keyword: 0 };
  const engine = {
    async searchKeyword(_query: string, _opts?: unknown) {
      calls.keyword += 1;
      return [{
        slug: 'keyword-page',
        page_id: 1,
        title: 'Keyword Page',
        type: 'concept',
        chunk_text: 'keyword result',
        chunk_source: 'body',
        chunk_id: 1,
        chunk_index: 0,
        score: 0.2,
        stale: false,
      }];
    },
    async searchVector(_embedding: Float32Array, _opts?: unknown) {
      calls.vector += 1;
      return [{
        slug: 'vector-page',
        page_id: 2,
        title: 'Vector Page',
        type: 'concept',
        chunk_text: 'vector result',
        chunk_source: 'body',
        chunk_id: 2,
        chunk_index: 0,
        score: 0.9,
        stale: false,
      }];
    },
    async getBacklinkCounts(_slugs: string[]) {
      return new Map<string, number>();
    },
    async getEmbeddingsByChunkIds(_ids: number[]) {
      return new Map<number, Float32Array>();
    },
  };
  return { engine: engine as any, calls };
}

describe('hybridSearch embedding provider gate', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.GBRAIN_EMBEDDING_API_KEY;
    delete process.env.GBRAIN_EMBED_API_KEY;
    delete process.env.SILICONFLOW_API_KEY;
  });

  afterEach(() => {
    restoreEnv();
  });

  test('runs vector search when only SILICONFLOW_API_KEY is configured', async () => {
    process.env.SILICONFLOW_API_KEY = '1';

    const { hybridSearch } = await import('../src/core/search/hybrid.ts');
    const { engine, calls } = makeEngine();

    await hybridSearch(engine, 'semantic query', { limit: 5, expansion: false });

    expect(calls.keyword).toBe(1);
    expect(calls.vector).toBe(1);
  });

  test('runs vector search when only GBRAIN_EMBEDDING_API_KEY is configured', async () => {
    process.env.GBRAIN_EMBEDDING_API_KEY = '1';

    const { hybridSearch } = await import('../src/core/search/hybrid.ts');
    const { engine, calls } = makeEngine();

    await hybridSearch(engine, 'semantic query', { limit: 5, expansion: false });

    expect(calls.keyword).toBe(1);
    expect(calls.vector).toBe(1);
  });
});
