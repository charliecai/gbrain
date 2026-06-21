import { writeFileSync, mkdirSync } from 'fs';
import { dirname, basename, extname, resolve } from 'path';
import type { BrainEngine } from '../core/engine.ts';
import { renderTranscriptMarkdown, transcribe } from '../core/transcription.ts';
import { importFile } from '../core/import-file.ts';
import { runEmbed } from './embed.ts';

export interface TranscribeCliOptions {
  input: string;
  provider: 'sensevoice' | 'local' | 'groq' | 'openai' | 'deepgram';
  language: string;
  out?: string;
  title?: string;
  source?: string;
  tags: string[];
  command?: string[];
  import: boolean;
  embed: boolean;
}

export function parseTranscribeArgs(args: string[]): TranscribeCliOptions {
  if (args.includes('--help') || args.includes('-h')) {
    throw new Error(helpText());
  }

  const input = args.find(a => !a.startsWith('-'));
  if (!input) {
    throw new Error('Usage: gbrain transcribe <audio-or-video> [--provider sensevoice|local|groq|openai] [--out transcript.md]');
  }

  const opts: TranscribeCliOptions = {
    input,
    provider: 'sensevoice',
    language: 'zh',
    tags: [],
    import: false,
    embed: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === input) continue;
    switch (arg) {
      case '--provider':
        opts.provider = args[++i] as TranscribeCliOptions['provider'];
        break;
      case '--language':
      case '--lang':
        opts.language = args[++i] || opts.language;
        break;
      case '--out':
        opts.out = args[++i];
        break;
      case '--title':
        opts.title = args[++i];
        break;
      case '--source':
        opts.source = args[++i];
        break;
      case '--tag':
        opts.tags.push(args[++i]);
        break;
      case '--command-json':
        opts.command = JSON.parse(args[++i]);
        if (!Array.isArray(opts.command) || !opts.command.every(v => typeof v === 'string')) {
          throw new Error('--command-json must be a JSON string array');
        }
        break;
      case '--import':
        opts.import = true;
        break;
      case '--embed':
        opts.embed = true;
        opts.import = true;
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
    }
  }

  opts.tags = [...new Set(opts.tags.filter(Boolean))];
  return opts;
}

function defaultOutPath(input: string): string {
  const ext = extname(input);
  const stem = basename(input, ext).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'transcript';
  return resolve(process.cwd(), `${stem}-transcript.md`);
}

function helpText(): string {
  return `Usage: gbrain transcribe <audio-or-video> [options]\n\n` +
    `Options:\n` +
    `  --provider <name>       sensevoice (default), local, groq, openai, deepgram\n` +
    `  --language <code>       Language hint (default: zh)\n` +
    `  --out <file.md>         Markdown transcript output path\n` +
    `  --title <title>         Transcript title\n` +
    `  --source <url>          Original source URL\n` +
    `  --tag <tag>             Add tag; repeatable\n` +
    `  --command-json <argv>   JSON argv for provider=local; use {input}, {language}\n` +
    `  --import                Import generated Markdown into GBrain\n` +
    `  --embed                 Import and refresh stale embeddings\n`;
}

export async function runTranscribe(engine: BrainEngine | null, args: string[]): Promise<void> {
  let opts: TranscribeCliOptions;
  try {
    opts = parseTranscribeArgs(args);
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.log(msg);
    if (msg.startsWith('Usage:')) return;
    throw e;
  }

  const inputPath = resolve(opts.input);
  const outPath = resolve(opts.out || defaultOutPath(inputPath));
  const title = opts.title || basename(inputPath, extname(inputPath));

  const result = await transcribe(inputPath, {
    provider: opts.provider,
    language: opts.language,
    localCommand: opts.command,
  });

  const markdown = renderTranscriptMarkdown({
    title,
    source: opts.source,
    mediaPath: inputPath,
    tags: opts.tags,
    result,
  });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, markdown);
  console.log(`Transcript written: ${outPath}`);
  console.log(`Provider: ${result.provider}; language: ${result.language}; segments: ${result.segments.length}; duration: ${Math.round(result.duration)}s`);

  if (opts.import) {
    if (!engine) throw new Error('--import requires a configured GBrain database');
    const slug = outPath;
    const imported = await importFile(engine, outPath, slug, { noEmbed: true });
    console.log(`Imported: ${imported.status}${'chunks' in imported ? ` (${imported.chunks} chunks)` : ''}`);
  }

  if (opts.embed) {
    if (!engine) throw new Error('--embed requires a configured GBrain database');
    await runEmbed(engine, ['--stale']);
  }
}
