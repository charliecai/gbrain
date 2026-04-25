import { describe, test, expect } from 'bun:test';
import { parseLocalTranscriptionOutput } from '../src/core/transcription.ts';

describe('local transcription noisy stdout parsing', () => {
  test('uses trailing JSON payload when ASR prints logs before JSON', () => {
    const output = [
      'funasr version: 1.3.1.',
      'Downloading Model from modelscope...',
      JSON.stringify({
        text: '嗯。',
        language: 'zh',
        duration: 1,
        segments: [{ start: 0, end: 1, text: '嗯。' }],
      }),
    ].join('\n');

    const result = parseLocalTranscriptionOutput(output, 'sensevoice');
    expect(result.provider).toBe('sensevoice');
    expect(result.language).toBe('zh');
    expect(result.text).toBe('嗯。');
    expect(result.duration).toBe(1);
  });
});
