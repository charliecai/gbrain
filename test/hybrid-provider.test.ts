import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  __setEmbedTransportForTests,
  configureGateway,
  resetGateway,
} from '../src/core/ai/gateway.ts';
import { buildGatewayConfig } from '../src/core/ai/build-gateway-config.ts';

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
    resetGateway();
    __setEmbedTransportForTests(async ({ values }: any) => ({
      embeddings: values.map(() => new Array(1536).fill(0)),
      usage: { tokens: 0 },
    }) as any);
    delete process.env.OPENAI_API_KEY;
    delete process.env.GBRAIN_EMBEDDING_API_KEY;
    delete process.env.GBRAIN_EMBED_API_KEY;
    delete process.env.SILICONFLOW_API_KEY;
    delete process.env.GBRAIN_EMBEDDING_MODEL;
    delete process.env.GBRAIN_EMBED_MODEL;
    delete process.env.GBRAIN_EMBEDDING_DIMENSIONS;
    delete process.env.GBRAIN_EMBED_DIMENSIONS;
    delete process.env.GBRAIN_EMBEDDING_BASE_URL;
    delete process.env.GBRAIN_EMBED_BASE_URL;
  });

  afterEach(() => {
    __setEmbedTransportForTests(null);
    resetGateway();
    restoreEnv();
  });

  test('runs vector search when only SILICONFLOW_API_KEY is configured', async () => {
    process.env.SILICONFLOW_API_KEY = '1';
    configureGateway(buildGatewayConfig({ engine: 'pglite' } as any));

    const { hybridSearch } = await import('../src/core/search/hybrid.ts');
    const { engine, calls } = makeEngine();

    await hybridSearch(engine, 'semantic query', { limit: 5, expansion: false });

    expect(calls.keyword).toBe(1);
    expect(calls.vector).toBe(1);
  });

  test('runs vector search when only GBRAIN_EMBEDDING_API_KEY is configured', async () => {
    process.env.GBRAIN_EMBEDDING_API_KEY = '1';
    configureGateway(buildGatewayConfig({ engine: 'pglite' } as any));

    const { hybridSearch } = await import('../src/core/search/hybrid.ts');
    const { engine, calls } = makeEngine();

    await hybridSearch(engine, 'semantic query', { limit: 5, expansion: false });

    expect(calls.keyword).toBe(1);
    expect(calls.vector).toBe(1);
  });
});
