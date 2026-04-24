import { describe, test, expect } from 'bun:test';

import { embeddingConfigFromEnv } from '../src/core/embedding.ts';
import {
  parseExpansionJson,
  queryExpansionConfigFromEnv,
} from '../src/core/search/expansion.ts';

describe('embeddingConfigFromEnv', () => {
  test('defaults to OpenAI text-embedding-3-large at 1536 dimensions', () => {
    const config = embeddingConfigFromEnv({});

    expect(config.model).toBe('text-embedding-3-large');
    expect(config.dimensions).toBe(1536);
    expect(config.apiKey).toBeUndefined();
    expect(config.baseURL).toBeUndefined();
  });

  test('supports SiliconFlow-compatible embedding config', () => {
    const config = embeddingConfigFromEnv({
      SILICONFLOW_API_KEY: 'sf-key',
      GBRAIN_EMBEDDING_BASE_URL: 'https://api.siliconflow.cn/v1',
      GBRAIN_EMBEDDING_MODEL: 'Qwen/Qwen3-Embedding-8B',
      GBRAIN_EMBEDDING_DIMENSIONS: '1536',
    });

    expect(config.apiKey).toBe('sf-key');
    expect(config.baseURL).toBe('https://api.siliconflow.cn/v1');
    expect(config.model).toBe('Qwen/Qwen3-Embedding-8B');
    expect(config.dimensions).toBe(1536);
  });
});

describe('queryExpansionConfigFromEnv', () => {
  test('defaults to Anthropic Haiku', () => {
    const config = queryExpansionConfigFromEnv({});

    expect(config.provider).toBe('anthropic');
    expect(config.model).toBe('claude-haiku-4-5-20251001');
  });

  test('supports DeepSeek through the OpenAI-compatible path', () => {
    const config = queryExpansionConfigFromEnv({
      DEEPSEEK_API_KEY: 'ds-key',
      GBRAIN_QUERY_EXPANSION_MODEL: 'deepseek-v4-flash',
      GBRAIN_QUERY_EXPANSION_BASE_URL: 'https://api.deepseek.com',
    });

    expect(config.provider).toBe('openai_compatible');
    expect(config.apiKey).toBe('ds-key');
    expect(config.baseURL).toBe('https://api.deepseek.com');
    expect(config.model).toBe('deepseek-v4-flash');
  });
});

describe('parseExpansionJson', () => {
  test('parses strict JSON', () => {
    expect(parseExpansionJson('{"alternative_queries":["a","b"]}')).toEqual({
      alternative_queries: ['a', 'b'],
    });
  });

  test('extracts JSON object from wrapped text', () => {
    expect(parseExpansionJson('```json\n{"alternative_queries":["a"]}\n```')).toEqual({
      alternative_queries: ['a'],
    });
  });
});
