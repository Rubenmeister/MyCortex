'use client';

import { useCallback, useEffect, useState } from 'react';
import { generateEpisode, listEpisodes, type CoachEpisode } from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';

function renderNarrative(md: string): React.ReactNode {
  return md.split('\n').map((line, i) => {
    const t = line.trim();
    if (!t) return <div key={i} style={{ height: 6 }} />;
    const html = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    return (
      <div
        key={i}
        className="nar-line"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  });
}

export default function DiarioPage() {
  const { current } = useWorkspace();
  const [episodes, setEpisodes] = useState<CoachEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEpisodes(await listEpisodes());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (current) void load();
  }, [current, load]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      await generateEpisode();
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
          <h1>Diario 📓</h1>
          <p className="sub">
            La memoria del coach, semana a semana: qué pasó, los temas, tu ánimo, el progreso de tus
            metas y los hilos que quedaron sueltos.
          </p>
        </div>
        <button type="button" className="btn primary" disabled={busy || !current} onClick={generate}>
          {busy ? 'Escribiendo…' : 'Generar esta semana'}
        </button>
      </header>

      {error && <div className="err">{error}</div>}
      {loading && <div className="muted">Cargando…</div>}

      {!loading && episodes.length === 0 && (
        <section className="empty">
          <div className="empty-emoji">📖</div>
          <div className="empty-title">Tu diario está vacío</div>
          <div className="empty-sub">
            Generá el episodio de esta semana y voy a escribir, a partir de tu material, qué pasó y
            cómo venís. Cada semana se suma uno.
          </div>
        </section>
      )}

      {!loading && episodes.length > 0 && (
        <ul className="timeline">
          {episodes.map((e) => (
            <li key={e.id} className="ep">
              <div className="ep-head">
                <span className="ep-label">{e.label}</span>
                <span className="ep-count">{e.nodes_analyzed} ítems</span>
              </div>
              <div className="ep-narrative">{renderNarrative(e.narrative)}</div>

              {e.themes.length > 0 && (
                <div className="chips">
                  {e.themes.map((t, i) => (
                    <span key={i} className="chip">{t}</span>
                  ))}
                </div>
              )}
              {e.mood && <div className="row"><b>Ánimo:</b> {e.mood}</div>}
              {e.progress && <div className="row"><b>Progreso:</b> {e.progress}</div>}
              {e.loose_threads.length > 0 && (
                <div className="threads">
                  <b>Hilos sueltos:</b>
                  <ul>
                    {e.loose_threads.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <style jsx>{`
        .page { max-width: 760px; margin: 0 auto; padding: 32px 24px 96px; }
        .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
        h1 { margin: 0 0 4px; font-size: 24px; }
        .sub { color: #888; font-size: 14px; margin: 0; max-width: 500px; line-height: 1.5; }
        .btn { border: 1px solid #2a2a3a; color: #ccc; background: transparent; padding: 9px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; font-weight: 600; }
        .btn.primary { background: #fff; color: #000; border-color: #fff; }
        .btn.primary:hover { opacity: 0.9; }
        .btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .err { background: #2a1a1a; border: 1px solid #4a2a2a; color: #ff9b9b; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
        .muted { color: #888; font-size: 13px; padding: 16px 0; }
        .empty { background: #0e0e14; border: 1px solid #1a1a22; border-radius: 14px; padding: 48px 24px; text-align: center; }
        .empty-emoji { font-size: 36px; margin-bottom: 12px; }
        .empty-title { color: #ddd; font-size: 16px; margin-bottom: 6px; font-weight: 600; }
        .empty-sub { color: #888; font-size: 13px; max-width: 400px; margin: 0 auto; line-height: 1.5; }
        .timeline { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 14px; }
        .ep { background: #0f0f16; border: 1px solid #1a1a22; border-radius: 12px; padding: 18px 20px; border-left: 3px solid #c79bf2; }
        .ep-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
        .ep-label { color: #fff; font-size: 15px; font-weight: 700; }
        .ep-count { color: #666; font-size: 11px; }
        .ep-narrative :global(.nar-line) { color: #ddd; font-size: 14px; line-height: 1.6; }
        .ep-narrative :global(strong) { color: #fff; }
        .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 12px; }
        .chip { color: #c79bf2; font-size: 11px; background: #16131c; border: 1px solid #271f30; border-radius: 99px; padding: 2px 10px; }
        .row { color: #aaa; font-size: 13px; line-height: 1.5; margin-top: 8px; }
        .row b { color: #ccc; }
        .threads { color: #aaa; font-size: 13px; line-height: 1.5; margin-top: 8px; }
        .threads b { color: #ccc; }
        .threads ul { margin: 4px 0 0; padding-left: 18px; }
        .threads li { margin: 2px 0; }
      `}</style>
    </div>
  );
}
