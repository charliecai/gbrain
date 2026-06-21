import type { Application, NextFunction, Request, RequestHandler, Response } from 'express';
import express from 'express';
import { existsSync, readdirSync, realpathSync, statSync } from 'fs';
import { basename, delimiter, extname, isAbsolute, join, relative, resolve, sep } from 'path';
import type { BrainEngine } from '../core/engine.ts';
import { operationsByName } from '../core/operations.ts';

export interface AdminFileRoot {
  id: string;
  label: string;
  absolutePath: string;
}

export interface AdminFileEntry {
  name: string;
  path: string;
  kind: 'directory' | 'file';
  size: number;
  modifiedAt: string;
  downloadable: boolean;
}

export type AdminPreview =
  | { kind: 'text'; path: string; name: string; size: number; content: string; truncated: boolean; language: string }
  | { kind: 'image'; path: string; name: string; size: number; mime: string; downloadable: true }
  | { kind: 'pdf'; path: string; name: string; size: number; downloadable: true }
  | { kind: 'binary'; path: string; name: string; size: number; downloadable: true }
  | { kind: 'too_large'; path: string; name: string; size: number; maxTextBytes: number; downloadable: true };

export interface AdminMvpOptions {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

const BLOCKED_SEGMENTS = new Set(['.git', '.ssh', '.gnupg', '.aws', '.config', 'node_modules']);
const BLOCKED_FILENAMES = new Set(['.env', '.env.local', '.env.production', 'id_rsa', 'id_ed25519', 'config.json']);
const TEXT_EXTENSIONS = new Set([
  '.md', '.markdown', '.txt', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.csv', '.tsv',
  '.log', '.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.xml', '.sql', '.py', '.rb', '.go',
  '.rs', '.java', '.c', '.cpp', '.h', '.sh', '.zsh', '.bash',
]);
const IMAGE_EXTENSIONS = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
]);
const DEFAULT_TEXT_PREVIEW_BYTES = 256 * 1024;

function publicRoot(root: AdminFileRoot) {
  return { id: root.id, label: root.label };
}

function normalizeRelative(input: string | undefined): string {
  const value = String(input ?? '').trim();
  if (!value || value === '.' || value === '/') return '';
  return value.replace(/^\/+/, '');
}

function isInside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

function assertNotBlocked(relPath: string): void {
  const parts = relPath.split(/[\\/]+/).filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    const lower = parts[i].toLowerCase();
    if (BLOCKED_SEGMENTS.has(lower)) throw new Error('blocked_path');
    if (BLOCKED_FILENAMES.has(lower)) throw new Error('blocked_path');
    if (lower.endsWith('.pem') || lower.endsWith('.key') || lower.endsWith('.p12')) throw new Error('blocked_path');
    if (parts[i - 1]?.toLowerCase() === '.gbrain' && lower === 'config.json') throw new Error('blocked_path');
  }
}

function rootLabel(path: string): string {
  const base = basename(path);
  return base || path;
}

export function getAdminFileRoots(options: AdminMvpOptions = {}): AdminFileRoot[] {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const configured = env.GBRAIN_ADMIN_FILE_ROOTS;
  const rawRoots = configured
    ? configured.split(delimiter).map(v => v.trim()).filter(Boolean)
    : [cwd];

  const seen = new Set<string>();
  const roots: AdminFileRoot[] = [];
  for (const raw of rawRoots) {
    const abs = isAbsolute(raw) ? raw : resolve(cwd, raw);
    if (!existsSync(abs)) continue;
    const real = realpathSync(abs);
    if (seen.has(real)) continue;
    seen.add(real);
    roots.push({
      id: `root-${roots.length}`,
      label: rootLabel(real),
      absolutePath: real,
    });
  }
  return roots;
}

export function resolveAdminFilePath(roots: AdminFileRoot[], rootId: string, relPath: string | undefined): {
  root: AdminFileRoot;
  relativePath: string;
  absolutePath: string;
} {
  const root = roots.find(r => r.id === rootId);
  if (!root) throw new Error('unknown_root');

  const cleanRel = normalizeRelative(relPath);
  assertNotBlocked(cleanRel);
  const candidate = resolve(root.absolutePath, cleanRel);
  if (!isInside(root.absolutePath, candidate)) throw new Error('outside_allowed_root');
  if (!existsSync(candidate)) throw new Error('not_found');

  const real = realpathSync(candidate);
  if (!isInside(root.absolutePath, real)) throw new Error('outside_allowed_root');

  return {
    root,
    relativePath: relative(root.absolutePath, real) || '',
    absolutePath: real,
  };
}

function fileKind(absPath: string): 'directory' | 'file' {
  return statSync(absPath).isDirectory() ? 'directory' : 'file';
}

export async function listAdminFiles(roots: AdminFileRoot[], rootId: string, relPath: string | undefined): Promise<{
  root: { id: string; label: string };
  path: string;
  parent: string | null;
  entries: AdminFileEntry[];
}> {
  const resolved = resolveAdminFilePath(roots, rootId, relPath);
  const stat = statSync(resolved.absolutePath);
  if (!stat.isDirectory()) throw new Error('not_directory');

  const entries = readdirSync(resolved.absolutePath, { withFileTypes: true })
    .filter(entry => {
      try {
        assertNotBlocked(join(resolved.relativePath, entry.name));
        return true;
      } catch {
        return false;
      }
    })
    .map(entry => {
      const abs = join(resolved.absolutePath, entry.name);
      const st = statSync(abs);
      const kind = fileKind(abs);
      return {
        name: entry.name,
        path: join(resolved.relativePath, entry.name),
        kind,
        size: st.size,
        modifiedAt: st.mtime.toISOString(),
        downloadable: kind === 'file',
      } satisfies AdminFileEntry;
    })
    .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'directory' ? -1 : 1));

  const parent = resolved.relativePath ? relative(resolved.root.absolutePath, resolve(resolved.absolutePath, '..')) || '' : null;
  return {
    root: publicRoot(resolved.root),
    path: resolved.relativePath,
    parent,
    entries,
  };
}

function languageFor(path: string): string {
  const ext = extname(path).toLowerCase().slice(1);
  return ext || 'text';
}

function looksBinary(buf: Buffer): boolean {
  return buf.subarray(0, Math.min(buf.length, 8000)).includes(0);
}

export async function previewAdminFile(
  roots: AdminFileRoot[],
  rootId: string,
  relPath: string | undefined,
  opts: { maxTextBytes?: number } = {},
): Promise<AdminPreview> {
  const resolved = resolveAdminFilePath(roots, rootId, relPath);
  const st = statSync(resolved.absolutePath);
  if (!st.isFile()) throw new Error('not_file');

  const ext = extname(resolved.absolutePath).toLowerCase();
  const name = basename(resolved.absolutePath);
  const base = { path: resolved.relativePath, name, size: st.size };

  if (IMAGE_EXTENSIONS.has(ext)) return { ...base, kind: 'image', mime: IMAGE_EXTENSIONS.get(ext)!, downloadable: true };
  if (ext === '.pdf') return { ...base, kind: 'pdf', downloadable: true };

  const maxTextBytes = opts.maxTextBytes ?? DEFAULT_TEXT_PREVIEW_BYTES;
  if (st.size > maxTextBytes && TEXT_EXTENSIONS.has(ext)) {
    return { ...base, kind: 'too_large', maxTextBytes, downloadable: true };
  }
  if (!TEXT_EXTENSIONS.has(ext)) {
    const probeBuf = await Bun.file(resolved.absolutePath).slice(0, Math.min(st.size, 4096)).arrayBuffer();
    if (looksBinary(Buffer.from(probeBuf))) return { ...base, kind: 'binary', downloadable: true };
  }
  if (st.size > maxTextBytes) return { ...base, kind: 'too_large', maxTextBytes, downloadable: true };

  const content = await Bun.file(resolved.absolutePath).text();
  return {
    ...base,
    kind: 'text',
    content,
    truncated: false,
    language: languageFor(resolved.absolutePath),
  };
}

function statusForError(err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === 'unknown_root' || msg === 'not_found') return 404;
  if (msg === 'outside_allowed_root' || msg === 'blocked_path') return 403;
  if (msg === 'not_directory' || msg === 'not_file') return 400;
  return 500;
}

function errorPayload(err: unknown) {
  return { error: err instanceof Error ? err.message : String(err) };
}

async function runAdminBrainQuery(
  engine: BrainEngine,
  config: unknown,
  mode: 'search' | 'think',
  query: string,
  limit: number,
) {
  const ctx = {
    engine,
    config: config ?? {},
    remote: true,
    logger: { info() {}, warn() {}, error() {} },
  } as any;

  if (mode === 'think') {
    return operationsByName.think.handler(ctx, { question: query, rounds: 1 });
  }

  const result = await operationsByName.search.handler(ctx, { query, limit });
  if (Array.isArray(result) && result.length === 0) {
    return engine.searchKeyword(query, { limit });
  }
  return result;
}

export function registerAdminMvpRoutes(
  app: Application,
  opts: {
    engine: BrainEngine;
    requireAdmin: RequestHandler;
    config?: unknown;
    cwd?: string;
  },
): void {
  const rootsForRequest = () => getAdminFileRoots({ cwd: opts.cwd });

  app.post('/admin/api/brain/query', opts.requireAdmin, express.json(), async (req: Request, res: Response) => {
    try {
      const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
      const mode = req.body?.mode === 'think' ? 'think' : 'search';
      const limit = Number.isFinite(Number(req.body?.limit)) ? Math.min(Math.max(Number(req.body.limit), 1), 20) : 8;
      if (!query) {
        res.status(400).json({ error: 'query_required' });
        return;
      }

      const result = await runAdminBrainQuery(opts.engine, opts.config ?? {}, mode, query, limit);
      res.json({ mode, query, result });
    } catch (err) {
      res.status(500).json(errorPayload(err));
    }
  });

  app.get('/admin/api/files/roots', opts.requireAdmin, (_req: Request, res: Response) => {
    res.json({ roots: rootsForRequest().map(publicRoot) });
  });

  app.get('/admin/api/files/list', opts.requireAdmin, async (req: Request, res: Response) => {
    try {
      const roots = rootsForRequest();
      const rootId = String(req.query.root ?? roots[0]?.id ?? '');
      const path = typeof req.query.path === 'string' ? req.query.path : '';
      res.json(await listAdminFiles(roots, rootId, path));
    } catch (err) {
      res.status(statusForError(err)).json(errorPayload(err));
    }
  });

  app.get('/admin/api/files/preview', opts.requireAdmin, async (req: Request, res: Response) => {
    try {
      const roots = rootsForRequest();
      const rootId = String(req.query.root ?? roots[0]?.id ?? '');
      const path = typeof req.query.path === 'string' ? req.query.path : '';
      res.json(await previewAdminFile(roots, rootId, path));
    } catch (err) {
      res.status(statusForError(err)).json(errorPayload(err));
    }
  });

  app.get('/admin/api/files/download', opts.requireAdmin, (req: Request, res: Response, next: NextFunction) => {
    try {
      const roots = rootsForRequest();
      const rootId = String(req.query.root ?? roots[0]?.id ?? '');
      const path = typeof req.query.path === 'string' ? req.query.path : '';
      const resolved = resolveAdminFilePath(roots, rootId, path);
      const st = statSync(resolved.absolutePath);
      if (!st.isFile()) throw new Error('not_file');
      res.download(resolved.absolutePath, basename(resolved.absolutePath));
    } catch (err) {
      const status = statusForError(err);
      if (status === 500) next(err);
      else res.status(status).json(errorPayload(err));
    }
  });
}
