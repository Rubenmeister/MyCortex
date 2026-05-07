'use client';

import { useCallback, useEffect, useState } from 'react';
import { listRecent, type RecentNode } from '../../../lib/api';

const KIND_EMOJI: Record<string, string> = {
  task: '📋',
  idea: '💡',
  reference: '🔗',
  fragment: '✂️',
  note: '📝',
};
const CATEGORY_EMOJI: Record<string, string> = {
  going: '🚐',
  personal: '👤',
  urgent: '⚡',
  unknown: '❓',
};

export default function NodesPage() {
  const [nodes, setNodes] = useState<RecentNode[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await listRecent(50);
      setNodes(list);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="page">
      <div className="head">
        <h1>Notas</h1>
        <button type="button" onClick={load}>
          Refrescar
        </button>
      </div>

      {error && <div className="error">{error.slice(0, 200)}</div>}

      {nodes === null ? (
        <div style={{ color: '#888', textAlign: 'center', padding: 48 }}>Cargando…</div>
      ) : nodes.length === 0 ? (
        <div style={{ color: '#888', textAlign: 'center', padding: 48 }}>
          No tienes notas todavía. Captura algo en la pestaña Capturar.
        </div>
      ) : (
        <ul>
          {nodes.map((n) => (
            <li key={n.id}>
              <div className="title">
                {KIND_EMOJI[n.kind] ?? '📝'} {n.title ?? n.content.slice(0, 60)}
              </div>
              <div className="meta">
                {CATEGORY_EMOJI[n.category] ?? '❓'} {n.category} · {n.kind} · {n.source} ·{' '}
                {new Date(n.created_at).toLocaleString()}
              </div>
              <div className="content">{n.content}</div>
            </li>
          ))}
        </ul>
      )}

      <style jsx>{`
        .page {
          max-width: 880px;
          margin: 0 auto;
          padding: 32px 24px 96px;
        }
        .head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 24px;
        }
        h1 {
          margin: 0;
          font-size: 24px;
        }
        .head button {
          background: transparent;
          border: 1px solid #333;
          color: #ddd;
          padding: 8px 14px;
          border-radius: 8px;
          cursor: pointer;
        }
        .head button:hover {
          border-color: #555;
        }
        .error {
          background: #2a1a1a;
          color: #ff9b9b;
          padding: 12px;
          border-radius: 8px;
          margin-bottom: 16px;
        }
        ul {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        li {
          background: #111;
          border: 1px solid #1a1a1a;
          border-radius: 12px;
          padding: 14px 16px;
        }
        .title {
          font-weight: 700;
          color: #fff;
          font-size: 15px;
        }
        .meta {
          color: #777;
          font-size: 11px;
          margin-top: 4px;
        }
        .content {
          color: #ccc;
          font-size: 13px;
          margin-top: 10px;
          line-height: 1.5;
          white-space: pre-wrap;
        }
      `}</style>
    </div>
  );
}
