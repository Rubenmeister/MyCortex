'use client';

import { useState } from 'react';
import { reviewBacklog, type BacklogReview, type BacklogThread } from '../../../lib/api';

const CATEGORY_META: Record<BacklogThread['category'], { label: string; color: string; bg: string }> = {
  cliente: { label: 'CLIENTE', color: '#6be675', bg: '#0e2412' },
  proveedor: { label: 'PROVEEDOR', color: '#6bc7e6', bg: '#0e2230' },
  tramite: { label: 'TRÁMITE', color: '#e6b96b', bg: '#2a2010' },
  personal: { label: 'PERSONAL', color: '#c99be6', bg: '#221030' },
  otro: { label: 'OTRO', color: '#9bc', bg: '#152030' },
};

function ageLabel(days: number): string {
  if (days <= 0) return 'hoy';
  if (days === 1) return 'hace 1 día';
  if (days < 30) return `hace ${days} días`;
  const months = Math.floor(days / 30);
  return months === 1 ? 'hace 1 mes' : `hace ${months} meses`;
}

export default function BacklogPage() {
  const [review, setReview] = useState<BacklogReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      setReview(await reviewBacklog());
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="page">
      <header className="top">
        <div>
          <h1>Pendientes de tu bandeja</h1>
          <p className="sub">
            Conversaciones donde alguien te escribió y nunca respondiste. Descarto boletines,
            promociones y avisos automáticos: solo lo que una persona real espera de ti.
          </p>
        </div>
        <button className="run" onClick={run} disabled={loading}>
          {loading ? 'Revisando…' : review ? 'Revisar de nuevo' : 'Revisar mi bandeja'}
        </button>
      </header>

      {error && <div className="err">{error}</div>}

      {loading && !review && (
        <div className="muted">Leyendo tus hilos y separando lo humano del ruido…</div>
      )}

      {review && (
        <>
          <div className="stats">
            <span><strong>{review.threadsScanned}</strong> hilos revisados</span>
            <span><strong>{review.noiseFiltered}</strong> descartados por ruido</span>
            <span className="hi"><strong>{review.backlog.length}</strong> esperan tu respuesta</span>
          </div>

          {review.backlog.length === 0 ? (
            <section className="empty">
              <div className="emoji">✅</div>
              <div className="empty-title">Estás al día.</div>
              <div className="empty-sub">
                Ninguna conversación humana quedó sin responder. Cuando llegue algo que requiera
                tu respuesta, aparecerá aquí.
              </div>
            </section>
          ) : (
            <ul className="list">
              {review.backlog.map((b) => {
                const meta = CATEGORY_META[b.category];
                return (
                  <li key={b.threadId} className="item">
                    <div className="item-head">
                      <span className="chip" style={{ color: meta.color, background: meta.bg }}>
                        {meta.label}
                      </span>
                      <span className="age">{ageLabel(b.ageDays)}</span>
                      {b.messageCount > 1 && <span className="count">{b.messageCount} mensajes</span>}
                    </div>
                    <div className="subject">{b.subject}</div>
                    <div className="from">de {b.fromName}</div>
                    <div className="reason">{b.reason}</div>
                    <div className="reply">
                      <span className="reply-label">Primer paso</span>
                      {b.suggestedReply}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <style jsx>{`
        .page { max-width: 780px; margin: 0 auto; padding: 24px 16px 80px; }
        .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 20px; }
        h1 { font-size: 22px; margin: 0 0 6px; }
        .sub { color: #9aa; font-size: 13px; line-height: 1.5; max-width: 460px; margin: 0; }
        .run {
          flex-shrink: 0; background: #2d6be6; color: #fff; border: none; border-radius: 8px;
          padding: 10px 18px; font-size: 14px; font-weight: 600; cursor: pointer;
        }
        .run:disabled { opacity: 0.6; cursor: default; }
        .err { background: #2a1010; color: #f99; padding: 12px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
        .muted { color: #889; font-size: 14px; padding: 24px 0; }
        .stats { display: flex; gap: 18px; flex-wrap: wrap; color: #9aa; font-size: 13px; margin-bottom: 18px; }
        .stats strong { color: #ccd; }
        .stats .hi strong { color: #6be675; }
        .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
        .item { background: #12141a; border: 1px solid #232735; border-radius: 12px; padding: 16px; }
        .item-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .chip { font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 5px; letter-spacing: 0.4px; }
        .age { color: #e6b96b; font-size: 12px; font-weight: 600; }
        .count { color: #778; font-size: 12px; }
        .subject { font-size: 15px; font-weight: 600; color: #eef; margin-bottom: 3px; }
        .from { color: #9aa; font-size: 13px; margin-bottom: 8px; }
        .reason { color: #bcc; font-size: 13px; line-height: 1.5; margin-bottom: 10px; }
        .reply { background: #0e1826; border-radius: 8px; padding: 10px 12px; font-size: 13px; color: #cde; line-height: 1.5; }
        .reply-label { display: block; color: #6bc7e6; font-size: 11px; font-weight: 700; letter-spacing: 0.4px; margin-bottom: 3px; }
        .empty { text-align: center; padding: 48px 0; }
        .emoji { font-size: 40px; margin-bottom: 12px; }
        .empty-title { font-size: 17px; font-weight: 600; color: #dde; margin-bottom: 6px; }
        .empty-sub { color: #889; font-size: 13px; max-width: 380px; margin: 0 auto; line-height: 1.5; }
      `}</style>
    </main>
  );
}
