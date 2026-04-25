import { describe, test, expect } from 'bun:test';
import { mkdtempSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  formatTimestamp,
  renderTranscriptMarkdown,
  parseLocalTranscriptionOutput,
  transcribe,
} from '../src/core/transcription.ts';
import { parseTranscribeArgs } from '../src/commands/transcribe.ts';

describe('local transcription support', () => {
  test('formats timestamps as HH:MM:SS', () => {
    expect(formatTimestamp(0)).toBe('00:00:00');
    expect(formatTimestamp(65.4)).toBe('00:01:05');
    expect(formatTimestamp(10158.01)).toBe('02:49:18');
  });

  test('parses local JSON transcript output with segments', () => {
    const result = parseLocalTranscriptionOutput(JSON.stringify({
      text: '你好，价值投资。',
      language: 'zh',
      duration: 12.5,
      segments: [{ start: 0, end: 12.5, text: '你好，价值投资。' }],
    }), 'sensevoice');

    expect(result.provider).toBe('sensevoice');
    expect(result.language).toBe('zh');
    expect(result.duration).toBe(12.5);
    expect(result.segments[0].text).toBe('你好，价值投资。');
  });

  test('renders transcript markdown with frontmatter, media path, and timestamped segments', () => {
    const md = renderTranscriptMarkdown({
      title: '投资必看！李录演讲：全球价值投资与时代',
      source: 'http://xhslink.com/o/azGlFxprJH',
      mediaPath: '/tmp/li-lu.mp4',
      tags: ['li-lu', 'value-investing', 'transcript'],
      result: {
        text: '长期主义。安全边际。',
        language: 'zh',
        duration: 65,
        provider: 'sensevoice',
        segments: [
          { start: 0, end: 30, text: '长期主义。' },
          { start: 30, end: 65, text: '安全边际。' },
        ],
      },
    });

    expect(md).toContain('title: 投资必看！李录演讲：全球价值投资与时代');
    expect(md).toContain('tags: li-lu, value-investing, transcript');
    expect(md).toContain('source: http://xhslink.com/o/azGlFxprJH');
    expect(md).toContain('media: /tmp/li-lu.mp4');
    expect(md).toContain('provider: sensevoice');
    expect(md).toContain('### 00:00:00 - 00:00:30');
    expect(md).toContain('长期主义。');
    expect(md).toContain('### 00:00:30 - 00:01:05');
  });

  test('transcribe provider=local executes argv command and parses JSON output', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gbrain-transcribe-'));
    const media = join(dir, 'sample.mp3');
    const script = join(dir, 'fake-asr.py');
    writeFileSync(media, 'fake mp3');
    writeFileSync(script, `import json\nprint(json.dumps({"text":"本地中文转写","language":"zh","duration":3,"segments":[{"start":0,"end":3,"text":"本地中文转写"}]}))\n`);

    const result = await transcribe(media, {
      provider: 'local',
      localCommand: ['python3', script, '{input}'],
      language: 'zh',
    });

    expect(result.provider).toBe('local');
    expect(result.text).toBe('本地中文转写');
    expect(result.segments).toHaveLength(1);
  });

  test('CLI parser supports Chinese-friendly sensevoice defaults and markdown output path', () => {
    const opts = parseTranscribeArgs([
      '/tmp/li-lu.mp4',
      '--provider', 'sensevoice',
      '--language', 'zh',
      '--out', '/tmp/transcript.md',
      '--title', '李录演讲',
      '--tag', 'li-lu',
      '--tag', 'value-investing',
      '--import',
      '--embed',
    ]);

    expect(opts.input).toBe('/tmp/li-lu.mp4');
    expect(opts.provider).toBe('sensevoice');
    expect(opts.language).toBe('zh');
    expect(opts.out).toBe('/tmp/transcript.md');
    expect(opts.title).toBe('李录演讲');
    expect(opts.tags).toEqual(['li-lu', 'value-investing']);
    expect(opts.import).toBe(true);
    expect(opts.embed).toBe(true);
  });
});
