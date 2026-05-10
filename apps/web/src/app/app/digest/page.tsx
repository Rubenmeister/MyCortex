'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getTodaysDigest,
  listDigests,
  type DailyDigest,
  type DigestListItem,
} from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';

/**
 * Renders very lightweight markdown to JSX: bold + headers + bullets.
 * We deliberately don't pull a full markdown parser — the digest LLM
 * output is structured but constrained, and a 30-line renderer is
 * faster + safer than 50KB of dependencies.
 */
function MarkdownLite({ text }: { text: string }) {
  const lines = text.split(/\r?\n/);
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="md-list">
        {bullets.map((b, i) => (
          <li key={i}>{renderInline(b)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  const renderInline = (s: string): React.ReactNode => {
    // Bold: **text**. Simple replace, since LLM markdown is reliable.
    const parts: React.ReactNode[] = [];
    const re = /\*\*([^*]+)\*\*/g;
    let last = 0;
    let m: RegExpExecArray | null;
    let i = 0;
    while ((m = re.exec(s)) !== null) {
      if (m.index > last) parts.push(s.slice(last, m.index));
      parts.push(<strong key={`b-${i++}`}>{m[1]}</strong>);
      last = m.index + m[0].length;
    }
    if (last < s.length) parts.push(s.slice(last));
    return parts.length > 0 ? parts : s;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim() === '') {
      flushBullets();
      continue;
    }
    // Heading: # / ## / ###
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      flushBullets();
      const level = h[1]!.length;
      const text = h[2]!;
      if (level === 1) blocks.push(<h2 key={blocks.length} className="md-h2">{renderInline(text)}</h2>);
      else if (level === 2) blocks.push(<h3 key={blocks.length} className="md-h3">{renderInline(text)}</h3>);
      else blocks.push(<h4 key={blocks.length} className="md-h4">{renderInline(text)}</h4>);
      continue;
    }
    // Bullet: - / *
    const b = /^[-*]\s+(.*)$/.exec(line);
    if (b) {
      bullets.push(b[1]!);
      continue;
    }
    flushBullets();
    blocks.push(
      <p key={blocks.length} className="md-p">
        {renderInline(line)}
      </p>,
    );
  }
  flushBullets();
  return <>{blocks}</>;
}

export default function DigestPage() {
  const { current } = useWorkspace();
  const [today, setToday] = useState<DailyDigest | null>(null);
  const [history, setHistory] = useState<DigestListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [t, h] = await Promise.all([getTodaysDigest(), listDigests(14)]);
      setToday(t);
      setHistory(h);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (current) void load();
  }, [current, load]);

  return (
    <div className="page">
      <h1>Briefing</h1>
      <p className="sub">Tu mañana resumida — qué pasó en las últimas 24h y qué viene.</p>

      {loading && <div className="muted">Cargando…</div>}
      {error && <div className="alert-err">{error}</div>}

      {!loading && today && (
        <section className="card">
          <div className="head-row">
            <div className="date">{formatDate(today.for_date)}</div>
            <div className="counts">
              {(today.counts.mails ?? 0) > 0 && (
                <span className="chip">📧 {today.counts.mails}</span>
              )}
              {(today.counts.calendar_today ?? 0) > 0 && (
                <span className="chip">📅 hoy {today.counts.calendar_today}</span>
              )}
              {(today.counts.calendar_upcoming ?? 0) > 0 && (
                <span className="chip">⏭ {today.counts.calendar_upcoming}</span>
              )}
              {(today.counts.drive ?? 0) > 0 && (
                <span className="chip">📁 {today.counts.drive}</span>
              )}
              {(today.counts.notes ?? 0) > 0 && (
                <span className="chip">📝 {today.counts.notes}</span>
              )}
            </div>
          </div>
          <div className="body">
            <MarkdownLite text={today.summary} />
          </div>
        </section>
      )}

      {!loading && !today && (
        <section className="card empty">
          <div className="empty-title">Aún no hay briefing para hoy.</div>
          <div className="empty-sub">
            El briefing se genera automáticamente cada mañana a las 7. Si tu workspace es nuevo,
            esperá 24h para que haya contenido que resumir.
          </div>
        </section>
      )}

      {history.length > 1 && (
        <section className="history">
          <h3>Briefings anteriores</h3>
          <ul>
            {history.slice(1).map((d) => (
              <li key={d.id}>
                <div className="hist-date">{formatDate(d.for_date)}</div>
                <div className="hist-summary">{d.summary.slice(0, 180)}…</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <style jsx>{`
        .page { max-width: 760px; margin: 0 auto; padding: 32px 24px 96px; }
        h1 { margin: 0 0 4px; font-size: 24px; }
        .sub { color: #888; font-size: 14px; margin: 0 0 24px; }
        .card {
          background: #111;
          border: 1px solid #1a1a1a;
          border-radius: 12px;
          padding: 22px;
          margin-bottom: 24px;
        }
        .card.empty {
          text-align: center;
          color: #888;
        }
        .empty-title { font-size: 15px; color: #ccc; margin-bottom: 4px; }
        .empty-sub { font-size: 13px; }
        .head-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 16px;
          padding-bottom: 14px;
          border-bottom: 1px solid #1a1a1a;
        }
        .date { color: #ddd; font-weight: 700; font-size: 16px; }
        .counts { display: flex; gap: 8px; flex-wrap: wrap; }
        .chip {
          background: #1a1a2a;
          color: #aac;
          font-size: 11px;
          padding: 3px 10px;
          border-radius: 99px;
          border: 1px solid #2a2a3a;
        }
        .body :global(.md-h2) {
          color: #fff;
          font-size: 17px;
          font-weight: 700;
          margin: 18px 0 6px;
        }
        .body :global(.md-h3) {
          color: #ddd;
          font-size: 15px;
          font-weight: 700;
          margin: 16px 0 6px;
        }
        .body :global(.md-h4) {
          color: #bbb;
          font-size: 13px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin: 14px 0 4px;
        }
        .body :global(.md-p) {
          color: #ddd;
          line-height: 1.55;
          margin: 6px 0;
        }
        .body :global(.md-list) {
          padding-left: 18px;
          margin: 6px 0;
        }
        .body :global(.md-list li) {
          color: #ddd;
          line-height: 1.55;
          margin: 4px 0;
        }
        .body :global(strong) { color: #fff; }
        .history h3 {
          color: #ccc;
          font-size: 14px;
          font-weight: 700;
          margin: 0 0 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .history ul {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .history li {
          padding: 12px 14px;
          background: #0c0c12;
          border: 1px solid #181820;
          border-radius: 8px;
        }
        .hist-date {
          color: #aac;
          font-size: 12px;
          font-weight: 600;
          margin-bottom: 4px;
        }
        .hist-summary {
          color: #888;
          font-size: 12px;
          line-height: 1.5;
        }
        .alert-err {
          background: #2a1a1a;
          border: 1px solid #4a2a2a;
          color: #ff9b9b;
          padding: 12px 16px;
          border-radius: 10px;
        }
        .muted { color: #888; font-size: 13px; }
      `}</style>
    </div>
  );
}

function formatDate(iso: string): string {
  // for_date is "YYYY-MM-DD" — render in user locale, no time component.
  const d = new Date(iso + 'T12:00:00Z'); // anchor at noon so DST doesn't shift the day
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}
