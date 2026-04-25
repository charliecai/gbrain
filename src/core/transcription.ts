/**
 * Audio transcription service.
 *
 * Default provider: Groq Whisper (fast, cheap, OpenAI-compatible API format).
 * Fallback: OpenAI Whisper if Groq unavailable.
 * For files >25MB: ffmpeg segmentation into <25MB chunks, transcribe each, concatenate.
 */

import { statSync, readFileSync, existsSync } from 'fs';
import { basename, extname, resolve } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface TranscriptionResult {
  text: string;
  segments: TranscriptionSegment[];
  language: string;
  duration: number;
  provider: string;
}

export interface TranscriptionConfig {
  provider?: 'groq' | 'openai' | 'deepgram' | 'sensevoice' | 'local';
  apiKey?: string;
  model?: string;
  language?: string;
  diarize?: boolean;
  /** argv command for provider='local'. Use '{input}' as the media path placeholder. */
  localCommand?: string[];
}

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

// Supported audio formats
const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm', '.ogg', '.flac',
]);

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Transcribe an audio file using Groq Whisper (default) or OpenAI Whisper.
 * Files >25MB are segmented with ffmpeg before transcription.
 */
export async function transcribe(
  audioPath: string,
  config: TranscriptionConfig = {},
): Promise<TranscriptionResult> {
  // Validate file exists and is audio
  const stat = statSync(audioPath);
  const ext = extname(audioPath).toLowerCase();
  if (!AUDIO_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported audio format: ${ext}. Supported: ${[...AUDIO_EXTENSIONS].join(', ')}`);
  }

  if (config.provider === 'local') {
    return transcribeLocalCommand(audioPath, config.localCommand || parseCommandJsonEnv('GBRAIN_TRANSCRIPTION_COMMAND_JSON'), config, 'local');
  }

  if (config.provider === 'sensevoice') {
    return transcribeSenseVoice(audioPath, config);
  }

  // Determine provider and API key
  const provider = config.provider || detectProvider();
  const apiKey = config.apiKey || getApiKey(provider);
  if (!apiKey) {
    const envVar = provider === 'groq' ? 'GROQ_API_KEY' : 'OPENAI_API_KEY';
    throw new Error(
      `${provider} API key not set. Set ${envVar} environment variable. ` +
      (provider === 'groq' ? 'Or set OPENAI_API_KEY to use OpenAI Whisper as fallback.' : '')
    );
  }

  // Handle large files via segmentation
  if (stat.size > MAX_FILE_SIZE) {
    return transcribeLargeFile(audioPath, provider, apiKey, config);
  }

  // Single file transcription
  return transcribeFile(audioPath, provider, apiKey, config);
}

// ---------------------------------------------------------------------------
// Provider detection
// ---------------------------------------------------------------------------

function detectProvider(): 'groq' | 'openai' {
  if (process.env.GROQ_API_KEY) return 'groq';
  if (process.env.OPENAI_API_KEY) return 'openai';
  return 'groq'; // default, will fail with clear error if no key
}

function getApiKey(provider: string): string | undefined {
  switch (provider) {
    case 'groq': return process.env.GROQ_API_KEY;
    case 'openai': return process.env.OPENAI_API_KEY;
    case 'deepgram': return process.env.DEEPGRAM_API_KEY;
    default: return undefined;
  }
}

// ---------------------------------------------------------------------------
// Single file transcription
// ---------------------------------------------------------------------------

async function transcribeFile(
  audioPath: string,
  provider: string,
  apiKey: string,
  config: TranscriptionConfig,
): Promise<TranscriptionResult> {
  const model = config.model || (provider === 'groq' ? 'whisper-large-v3' : 'whisper-1');
  const baseUrl = provider === 'groq'
    ? 'https://api.groq.com/openai/v1'
    : 'https://api.openai.com/v1';

  // Both Groq and OpenAI use the same API format
  const fileData = readFileSync(audioPath);
  const formData = new FormData();
  formData.append('file', new Blob([fileData]), basename(audioPath));
  formData.append('model', model);
  formData.append('response_format', 'verbose_json');
  if (config.language) formData.append('language', config.language);

  const response = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Transcription failed (${provider} ${response.status}): ${errorText}`);
  }

  const data = await response.json() as any;

  return {
    text: data.text || '',
    segments: (data.segments || []).map((s: any) => ({
      start: s.start || 0,
      end: s.end || 0,
      text: s.text || '',
    })),
    language: data.language || config.language || 'unknown',
    duration: data.duration || 0,
    provider,
  };
}

// ---------------------------------------------------------------------------
// Large file segmentation
// ---------------------------------------------------------------------------

async function transcribeLargeFile(
  audioPath: string,
  provider: string,
  apiKey: string,
  config: TranscriptionConfig,
): Promise<TranscriptionResult> {
  // Check ffmpeg availability
  const ffmpegAvailable = await checkFfmpeg();
  if (!ffmpegAvailable) {
    throw new Error(
      'File exceeds 25MB and ffmpeg is required for segmentation. ' +
      'Install ffmpeg: brew install ffmpeg (macOS) or apt install ffmpeg (Linux)'
    );
  }

  // Segment into ~20MB chunks (with some overlap for better joining)
  const { execSync } = await import('child_process');
  const tmpDir = execSync('mktemp -d').toString().trim();

  try {
    // Get audio duration
    const durationStr = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${audioPath}"`,
      { encoding: 'utf-8' }
    ).trim();
    const totalDuration = parseFloat(durationStr) || 0;

    // Calculate segment length (~20MB per segment, estimate from file size)
    const stat = statSync(audioPath);
    const bytesPerSecond = stat.size / Math.max(totalDuration, 1);
    const segmentSeconds = Math.floor((20 * 1024 * 1024) / bytesPerSecond);

    // Split audio
    const ext = extname(audioPath);
    execSync(
      `ffmpeg -i "${audioPath}" -f segment -segment_time ${segmentSeconds} -c copy "${tmpDir}/segment_%03d${ext}"`,
      { stdio: 'pipe' }
    );

    // Transcribe each segment
    const { readdirSync } = await import('fs');
    const segments = readdirSync(tmpDir).filter(f => f.startsWith('segment_')).sort();
    const results: TranscriptionResult[] = [];
    let timeOffset = 0;

    for (const seg of segments) {
      const segPath = `${tmpDir}/${seg}`;
      const result = await transcribeFile(segPath, provider, apiKey, config);
      // Offset timestamps
      result.segments = result.segments.map(s => ({
        ...s,
        start: s.start + timeOffset,
        end: s.end + timeOffset,
      }));
      results.push(result);
      timeOffset += result.duration;
    }

    // Concatenate results
    return {
      text: results.map(r => r.text).join(' '),
      segments: results.flatMap(r => r.segments),
      language: results[0]?.language || 'unknown',
      duration: timeOffset,
      provider,
    };
  } finally {
    // Cleanup temp directory
    try { execSync(`rm -rf "${tmpDir}"`); } catch {}
  }
}

async function checkFfmpeg(): Promise<boolean> {
  try {
    const { execSync } = await import('child_process');
    execSync('ffmpeg -version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}


// ---------------------------------------------------------------------------
// Local transcription providers + Markdown rendering
// ---------------------------------------------------------------------------

function extractJsonPayload(output: string): string {
  const trimmed = output.trim();
  if (trimmed.startsWith('{')) return trimmed;
  const lastBrace = trimmed.lastIndexOf('\n{');
  if (lastBrace >= 0) return trimmed.slice(lastBrace + 1).trim();
  return trimmed;
}

export function parseLocalTranscriptionOutput(output: string, provider: string): TranscriptionResult {
  const trimmed = output.trim();
  if (!trimmed) {
    throw new Error(`${provider} transcription command produced no output`);
  }

  try {
    const jsonText = extractJsonPayload(trimmed);
    const data = JSON.parse(jsonText) as any;
    const segments = Array.isArray(data.segments)
      ? data.segments.map((s: any) => ({
          start: Number(s.start ?? 0),
          end: Number(s.end ?? s.start ?? 0),
          text: String(s.text ?? '').trim(),
          ...(s.speaker ? { speaker: String(s.speaker) } : {}),
        })).filter((s: TranscriptionSegment) => s.text)
      : [];
    const text = String(data.text ?? segments.map((s: TranscriptionSegment) => s.text).join('\n')).trim();
    return {
      text,
      segments,
      language: String(data.language ?? 'unknown'),
      duration: Number(data.duration ?? segments.at(-1)?.end ?? 0),
      provider,
    };
  } catch {
    return {
      text: trimmed,
      segments: [{ start: 0, end: 0, text: trimmed }],
      language: 'unknown',
      duration: 0,
      provider,
    };
  }
}

async function transcribeLocalCommand(
  audioPath: string,
  command: string[] | undefined,
  config: TranscriptionConfig,
  provider: 'local' | 'sensevoice',
): Promise<TranscriptionResult> {
  if (!command || command.length === 0) {
    const envName = provider === 'local' ? 'GBRAIN_TRANSCRIPTION_COMMAND_JSON' : 'GBRAIN_SENSEVOICE_COMMAND_JSON';
    throw new Error(
      `No local transcription command configured. Pass localCommand or set ${envName} ` +
      `to a JSON argv array such as ["python3","script.py","{input}"].`
    );
  }

  const input = resolve(audioPath);
  const argv = command.map(part => part
    .replace(/\{input\}/g, input)
    .replace(/\{language\}/g, config.language || 'auto')
    .replace(/\{model\}/g, config.model || ''));
  const [cmd, ...args] = argv;
  const { execFile } = await import('child_process');
  const output = await new Promise<string>((resolvePromise, reject) => {
    execFile(cmd, args, { encoding: 'utf8', maxBuffer: 100 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(
          `${provider} transcription command failed: ${error.message}` +
          (stderr ? `\n${stderr.slice(0, 4000)}` : '')
        ));
        return;
      }
      resolvePromise(stdout);
    });
  });

  return parseLocalTranscriptionOutput(output, provider);
}

function parseCommandJsonEnv(name: string): string[] | undefined {
  const raw = process.env[name];
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every(v => typeof v === 'string')) return parsed;
  } catch {}
  throw new Error(`${name} must be a JSON array of strings, for example ["python3","script.py","{input}"].`);
}

function defaultSenseVoiceCommand(): string[] {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const script = resolve(here, '../../scripts/sensevoice-transcribe.py');
  const bundledPython = resolve(process.env.HOME || '', '.hermes/hermes-agent/venv/bin/python');
  const python = process.env.GBRAIN_TRANSCRIPTION_PYTHON
    || (existsSync(bundledPython) ? bundledPython : 'python3');
  return [python, script, '{input}', '--language', '{language}'];
}

async function transcribeSenseVoice(audioPath: string, config: TranscriptionConfig): Promise<TranscriptionResult> {
  const command = config.localCommand
    || parseCommandJsonEnv('GBRAIN_SENSEVOICE_COMMAND_JSON')
    || defaultSenseVoiceCommand();
  return transcribeLocalCommand(audioPath, command, config, 'sensevoice');
}

export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function yamlScalar(value: string): string {
  if (/[#\n\[\]{}]|:\s|^\s|\s$/.test(value)) return JSON.stringify(value);
  return value;
}

export function renderTranscriptMarkdown(opts: {
  title: string;
  source?: string;
  mediaPath: string;
  tags?: string[];
  result: TranscriptionResult;
}): string {
  const tags = opts.tags?.length ? opts.tags.join(', ') : 'transcript, audio, video';
  const lines: string[] = [
    '---',
    `title: ${yamlScalar(opts.title)}`,
    `tags: ${tags}`,
  ];
  if (opts.source) lines.push(`source: ${yamlScalar(opts.source)}`);
  lines.push(
    `media: ${yamlScalar(opts.mediaPath)}`,
    `provider: ${opts.result.provider}`,
    `language: ${opts.result.language}`,
    `duration_seconds: ${Math.round(opts.result.duration)}`,
    '---',
    '',
    `# ${opts.title}`,
    '',
    '## 转写信息',
    '',
    `- 媒体文件：\`${opts.mediaPath}\``,
    `- 转写引擎：${opts.result.provider}`,
    `- 语言：${opts.result.language}`,
    `- 时长：${formatTimestamp(opts.result.duration)}`,
    '',
    '## 带时间戳转写',
    '',
  );

  if (opts.result.segments.length === 0) {
    lines.push(opts.result.text, '');
  } else {
    for (const segment of opts.result.segments) {
      lines.push(
        `### ${formatTimestamp(segment.start)} - ${formatTimestamp(segment.end)}`,
        '',
        segment.text,
        '',
      );
    }
  }

  lines.push('## 完整转写', '', opts.result.text, '');
  return lines.join('\n');
}
