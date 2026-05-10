'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { publicConfig } from '../../../../lib/publicConfig';
import { supabase } from '../../../../lib/supabase';
import { useWorkspace } from '../../../../lib/workspace';

type Integration = {
  id: string;
  provider: 'google_drive' | 'gmail' | 'notion';
  status: 'active' | 'revoked' | 'error';
  external_account_email: string | null;
  scope: string | null;
  last_error: string | null;
  created_at: string;
};

type SyncSource = {
  id: string;
  external_id: string;
  display_name: string;
  status: 'active' | 'paused' | 'error';
  last_synced_at: string | null;
  items_synced: number;
  last_error: string | null;
};

type DriveFolder = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
};

const PROVIDER_LABEL: Record<Integration['provider'], string> = {
  google_drive: 'Google Drive',
  gmail: 'Gmail',
  notion: 'Notion',
};

const PROVIDER_ICON: Record<Integration['provider'], string> = {
  google_drive: '📁',
  gmail: '📧',
  notion: '📝',
};

export default function IntegrationsPage() {
  const { current } = useWorkspace();
  const search = useSearchParams();
  const driveError = search.get('drive_error');
  const driveConnected = search.get('drive_connected');

  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (current) headers['X-MyCortex-Workspace-Id'] = current.id;

      const res = await fetch(`${publicConfig.apiUrl}/integrations`, { headers });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = (await res.json()) as { integrations: Integration[] };
      setIntegrations(json.integrations);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [current]);

  useEffect(() => {
    if (current) void load();
  }, [current, load]);

  const connectDrive = async () => {
    setBusyProvider('google_drive');
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (current) headers['X-MyCortex-Workspace-Id'] = current.id;
      const res = await fetch(`${publicConfig.apiUrl}/integrations/drive/connect`, { headers });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      const { authUrl } = (await res.json()) as { authUrl: string };
      window.location.href = authUrl;
    } catch (err) {
      setError(String(err));
      setBusyProvider(null);
    }
  };

  const disconnect = async (id: string) => {
    if (!confirm('¿Desconectar esta integración? Las notas ya importadas se quedan.')) return;
    setBusyProvider(id);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (current) headers['X-MyCortex-Workspace-Id'] = current.id;
      const res = await fetch(`${publicConfig.apiUrl}/integrations/${id}`, {
        method: 'DELETE',
        headers,
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyProvider(null);
    }
  };

  const drive = integrations?.find((i) => i.provider === 'google_drive');

  return (
    <div className="page">
      <h1>Integraciones</h1>
      <p className="sub">
        Conecta servicios externos para que MyCortex aprenda de ellos. Tu segundo cerebro
        accede a tus archivos cuando preguntás.
      </p>

      {driveConnected && (
        <div className="alert alert-ok">
          ✅ Google Drive conectado como <strong>{driveConnected}</strong>
        </div>
      )}
      {driveError && (
        <div className="alert alert-err">
          ❌ Error conectando Drive: <code>{driveError}</code>
        </div>
      )}
      {error && <div className="alert alert-err">{error}</div>}

      <section className="card">
        <div className="head">
          <span className="provider-icon">{PROVIDER_ICON.google_drive}</span>
          <div>
            <div className="provider-name">{PROVIDER_LABEL.google_drive}</div>
            <div className="provider-desc">
              Indexa carpetas de tu Drive. PDF, Docs, .docx — todo se vuelve buscable
              y MyCortex lo cita cuando le preguntés.
            </div>
          </div>
        </div>

        {loading ? (
          <div className="muted">Cargando…</div>
        ) : drive ? (
          <div className="connected">
            <div>
              <span
                className={drive.status === 'active' ? 'badge badge-ok' : 'badge badge-warn'}
              >
                {drive.status}
              </span>
              <span className="email">
                {drive.external_account_email ?? '(cuenta desconocida)'}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busyProvider === drive.id}
              onClick={() => disconnect(drive.id)}
            >
              {busyProvider === drive.id ? '…' : 'Desconectar'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            onClick={connectDrive}
            disabled={busyProvider === 'google_drive'}
          >
            {busyProvider === 'google_drive' ? '…' : 'Conectar Google Drive'}
          </button>
        )}
      </section>

      {drive && drive.status === 'active' && (
        <DriveFolders integration={drive} workspaceId={current?.id ?? ''} />
      )}

      <section className="card disabled">
        <div className="head">
          <span className="provider-icon">{PROVIDER_ICON.gmail}</span>
          <div>
            <div className="provider-name">{PROVIDER_LABEL.gmail}</div>
            <div className="provider-desc">Próximamente.</div>
          </div>
        </div>
      </section>

      <section className="card disabled">
        <div className="head">
          <span className="provider-icon">{PROVIDER_ICON.notion}</span>
          <div>
            <div className="provider-name">{PROVIDER_LABEL.notion}</div>
            <div className="provider-desc">Próximamente.</div>
          </div>
        </div>
      </section>

      <style jsx>{`
        .page {
          max-width: 720px;
          margin: 0 auto;
          padding: 32px 24px 96px;
        }
        h1 {
          margin: 0 0 4px;
          font-size: 24px;
        }
        .sub {
          color: #888;
          font-size: 14px;
          margin: 0 0 24px;
        }
        .card {
          background: #111;
          border: 1px solid #1a1a1a;
          border-radius: 12px;
          padding: 18px;
          margin-top: 16px;
        }
        .card.disabled {
          opacity: 0.5;
        }
        .head {
          display: flex;
          gap: 14px;
          align-items: flex-start;
          margin-bottom: 14px;
        }
        .provider-icon {
          font-size: 32px;
          flex-shrink: 0;
        }
        .provider-name {
          font-weight: 700;
          color: #fff;
          font-size: 16px;
        }
        .provider-desc {
          color: #888;
          font-size: 13px;
          margin-top: 2px;
        }
        .connected {
          display: flex;
          align-items: center;
          gap: 12px;
          justify-content: space-between;
          flex-wrap: wrap;
        }
        .badge {
          display: inline-block;
          padding: 3px 10px;
          border-radius: 99px;
          font-size: 11px;
          margin-right: 10px;
        }
        .badge-ok {
          background: #1a3a1a;
          color: #9c9;
          border: 1px solid #2a4a2a;
        }
        .badge-warn {
          background: #3a2a1a;
          color: #fb6;
          border: 1px solid #4a3a2a;
        }
        .email {
          color: #ccc;
          font-size: 14px;
        }
        .btn {
          background: #fff;
          color: #000;
          border: none;
          border-radius: 8px;
          padding: 10px 16px;
          font-weight: 700;
          font-size: 14px;
          cursor: pointer;
        }
        .btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        .btn-ghost {
          background: transparent;
          border: 1px solid #333;
          color: #ccc;
        }
        .btn-ghost:hover {
          border-color: #555;
        }
        .alert {
          padding: 12px 16px;
          border-radius: 10px;
          font-size: 13px;
          margin-bottom: 12px;
        }
        .alert-ok {
          background: #122212;
          border: 1px solid #1f3a1f;
          color: #9c9;
        }
        .alert-err {
          background: #2a1a1a;
          border: 1px solid #4a2a2a;
          color: #ff9b9b;
        }
        .muted {
          color: #888;
          font-size: 13px;
        }
        code {
          background: #2a1a1a;
          padding: 2px 6px;
          border-radius: 4px;
        }
      `}</style>
    </div>
  );
}

function DriveFolders({
  integration,
  workspaceId,
}: {
  integration: Integration;
  workspaceId: string;
}) {
  const [sources, setSources] = useState<SyncSource[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [folders, setFolders] = useState<DriveFolder[] | null>(null);
  const [folderQuery, setFolderQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const headers = useCallback(async (): Promise<Record<string, string>> => {
    const { data: sess } = await supabase.auth.getSession();
    const t = sess.session?.access_token;
    if (!t) throw new Error('not_authenticated');
    const h: Record<string, string> = { Authorization: `Bearer ${t}` };
    if (workspaceId) h['X-MyCortex-Workspace-Id'] = workspaceId;
    return h;
  }, [workspaceId]);

  const loadSources = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const h = await headers();
      const res = await fetch(`${publicConfig.apiUrl}/integrations/${integration.id}/sources`, { headers: h });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 160)}`);
      const json = (await res.json()) as { sources: SyncSource[] };
      setSources(json.sources);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  }, [headers, integration.id]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  const openPicker = async () => {
    setPickerOpen(true);
    setFolders(null);
    setErr(null);
    try {
      const h = await headers();
      const res = await fetch(`${publicConfig.apiUrl}/integrations/${integration.id}/folders`, { headers: h });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 160)}`);
      const json = (await res.json()) as { folders: DriveFolder[] };
      setFolders(json.folders);
    } catch (e) {
      setErr(String(e));
    }
  };

  const addFolder = async (folder: DriveFolder) => {
    setBusy(folder.id);
    try {
      const h = await headers();
      const res = await fetch(`${publicConfig.apiUrl}/integrations/${integration.id}/sources`, {
        method: 'POST',
        headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ externalId: folder.id, displayName: folder.name }),
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 160)}`);
      await loadSources();
      setPickerOpen(false);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  };

  const removeSource = async (id: string) => {
    if (!confirm('¿Quitar esta carpeta? Las notas ya importadas se quedan.')) return;
    setBusy(id);
    try {
      const h = await headers();
      const res = await fetch(`${publicConfig.apiUrl}/integrations/${integration.id}/sources/${id}`, {
        method: 'DELETE',
        headers: h,
      });
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 160)}`);
      await loadSources();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(null);
    }
  };

  const filteredFolders = (folders ?? []).filter((f) =>
    folderQuery.trim() === '' ? true : f.name.toLowerCase().includes(folderQuery.toLowerCase()),
  );

  return (
    <section className="folders-card">
      <div className="folders-head">
        <h3>Carpetas sincronizadas</h3>
        <button type="button" className="btn-add" onClick={openPicker} disabled={busy !== null}>
          + Agregar carpeta
        </button>
      </div>

      {loading ? (
        <div className="muted-line">Cargando…</div>
      ) : !sources || sources.length === 0 ? (
        <div className="muted-line">
          Aún no agregaste carpetas. Agregá una para empezar a indexar tus archivos.
        </div>
      ) : (
        <ul className="src-list">
          {sources.map((s) => (
            <li key={s.id}>
              <div className="src-name">📁 {s.display_name}</div>
              <div className="src-meta">
                {s.status === 'active' ? '✓' : s.status === 'error' ? '⚠' : '⏸'} {s.status}
                {' · '}
                {s.items_synced} archivos
                {s.last_synced_at &&
                  ` · sync ${new Date(s.last_synced_at).toLocaleString()}`}
                {s.last_error && ` · ${s.last_error.slice(0, 60)}`}
              </div>
              <button
                type="button"
                className="src-rm"
                onClick={() => removeSource(s.id)}
                disabled={busy === s.id}
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}

      {err && <div className="folders-err">{err}</div>}

      {pickerOpen && (
        <div className="picker-backdrop" onClick={() => setPickerOpen(false)}>
          <div className="picker" onClick={(e) => e.stopPropagation()}>
            <div className="picker-head">
              <h4>Elegí una carpeta de tu Drive</h4>
              <button type="button" className="picker-close" onClick={() => setPickerOpen(false)}>
                ✕
              </button>
            </div>
            <input
              className="picker-search"
              placeholder="Buscar carpeta…"
              value={folderQuery}
              onChange={(e) => setFolderQuery(e.target.value)}
              autoFocus
            />
            <div className="picker-list">
              {folders === null ? (
                <div className="muted-line">Cargando carpetas…</div>
              ) : filteredFolders.length === 0 ? (
                <div className="muted-line">Sin resultados.</div>
              ) : (
                filteredFolders.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="picker-item"
                    onClick={() => addFolder(f)}
                    disabled={busy === f.id}
                  >
                    📁 {f.name}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .folders-card {
          background: #111;
          border: 1px solid #1a1a1a;
          border-radius: 12px;
          padding: 18px;
          margin-top: 12px;
        }
        .folders-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        h3 {
          margin: 0;
          color: #ddd;
          font-size: 15px;
          font-weight: 700;
        }
        .btn-add {
          background: transparent;
          border: 1px solid #333;
          color: #ddd;
          padding: 6px 12px;
          border-radius: 8px;
          font-size: 12px;
          cursor: pointer;
        }
        .btn-add:hover {
          border-color: #555;
        }
        .muted-line {
          color: #888;
          font-size: 13px;
          padding: 8px 0;
        }
        .src-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .src-list li {
          padding: 10px 12px;
          border: 1px solid #1f1f2f;
          border-radius: 8px;
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 4px 12px;
        }
        .src-name {
          color: #fff;
          font-size: 14px;
          font-weight: 600;
        }
        .src-meta {
          color: #888;
          font-size: 11px;
          grid-column: 1;
        }
        .src-rm {
          background: transparent;
          border: 1px solid #333;
          color: #aaa;
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 11px;
          cursor: pointer;
          grid-row: 1 / 3;
          grid-column: 2;
          align-self: center;
        }
        .src-rm:hover {
          color: #ff9b9b;
          border-color: #4a2a2a;
        }
        .folders-err {
          color: #ff9b9b;
          font-size: 12px;
          margin-top: 10px;
        }
        .picker-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 100;
        }
        .picker {
          background: #111;
          border: 1px solid #2a2a2a;
          border-radius: 12px;
          padding: 18px;
          width: 90%;
          max-width: 480px;
          max-height: 80vh;
          display: flex;
          flex-direction: column;
        }
        .picker-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .picker h4 {
          margin: 0;
          color: #fff;
          font-size: 16px;
        }
        .picker-close {
          background: transparent;
          border: none;
          color: #888;
          font-size: 18px;
          cursor: pointer;
        }
        .picker-search {
          background: #0a0a0a;
          border: 1px solid #2a2a2a;
          color: #fff;
          padding: 10px 12px;
          border-radius: 8px;
          font-size: 14px;
          margin-bottom: 8px;
          outline: none;
        }
        .picker-list {
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .picker-item {
          background: transparent;
          border: 1px solid transparent;
          color: #ddd;
          text-align: left;
          padding: 10px 12px;
          border-radius: 8px;
          font-size: 14px;
          cursor: pointer;
        }
        .picker-item:hover {
          background: #1a1a2a;
          border-color: #2a2a3a;
        }
      `}</style>
    </section>
  );
}
