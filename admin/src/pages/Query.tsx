import React, { useMemo, useState } from 'react';
import { api } from '../api';

type Mode = 'search' | 'think';

interface SearchResult {
  slug?: string;
  title?: string;
  type?: string;
  score?: number;
  chunk_text?: string;
  evidence?: string;
  create_safety?: string;
}

function pickAnswer(result: unknown): string {
  if (result && typeof result === 'object') {
    const rec = result as Record<string, unknown>;
    for (const key of ['answer', 'markdown', 'summary', 'text']) {
      if (typeof rec[key] === 'string' && rec[key]) return rec[key] as string;
    }
  }
  return JSON.stringify(result, null, 2);
}

function asResults(result: unknown): SearchResult[] {
  return Array.isArray(result) ? result as SearchResult[] : [];
}

export function QueryPage() {
  const [mode, setMode] = useState<Mode>('search');
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [response, setResponse] = useState<any>(null);

  const searchResults = useMemo(() => asResults(response?.result), [response]);
  const answer = useMemo(() => response && mode === 'think' ? pickAnswer(response.result) : '', [response, mode]);

  const run = async () => {
    const trimmed = query.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError('');
    try {
      const res = await api.brainQuery({ mode, query: trimmed, limit });
      setResponse(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setResponse(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <h1 className="page-title">Query</h1>

      <div className="tool-panel">
        <div className="query-grid">
          <label>
            Mode
            <select value={mode} onChange={e => setMode(e.target.value as Mode)}>
              <option value="search">Search</option>
              <option value="think">Think</option>
            </select>
          </label>
          <label>
            Limit
            <input
              type="number"
              min={1}
              max={20}
              value={limit}
              onChange={e => setLimit(Math.min(20, Math.max(1, Number(e.target.value) || 1)))}
            />
          </label>
        </div>
        <label>
          Query
          <textarea
            className="admin-textarea"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void run();
            }}
            placeholder="Ask or search your brain"
          />
        </label>
        <div className="toolbar-row">
          <button className="btn btn-primary" disabled={loading || !query.trim()} onClick={() => void run()}>
            {loading ? 'Running...' : 'Run'}
          </button>
          {error && <span className="inline-error">{error}</span>}
        </div>
      </div>

      {mode === 'think' && answer && (
        <div className="tool-panel">
          <h2 className="section-title">Answer</h2>
          <pre className="answer-block">{answer}</pre>
        </div>
      )}

      {mode === 'search' && response && (
        <div className="tool-panel">
          <h2 className="section-title">Results</h2>
          {searchResults.length === 0 ? (
            <div className="feed-empty">No results.</div>
          ) : (
            <div className="result-list">
              {searchResults.map((r, i) => (
                <div className="result-row" key={`${r.slug ?? 'result'}-${i}`}>
                  <div className="result-title">
                    <span>{r.title || r.slug || `Result ${i + 1}`}</span>
                    {typeof r.score === 'number' && <span className="mono">{r.score.toFixed(3)}</span>}
                  </div>
                  <div className="result-meta">
                    {r.slug && <span className="mono">{r.slug}</span>}
                    {r.type && <span>{r.type}</span>}
                    {r.evidence && <span>{r.evidence}</span>}
                    {r.create_safety && <span>{r.create_safety}</span>}
                  </div>
                  {r.chunk_text && <div className="result-snippet">{r.chunk_text}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
