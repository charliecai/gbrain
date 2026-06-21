import React, { useEffect, useState } from 'react';
import { api } from '../api';

interface Root {
  id: string;
  label: string;
}

interface Entry {
  name: string;
  path: string;
  kind: 'directory' | 'file';
  size: number;
  modifiedAt: string;
  downloadable: boolean;
}

interface Listing {
  root: Root;
  path: string;
  parent: string | null;
  entries: Entry[];
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function previewBody(preview: any) {
  if (!preview) return <div className="feed-empty">Select a file to preview.</div>;
  if (preview.kind === 'text') return <pre className="file-preview-text">{preview.content}</pre>;
  if (preview.kind === 'image') return <img className="file-preview-image" src={api.fileDownloadUrl(preview.rootId ?? '', preview.path)} alt={preview.name} />;
  if (preview.kind === 'pdf') return <div className="feed-empty">PDF preview is available through download/open.</div>;
  if (preview.kind === 'too_large') return <div className="warning-bar">Text preview skipped: {formatBytes(preview.size)} exceeds preview cap.</div>;
  return <div className="feed-empty">Binary file. Use download to inspect it.</div>;
}

export function FilesPage() {
  const [roots, setRoots] = useState<Root[]>([]);
  const [root, setRoot] = useState('');
  const [path, setPath] = useState('');
  const [listing, setListing] = useState<Listing | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const loadRoots = async () => {
    const res = await api.fileRoots();
    setRoots(res.roots);
    if (res.roots[0] && !root) setRoot(res.roots[0].id);
  };

  const loadList = async (nextRoot = root, nextPath = path) => {
    if (!nextRoot) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.fileList(nextRoot, nextPath);
      setListing(res);
      setPath(res.path);
      setPreview(null);
      setSelectedPath('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const loadPreview = async (entry: Entry) => {
    if (entry.kind === 'directory') {
      await loadList(root, entry.path);
      return;
    }
    setError('');
    setSelectedPath(entry.path);
    try {
      const res = await api.filePreview(root, entry.path);
      setPreview({ ...res, rootId: root });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPreview(null);
    }
  };

  useEffect(() => { void loadRoots(); }, []);
  useEffect(() => { if (root) void loadList(root, path); }, [root]);

  return (
    <>
      <h1 className="page-title">Files</h1>

      <div className="tool-panel">
        <div className="files-toolbar">
          <label>
            Root
            <select value={root} onChange={e => setRoot(e.target.value)}>
              {roots.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </label>
          <label>
            Path
            <input value={path} onChange={e => setPath(e.target.value)} onKeyDown={e => {
              if (e.key === 'Enter') void loadList();
            }} />
          </label>
          <button className="btn btn-secondary" disabled={loading || !root} onClick={() => void loadList()}>
            {loading ? 'Loading...' : 'Open'}
          </button>
          {listing?.parent !== null && (
            <button className="btn btn-secondary" onClick={() => void loadList(root, listing?.parent ?? '')}>Up</button>
          )}
        </div>
        {error && <div className="warning-bar">{error}</div>}
      </div>

      <div className="files-layout">
        <div className="tool-panel files-list">
          <h2 className="section-title">Directory</h2>
          {!listing ? (
            <div className="feed-empty">No directory loaded.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Kind</th>
                  <th>Size</th>
                  <th>Modified</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {listing.entries.map(entry => (
                  <tr key={entry.path} className={selectedPath === entry.path ? 'selected-row' : ''}>
                    <td className="file-name" onClick={() => void loadPreview(entry)}>
                      {entry.kind === 'directory' ? '▸ ' : ''}{entry.name}
                    </td>
                    <td>{entry.kind}</td>
                    <td className="mono">{entry.kind === 'file' ? formatBytes(entry.size) : ''}</td>
                    <td className="mono">{new Date(entry.modifiedAt).toLocaleString()}</td>
                    <td>
                      {entry.downloadable && (
                        <a className="table-link" href={api.fileDownloadUrl(root, entry.path)}>Download</a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="tool-panel files-preview">
          <h2 className="section-title">Preview</h2>
          {preview && (
            <div className="result-meta" style={{ marginBottom: 12 }}>
              <span className="mono">{preview.path}</span>
              <span>{preview.kind}</span>
              <span>{formatBytes(preview.size)}</span>
              {preview.downloadable && <a className="table-link" href={api.fileDownloadUrl(root, preview.path)}>Download</a>}
            </div>
          )}
          {previewBody(preview)}
        </div>
      </div>
    </>
  );
}
