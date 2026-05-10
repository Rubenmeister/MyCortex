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
