'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getMeetingPrep,
  getUpcomingEvents,
  type AgendaEvent,
  type MeetingPrep,
} from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';

const RANGES = [
  { days: 7, label: '7 días' },
  { days: 14, label: '14 días' },
  { days: 30, label: '30 días' },
];

function formatWhen(iso: string | null): string {
  if (!iso) return 'sin fecha';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Render markdown muy liviano: **bold**, bullets "- ", y saltos de línea. */
function renderBrief(md: string): React.ReactNode {
  const lines = md.split('\n');
  return lines.map((line, i) => {
    const trimmed = line.trim();
    const html = trimmed.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    if (!trimmed) return <div key={i} style={{ height: 6 }} />;
    const isBullet = /^[-*]\s+/.test(trimmed);
    const body = isBullet ? html.replace(/^[-*]\s+/, '') : html;
    return (
      <div
        key={i}
        className={isBullet ? 'brief-bullet' : 'brief-line'}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: isBullet ? `• ${body}` : body }}
      />
    );
  });
}

export default function AgendaPage() {
  const { current } = useWorkspace();
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [days, setDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prepBy, setPrepBy] = useState<Record<string, MeetingPrep>>({});
  const [prepBusy, setPrepBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEvents(await getUpcomingEvents(days));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    if (current) void load();
  }, [current, load]);

  const prep = async (nodeId: string) => {
    setPrepBusy(nodeId);
    setError(null);
    try {
      const result = await getMeetingPrep(nodeId);
      setPrepBy((m) => ({ ...m, [nodeId]: result }));
    } catch (err) {
      setError(String(err));
    } finally {
      setPrepBusy(null);
    }
  };

  return (
    <div className="page">
      <header className="head">
        <div>
          <h1>Agenda 📅</h1>
          <p className="sub">
            Tus próximos eventos. Pedí «Preparame» y armo un brief con todo lo que tu segundo cerebro
            sabe de esa reunión.
          </p>
        </div>
        <div className="ranges">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              className={days === r.days ? 'rg active' : 'rg'}
              onClick={() => setDays(r.days)}
              disabled={loading}
            >
              {r.label}
            </button>
          ))}
        </div>
      </header>

      {error && <div className="err">{error}</div>}
      {loading && <div className="muted">Cargando…</div>}

      {!loading && events.length === 0 && (
        <section className="empty">
          <div className="empty-emoji">🗓️</div>
          <div className="empty-title">No tenés eventos próximos</div>
          <div className="empty-sub">
            Conectá tu Google Calendar en Ajustes › Integraciones y van a aparecer acá.
          </div>
        </section>
      )}

      {!loading && events.length > 0 && (
        <ul className="list">
          {events.map((e) => {
            const p = prepBy[e.nodeId];
            return (
              <li key={e.nodeId} className="card">
                <div className="when">⏰ {formatWhen(e.start)}</div>
                <div className="title">{e.title}</div>
                {e.location && <div className="meta-line">📍 {e.location}</div>}
                {e.attendees.length > 0 && (
                  <div className="meta-line">👥 {e.attendees.slice(0, 6).join(', ')}</div>
                )}
                {e.description && <p className="desc">{e.description.slice(0, 220)}</p>}

                <div className="actions">
                  <button
                    type="button"
                    className="btn primary"
                    disabled={prepBusy === e.nodeId}
                    onClick={() => prep(e.nodeId)}
                  >
                    {prepBusy === e.nodeId ? 'Pensando…' : p ? 'Regenerar brief' : 'Preparame ✨'}
                  </button>
                </div>

                {p && (
                  <div className="brief">
                    <div className="brief-body">{renderBrief(p.brief)}</div>
                    {p.sources.length > 0 && (
                      <div className="sources">
                        <span className="src-tag">Basado en:</span>
                        {p.sources.map((s) => (
                          <span key={s.id} className="src" title={s.snippet}>
                            {s.origin} › {s.title ?? s.snippet.slice(0, 40)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <style jsx>{`
        .page { max-width: 760px; margin: 0 auto; padding: 32px 24px 96px; }
        .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
        h1 { margin: 0 0 4px; font-size: 24px; }
        .sub { color: #888; font-size: 14px; margin: 0; max-width: 480px; line-height: 1.5; }
        .ranges { display: flex; gap: 6px; }
        .rg { background: #111; border: 1px solid #1a1a22; color: #aaa; padding: 6px 12px; border-radius: 8px; font-size: 12px; cursor: pointer; }
        .rg:hover { border-color: #2a2a3a; color: #ccc; }
        .rg.active { background: #1a1a2a; border-color: #2a2a3a; color: #fff; }
        .rg:disabled { opacity: 0.5; cursor: not-allowed; }
        .err { background: #2a1a1a; border: 1px solid #4a2a2a; color: #ff9b9b; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
        .muted { color: #888; font-size: 13px; padding: 16px 0; }
        .empty { background: #0e0e14; border: 1px solid #1a1a22; border-radius: 14px; padding: 48px 24px; text-align: center; }
        .empty-emoji { font-size: 36px; margin-bottom: 12px; }
        .empty-title { color: #ddd; font-size: 16px; margin-bottom: 6px; font-weight: 600; }
        .empty-sub { color: #888; font-size: 13px; max-width: 380px; margin: 0 auto; line-height: 1.5; }
        .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
        .card { background: #0f0f16; border: 1px solid #1a1a22; border-radius: 12px; padding: 16px 18px; }
        .when { color: #8ab4f8; font-size: 12px; font-weight: 600; margin-bottom: 6px; }
        .title { color: #fff; font-size: 16px; font-weight: 700; line-height: 1.35; }
        .meta-line { color: #aaa; font-size: 13px; margin-top: 4px; }
        .desc { color: #999; font-size: 13px; line-height: 1.5; margin: 8px 0 0; }
        .actions { margin-top: 12px; }
        :global(.btn) { background: transparent; border: 1px solid #2a2a3a; color: #ccc; padding: 6px 14px; border-radius: 8px; font-size: 12px; cursor: pointer; font-weight: 600; }
        :global(.btn:hover) { border-color: #4a4a5a; color: #fff; }
        :global(.btn:disabled) { opacity: 0.45; cursor: not-allowed; }
        :global(.btn.primary) { background: #fff; color: #000; border-color: #fff; }
        :global(.btn.primary:hover) { opacity: 0.9; color: #000; }
        .brief { margin-top: 14px; padding: 14px 16px; background: rgba(138,180,248,0.06); border: 1px solid #1f2433; border-radius: 10px; }
        .brief-body :global(.brief-line) { color: #ddd; font-size: 14px; line-height: 1.6; }
        .brief-body :global(.brief-bullet) { color: #cfcfcf; font-size: 14px; line-height: 1.6; padding-left: 4px; }
        .brief-body :global(strong) { color: #fff; }
        .sources { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
        .src-tag { color: #666; font-size: 11px; }
        .src { color: #888; font-size: 11px; background: #14141c; border: 1px solid #1f1f2a; border-radius: 6px; padding: 2px 8px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      `}</style>
    </div>
  );
}
