import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

import {
  getAdminFileRoots,
  listAdminFiles,
  previewAdminFile,
  resolveAdminFilePath,
} from '../src/commands/admin-mvp.ts';

function makeFixture() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'gbrain-admin-mvp-')));
  mkdirSync(join(dir, 'notes'));
  writeFileSync(join(dir, 'notes', 'hello.md'), '# Hello\n\nReal file preview.\n');
  writeFileSync(join(dir, '.env'), 'SECRET=do-not-read\n');
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'gbrain-admin-mvp-outside-')));
  writeFileSync(join(outside, 'secret.txt'), 'outside secret\n');
  symlinkSync(outside, join(dir, 'escape'));
  return { dir, outside };
}

describe('admin MVP file safety', () => {
  test('uses configured allowlisted roots and hides raw absolute roots from callers', () => {
    const { dir } = makeFixture();
    const roots = getAdminFileRoots({ env: { GBRAIN_ADMIN_FILE_ROOTS: dir }, cwd: '/unused' });

    expect(roots).toHaveLength(1);
    expect(roots[0].id).toBe('root-0');
    expect(roots[0].label).toContain('gbrain-admin-mvp-');
    expect(roots[0]).not.toHaveProperty('path');
  });

  test('resolves paths inside the selected root and rejects dot-dot traversal', () => {
    const { dir } = makeFixture();
    const roots = getAdminFileRoots({ env: { GBRAIN_ADMIN_FILE_ROOTS: dir }, cwd: '/unused' });

    const resolved = resolveAdminFilePath(roots, 'root-0', 'notes/hello.md');
    expect(resolved.absolutePath).toBe(join(dir, 'notes', 'hello.md'));

    expect(() => resolveAdminFilePath(roots, 'root-0', '../outside.txt')).toThrow(/outside_allowed_root/);
  });

  test('rejects symlinks that escape the selected root and blocked sensitive files', async () => {
    const { dir } = makeFixture();
    const roots = getAdminFileRoots({ env: { GBRAIN_ADMIN_FILE_ROOTS: dir }, cwd: '/unused' });

    expect(() => resolveAdminFilePath(roots, 'root-0', 'escape/secret.txt')).toThrow(/outside_allowed_root/);
    expect(() => resolveAdminFilePath(roots, 'root-0', '.env')).toThrow(/blocked_path/);

    const listed = await listAdminFiles(roots, 'root-0', 'notes');
    expect(listed.entries.map(e => e.name)).toEqual(['hello.md']);
  });

  test('previews text files with a size cap and reports binary files without reading them as text', async () => {
    const { dir } = makeFixture();
    const roots = getAdminFileRoots({ env: { GBRAIN_ADMIN_FILE_ROOTS: dir }, cwd: '/unused' });
    writeFileSync(join(dir, 'notes', 'large.txt'), 'x'.repeat(200));
    writeFileSync(join(dir, 'notes', 'blob.bin'), new Uint8Array([0, 1, 2, 3]));

    const text = await previewAdminFile(roots, 'root-0', 'notes/hello.md', { maxTextBytes: 1024 });
    expect(text.kind).toBe('text');
    if (text.kind !== 'text') throw new Error('expected text preview');
    expect(text.content).toContain('Real file preview');

    const large = await previewAdminFile(roots, 'root-0', 'notes/large.txt', { maxTextBytes: 64 });
    expect(large.kind).toBe('too_large');
    expect(large.size).toBe(200);

    const binary = await previewAdminFile(roots, 'root-0', 'notes/blob.bin', { maxTextBytes: 1024 });
    expect(binary.kind).toBe('binary');
    if (binary.kind !== 'binary') throw new Error('expected binary preview');
    expect(binary.downloadable).toBe(true);
  });
});
