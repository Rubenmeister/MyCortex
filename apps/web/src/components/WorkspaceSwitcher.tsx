'use client';

import { useEffect, useRef, useState } from 'react';
import { useWorkspace } from '../lib/workspace';

export function WorkspaceSwitcher() {
  const { workspaces, current, switchTo, loading } = useWorkspace();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (loading) {
    return <span style={{ color: '#666', fontSize: 13 }}>…</span>;
  }
  if (!current) return null;

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="ws-trigger"
      >
        {current.is_personal ? '👤' : '🏢'} {current.name}
        <span style={{ marginLeft: 8, opacity: 0.6, fontSize: 11 }}>▾</span>
      </button>

      {open && (
        <div className="ws-menu">
          <div className="ws-section">Workspaces</div>
          {workspaces.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => {
                switchTo(w.id);
                setOpen(false);
                // Reload to refresh data scoped to the new workspace.
                window.location.reload();
              }}
              className={w.id === current.id ? 'ws-item ws-current' : 'ws-item'}
            >
              <span style={{ marginRight: 8 }}>{w.is_personal ? '👤' : '🏢'}</span>
              <span style={{ flex: 1 }}>{w.name}</span>
              <span style={{ fontSize: 11, color: '#888' }}>{w.role}</span>
            </button>
          ))}
          <div className="ws-divider" />
          <a href="/app/settings" className="ws-item">⚙ Ajustes / nuevo workspace</a>
        </div>
      )}

      <style jsx>{`
        .ws-trigger {
          background: #1a1a1a;
          border: 1px solid #2a2a2a;
          color: #fff;
          padding: 6px 12px;
          border-radius: 8px;
          font-size: 13px;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
        }
        .ws-trigger:hover {
          border-color: #444;
        }
        .ws-menu {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          min-width: 240px;
          background: #1a1a1a;
          border: 1px solid #2a2a2a;
          border-radius: 10px;
          padding: 6px;
          z-index: 10;
          box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
        }
        .ws-section {
          color: #666;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          padding: 6px 10px;
        }
        .ws-item {
          display: flex;
          align-items: center;
          padding: 8px 10px;
          width: 100%;
          background: transparent;
          border: none;
          color: #ddd;
          text-align: left;
          cursor: pointer;
          border-radius: 6px;
          font-size: 14px;
          text-decoration: none;
        }
        .ws-item:hover {
          background: #2a2a2a;
        }
        .ws-current {
          background: #1f1f2f;
          color: #fff;
        }
        .ws-divider {
          height: 1px;
          background: #2a2a2a;
          margin: 6px 4px;
        }
      `}</style>
    </div>
  );
}
