'use client';

import { useCallback, useEffect, useState } from 'react';
import { actOnAlert, listAlerts, type SmartAlert } from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';

const LEVEL_META: Record<
  SmartAlert['level'],
  { label: string; emoji: string; color: string; bg: string; border: string }
> = {
  critical: {
    label: 'CRÍTICO',
    emoji: '🚨',
    color: '#ff9b9b',
    bg: '#2a1a1a',
    border: '#4a2a2a',
  },
  high: {
    label: 'ALTO',
    emoji: '⚡',
    color: '#fb6',
    bg: '#2a2010',
    border: '#4a3a20',
  },
  low: {
    label: 'INFO',
    emoji: '💡',
    color: '#9bc',
    bg: '#152030',
    border: '#253545',
  },
};

function formatDeadline(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = Date.now();
  const diffMs = d.getTime() - now;
  const diffH = diffMs / (1000 * 60 * 60);
  if (diffH < 0) return `vencido hace ${Math.abs(Math.round(diffH))}h`;
  if (diffH < 24) return `en ${Math.round(diffH)}h`;
  const diffD = Math.round(diffH / 24);
  return `en ${diffD}d`;
}

/**
 * Fecha a mostrar: la del HECHO (source_date, del correo/evento origen), no la
 * de la alerta. Divergen tras un backfill — un correo del 5-may alertado hoy se
 * veía "16 jul", que es mentir sobre cuándo pasó. Si el hecho no es de hoy, se
 * dice en voz alta ("hace 72d") en vez de disfrazarlo de novedad.
 */
function formatSourceAge(
  sourceDate: string | null | undefined,
  createdAt: string,
): { label: string; title: string } {
  const iso = sourceDate ?? createdAt;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { label: '', title: '' };
  const stamp = d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const days = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  const detected = new Date(createdAt).toLocaleDateString();
  const title = sourceDate
    ? `Ocurrió el ${d.toLocaleString()} · detectado el ${detected}`
    : `Detectado el ${detected}`;
  return { label: days >= 2 ? `${stamp} · hace ${days}d` : stamp, title };
}

export default function AlertsPage() {
  const { current } = useWorkspace();
  const [alerts, setAlerts] = useState<SmartAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listAlerts({ all: showAll });
      setAlerts(list);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [showAll]);

  useEffect(() => {
    if (current) void load();
  }, [current, load]);

  // Mark all open alerts as `read` (just clearing the badge — distinct
  // from "acted on" or "dismissed"). Best-effort: errors are silently
  // ignored to avoid breaking the page just because the badge can't
  // clear. The nav polls unread-count every 60s and will reflect it.
  useEffect(() => {
    if (!current || alerts.length === 0) return;
    const unread = alerts.filter(
      (a) => !a.read_at && !a.dismissed_at && !a.acted_on_at,
    );
    if (unread.length === 0) return;
    Promise.allSettled(unread.map((a) => actOnAlert(a.id, 'read'))).catch(
      () => undefined,
    );
  }, [current, alerts]);

  const act = async (id: string, action: 'read' | 'dismiss' | 'acted' | 'reopen') => {
    setBusy(id);
    setError(null);
    try {
      await actOnAlert(id, action);
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const open = alerts.filter((a) => !a.dismissed_at && !a.acted_on_at);
  const resolved = alerts.filter((a) => a.dismissed_at || a.acted_on_at);
  const visible = showAll ? alerts : open;

  return (
    <div className="page">
      <header className="head">
        <div>
          <h1>Alertas</h1>
          <p className="sub">
            Lo que demanda atención AHORA. El worker escanea cada 30 min y flagea urgencias.
          </p>
        </div>
        <div className="filters">
          <button
            type="button"
            className={!showAll ? 'filter active' : 'filter'}
            onClick={() => setShowAll(false)}
          >
            Abiertas ({open.length})
          </button>
          <button
            type="button"
            className={showAll ? 'filter active' : 'filter'}
            onClick={() => setShowAll(true)}
          >
            Todas ({alerts.length})
          </button>
        </div>
      </header>

      {error && <div className="alert-err">{error}</div>}

      {loading && <div className="muted">Cargando…</div>}

      {!loading && visible.length === 0 && (
        <section className="empty">
          <div className="empty-emoji">✨</div>
          <div className="empty-title">
            {showAll ? 'Sin alertas todavía.' : 'No hay nada urgente ahora.'}
          </div>
          <div className="empty-sub">
            {showAll
              ? 'Cuando entren mails, docs o eventos nuevos, el worker los va a clasificar y vas a verlos aquí.'
              : 'Todas las alertas están resueltas. Buen trabajo.'}
          </div>
        </section>
      )}

      {!loading && visible.length > 0 && (
        <ul className="list">
          {visible.map((a) => {
            const meta = LEVEL_META[a.level];
            const deadline = formatDeadline(a.deadline);
            const sourceAge = formatSourceAge(a.source_date, a.created_at);
            const resolved = Boolean(a.dismissed_at || a.acted_on_at);
            return (
              <li
                key={a.id}
                className={resolved ? 'alert resolved' : 'alert'}
                style={{
                  background: resolved ? '#0c0c12' : meta.bg,
                  borderColor: resolved ? '#1a1a22' : meta.border,
                }}
              >
                <div className="alert-head">
                  <span className="level-chip" style={{ color: meta.color, borderColor: meta.border }}>
                    {meta.emoji} {meta.label}
                  </span>
                  {deadline && <span className="deadline">⏱ {deadline}</span>}
                  <span className="age" title={sourceAge.title}>
                    {sourceAge.label}
                  </span>
                </div>
                <div className="alert-title">{a.title}</div>
                <div className="alert-action">{a.action}</div>
                {a.context && <div className="alert-context">"{a.context}"</div>}

                <div className="actions">
                  {!resolved ? (
                    <>
                      <button
                        type="button"
                        className="btn primary"
                        disabled={busy === a.id}
                        onClick={() => act(a.id, 'acted')}
                      >
                        ✓ Hecho
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={busy === a.id}
                        onClick={() => act(a.id, 'dismiss')}
                      >
                        Ignorar
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="resolved-tag">
                        {a.acted_on_at
                          ? `✓ Hecho ${new Date(a.acted_on_at).toLocaleDateString()}`
                          : `Ignorado ${new Date(a.dismissed_at!).toLocaleDateString()}`}
                      </span>
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={busy === a.id}
                        onClick={() => act(a.id, 'reopen')}
                      >
                        Reabrir
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <style jsx>{`
        .page { max-width: 760px; margin: 0 auto; padding: 32px 24px 96px; }
        .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
        h1 { margin: 0 0 4px; font-size: 24px; }
        .sub { color: #888; font-size: 14px; margin: 0; max-width: 460px; }
        .filters { display: flex; gap: 6px; }
        .filter { background: #111; border: 1px solid #1a1a22; color: #aaa; padding: 6px 14px; border-radius: 8px; font-size: 12px; cursor: pointer; }
        .filter:hover { border-color: #2a2a3a; color: #ccc; }
        .filter.active { background: #1a1a2a; border-color: #2a2a3a; color: #fff; }
        .alert-err { background: #2a1a1a; border: 1px solid #4a2a2a; color: #ff9b9b; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
        .muted { color: #888; font-size: 13px; padding: 16px 0; }
        .empty { background: #0e0e14; border: 1px solid #1a1a22; border-radius: 14px; padding: 48px 24px; text-align: center; }
        .empty-emoji { font-size: 36px; margin-bottom: 12px; }
        .empty-title { color: #ddd; font-size: 16px; margin-bottom: 6px; font-weight: 600; }
        .empty-sub { color: #888; font-size: 13px; max-width: 360px; margin: 0 auto; line-height: 1.5; }
        .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
        .alert { border: 1px solid; border-radius: 12px; padding: 16px 18px; }
        .alert.resolved { opacity: 0.6; }
        .alert-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; font-size: 11px; }
        .level-chip { display: inline-block; padding: 2px 10px; border-radius: 99px; border: 1px solid; font-weight: 700; letter-spacing: 0.6px; font-size: 10px; }
        .deadline { color: #fb6; font-weight: 600; }
        .age { color: #666; margin-left: auto; }
        .alert-title { color: #fff; font-size: 15px; font-weight: 700; margin-bottom: 6px; line-height: 1.35; }
        .alert-action { color: #ccc; font-size: 14px; line-height: 1.5; margin-bottom: 8px; }
        .alert-context { color: #888; font-size: 12px; font-style: italic; line-height: 1.5; padding: 8px 12px; background: rgba(0,0,0,0.2); border-radius: 6px; border-left: 2px solid #2a2a3a; margin-bottom: 12px; }
        .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
        :global(.btn) { background: transparent; border: 1px solid #2a2a3a; color: #ccc; padding: 6px 14px; border-radius: 8px; font-size: 12px; cursor: pointer; font-weight: 600; }
        :global(.btn:hover) { border-color: #4a4a5a; color: #fff; }
        :global(.btn:disabled) { opacity: 0.45; cursor: not-allowed; }
        :global(.btn.primary) { background: #fff; color: #000; border-color: #fff; }
        :global(.btn.primary:hover) { opacity: 0.9; color: #000; }
        :global(.btn.ghost) { background: transparent; }
        .resolved-tag { color: #888; font-size: 12px; }
      `}</style>
    </div>
  );
}
