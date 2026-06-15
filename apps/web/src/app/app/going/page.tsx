'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  generateBriefing,
  getBriefing,
  getGoingSignals,
  type ExecutiveBriefing,
  type GoingSignal,
} from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';

const SIGNAL_META: Record<string, { emoji: string; color: string }> = {
  commit: { emoji: '💾', color: '#9bc' },
  pr: { emoji: '🔀', color: '#8ab4f8' },
  ci: { emoji: '⚙️', color: '#f7d774' },
  security: { emoji: '🔴', color: '#ff9b9b' },
};

function renderMd(md: string): React.ReactNode {
  return md.split('\n').map((line, i) => {
    const t = line.trim();
    if (!t) return <div key={i} style={{ height: 6 }} />;
    const html = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    return (
      <div
        key={i}
        className="md-line"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  });
}

export default function GoingPage() {
  const { current } = useWorkspace();
  const [briefing, setBriefing] = useState<ExecutiveBriefing | null>(null);
  const [signals, setSignals] = useState<GoingSignal[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, s] = await Promise.all([getBriefing(), getGoingSignals()]);
      setBriefing(b);
      setSignals(s);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (current) void load();
  }, [current, load]);

  const regen = async () => {
    setBusy(true);
    setError(null);
    try {
      await generateBriefing();
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <header className="head">
        <div>
          <h1>Going 🚖</h1>
          <p className="sub">
            El cerebro ejecutivo de tu negocio: el estado de Going (deploys, CI, incidentes,
            seguridad) sintetizado para vos como fundador.
          </p>
        </div>
        <button type="button" className="btn primary" disabled={busy || !current} onClick={regen}>
          {busy ? 'Pensando…' : 'Actualizar briefing'}
        </button>
      </header>

      {error && <div className="err">{error}</div>}
      {loading && <div className="muted">Cargando…</div>}

      {!loading && !briefing && signals.length === 0 && (
        <section className="empty">
          <div className="empty-emoji">🌉</div>
          <div className="empty-title">El puente todavía no recibió señales</div>
          <div className="empty-sub">
            El worker <code>going-bridge</code> sincroniza commits, PRs, CI, incidentes y alertas de
            seguridad de Going hacia tu segundo cerebro. Una vez configurado y corrido, vas a ver acá
            tu briefing ejecutivo.
          </div>
        </section>
      )}

      {!loading && briefing && (
        <section className="brief">
          <div className="brief-body">{renderMd(briefing.summary)}</div>

          {briefing.health && (
            <div className="block">
              <div className="block-tag">🩺 Salud técnica</div>
              <div className="block-text">{briefing.health}</div>
            </div>
          )}
          {briefing.priorities.length > 0 && (
            <div className="block">
              <div className="block-tag">⭐ Prioridades de fundador</div>
              <ol className="plist">
                {briefing.priorities.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ol>
            </div>
          )}
          {briefing.risks.length > 0 && (
            <div className="block risk">
              <div className="block-tag">⚠️ Riesgos a vigilar</div>
              <ul className="rlist">
                {briefing.risks.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="meta">
            {briefing.signals_analyzed} señales ·{' '}
            {new Date(briefing.created_at).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
          </div>
        </section>
      )}

      {!loading && signals.length > 0 && (
        <section className="signals">
          <h2>Señales recientes</h2>
          <ul className="slist">
            {signals.map((s) => {
              const type = s.external_metadata?.type ?? 'señal';
              const m = SIGNAL_META[type] ?? { emoji: '•', color: '#9aa' };
              return (
                <li key={s.id} className="sig">
                  <span className="sig-type" style={{ color: m.color }}>{m.emoji} {type}</span>
                  <span className="sig-title">{s.title}</span>
                  <span className="sig-date">{new Date(s.created_at).toLocaleDateString()}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <style jsx>{`
        .page { max-width: 800px; margin: 0 auto; padding: 32px 24px 96px; }
        .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
        h1 { margin: 0 0 4px; font-size: 24px; }
        .sub { color: #888; font-size: 14px; margin: 0; max-width: 520px; line-height: 1.5; }
        .btn { border: 1px solid #2a2a3a; color: #ccc; background: transparent; padding: 9px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; font-weight: 600; }
        .btn.primary { background: #fff; color: #000; border-color: #fff; }
        .btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .err { background: #2a1a1a; border: 1px solid #4a2a2a; color: #ff9b9b; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
        .muted { color: #888; font-size: 13px; padding: 16px 0; }
        .empty { background: #0e0e14; border: 1px solid #1a1a22; border-radius: 14px; padding: 48px 24px; text-align: center; }
        .empty-emoji { font-size: 36px; margin-bottom: 12px; }
        .empty-title { color: #ddd; font-size: 16px; margin-bottom: 6px; font-weight: 600; }
        .empty-sub { color: #888; font-size: 13px; max-width: 440px; margin: 0 auto; line-height: 1.6; }
        .empty-sub code { background: #1a1a22; padding: 1px 6px; border-radius: 4px; color: #ccc; }
        .brief { background: #0f0f16; border: 1px solid #1a1a22; border-radius: 14px; padding: 20px 22px; margin-bottom: 20px; }
        .brief-body :global(.md-line) { color: #ddd; font-size: 14px; line-height: 1.6; }
        .brief-body :global(strong) { color: #fff; }
        .block { margin-top: 16px; }
        .block-tag { font-size: 12px; font-weight: 700; color: #aaa; margin-bottom: 6px; }
        .block-text { color: #ccc; font-size: 14px; line-height: 1.5; }
        .plist, .rlist { margin: 0; padding-left: 20px; color: #ccc; font-size: 14px; line-height: 1.6; }
        .block.risk .block-tag { color: #ff9b9b; }
        .block.risk .rlist { color: #f3b0b0; }
        .meta { color: #555; font-size: 11px; margin-top: 16px; }
        .signals h2 { font-size: 15px; color: #ccc; margin: 0 0 10px; }
        .slist { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
        .sig { display: flex; align-items: center; gap: 10px; background: #0f0f16; border: 1px solid #1a1a22; border-radius: 8px; padding: 8px 12px; font-size: 13px; }
        .sig-type { font-size: 11px; font-weight: 700; white-space: nowrap; }
        .sig-title { color: #ddd; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sig-date { color: #666; font-size: 11px; white-space: nowrap; }
      `}</style>
    </div>
  );
}
