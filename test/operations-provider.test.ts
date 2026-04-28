import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const importCalls: Array<{ slug: string; content: string; noEmbed?: boolean }> = [];

mock.module('../src/core/import-file.ts', () => ({
  importFromContent: async (_engine: unknown, slug: string, content: string, opts: { noEmbed?: boolean } = {}) => {
    importCalls.push({ slug, content, noEmbed: opts.noEmbed });
    return {
      slug,
      status: 'imported',
      chunks: 1,
    };
  },
  importFromFile: async () => {
    throw new Error('not used in this test');
  },
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

function makeContext() {
  return {
    engine: {},
    config: {},
    logger: {
      info() {},
      warn() {},
      error() {},
    },
    remote: false,
  } as any;
}

describe('put_page embedding provider gate', () => {
  beforeEach(() => {
    importCalls.length = 0;
    delete process.env.OPENAI_API_KEY;
    delete process.env.GBRAIN_EMBEDDING_API_KEY;
    delete process.env.GBRAIN_EMBED_API_KEY;
    delete process.env.SILICONFLOW_API_KEY;
  });

  afterEach(() => {
    restoreEnv();
  });

  test('does not skip embedding when only GBRAIN_EMBEDDING_API_KEY is configured', async () => {
    process.env.GBRAIN_EMBEDDING_API_KEY = '1';

    const { operationsByName } = await import('../src/core/operations.ts');
    const putOp = operationsByName['put_page'];

    await putOp.handler(makeContext(), {
      slug: 'notes/provider-gate',
      content: '---\ntype: note\ntitle: Provider Gate\n---\n\nEmbedding should run.',
    });

    expect(importCalls).toHaveLength(1);
    expect(importCalls[0].noEmbed).toBe(false);
  });
});
