'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  acceptContextProposal,
  getContext,
  listContextProposals,
  proposeContext,
  rejectContextProposal,
  saveContext,
  type ContextProposal,
} from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';

const PLACEHOLDER = `## Metas
- (tus objetivos duraderos)

## Proyectos
- (en qué andas trabajando)

## Personas
- (gente clave: quién es, qué relación)

## Reglas y preferencias
- (cómo quieres que te trate el coach)`;

export default function ContextPage() {
  const { current } = useWorkspace();
  const [body, setBody] = useState('');
  const [saved, setSaved] = useState('');
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ContextProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingBusy, setSavingBusy] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ctx, props] = await Promise.all([getContext(), listContextProposals()]);
      setBody(ctx.body);
      setSaved(ctx.body);
      setUpdatedAt(ctx.updated_at);
      setProposals(props);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!current) return;
    load();
  }, [current, load]);

  const dirty = body !== saved;

  const save = useCallback(async () => {
    setSavingBusy(true);
    setError(null);
    try {
      const ctx = await saveContext(body);
      setSaved(ctx.body);
      setUpdatedAt(ctx.updated_at);
      setNotice('Contexto guardado');
      setTimeout(() => setNotice(null), 2500);
    } catch (err) {
      setError(String(err));
    } finally {
      setSavingBusy(false);
    }
  }, [body]);

  const propose = useCallback(async () => {
    setProposing(true);
    setError(null);
    try {
      const { created } = await proposeContext();
      setNotice(created > 0 ? `${created} propuesta${created === 1 ? '' : 's'} nueva${created === 1 ? '' : 's'}` : 'Sin propuestas nuevas por ahora');
      setTimeout(() => setNotice(null), 3000);
      setProposals(await listContextProposals());
    } catch (err) {
      setError(String(err));
    } finally {
      setProposing(false);
    }
  }, []);

  const accept = useCallback(async (p: ContextProposal) => {
    setBusyId(p.id);
    setError(null);
    try {
      const { body: newBody } = await acceptContextProposal(p.id);
      if (typeof newBody === 'string') {
        setBody(newBody);
        setSaved(newBody);
      }
      setProposals((prev) => prev.filter((it) => it.id !== p.id));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyId(null);
    }
  }, []);

  const reject = useCallback(async (p: ContextProposal) => {
    setBusyId(p.id);
    setError(null);
    try {
      await rejectContextProposal(p.id);
      setProposals((prev) => prev.filter((it) => it.id !== p.id));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyId(null);
    }
  }, []);

  return (
    <div className="page">
      <header className="head">
        <h1>Contexto 🧭</h1>
        <p className="sub">
          Tu <b>constitución</b>: lo que declaras sobre tu vida y trabajo. A diferencia de lo que el
          coach infiere, esto es la <b>fuente de verdad</b> — se inyecta en todo lo que MyCortex razona
          (coach, chat, preguntas, agenda). Edítalo libre; la IA también te propone qué fijar.
        </p>
      </header>

      {error && <div className="err">{error}</div>}
      {notice && <div className="ok">{notice}</div>}

      <section className="editor">
        <div className="editor-head">
          <span className="tag">📝 Tu constitución</span>
          <div className="editor-actions">
            {updatedAt && !dirty && (
              <span className="meta">Guardado {new Date(updatedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            )}
            <button type="button" className="btn primary" disabled={!dirty || savingBusy || !current} onClick={save}>
              {savingBusy ? 'Guardando…' : dirty ? 'Guardar' : 'Guardado'}
            </button>
          </div>
        </div>
        <textarea
          className="body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={PLACEHOLDER}
          spellCheck={false}
          disabled={loading}
        />
        <div className="hint">Markdown. Usa secciones <code>## Metas</code>, <code>## Proyectos</code>, <code>## Personas</code>, <code>## Reglas y preferencias</code>.</div>
      </section>

      <section className="inbox">
        <div className="inbox-head">
          <span className="tag">💡 La IA propone fijar</span>
          {proposals.length > 0 && <span className="count">{proposals.length}</span>}
          <button type="button" className="btn ghost" disabled={proposing || !current} onClick={propose}>
            {proposing ? 'Buscando…' : '🔍 Buscar en mi material'}
          </button>
        </div>

        {loading ? (
          <div className="empty">Cargando…</div>
        ) : proposals.length === 0 ? (
          <div className="empty">
            No hay propuestas pendientes. Pulsa «Buscar en mi material» y la IA revisará tus notas
            recientes para sugerir hechos estables que valga la pena fijar. Cada lunes también corre sola.
          </div>
        ) : (
          <ul className="list">
            {proposals.map((p) => {
              const busy = busyId === p.id;
              return (
                <li key={p.id} className="card">
                  <div className="card-head">
                    <span className="section">{p.section}</span>
                  </div>
                  <div className="card-text">{p.text}</div>
                  {p.rationale && <p className="rationale">{p.rationale}</p>}
                  <div className="card-actions">
                    <button type="button" className="act primary" disabled={busy} onClick={() => accept(p)}>
                      {busy ? '…' : '✓ Fijar en mi contexto'}
                    </button>
                    <button type="button" className="act ghost" disabled={busy} onClick={() => reject(p)}>
                      ✕ Descartar
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <style jsx>{`
        .page { max-width: 820px; margin: 0 auto; padding: 32px 24px 96px; }
        .head { margin-bottom: 20px; }
        h1 { margin: 0 0 6px; font-size: 24px; }
        .sub { color: #888; font-size: 14px; margin: 0; max-width: 640px; line-height: 1.55; }
        .sub b { color: #ccc; }
        .err { background: #2a1a1a; border: 1px solid #4a2a2a; color: #ff9b9b; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
        .ok { background: #10261a; border: 1px solid #1f4a30; color: #7fd6a6; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
        .editor { background: #0e0e14; border: 1px solid #1a1a22; border-radius: 12px; padding: 16px 18px; margin-bottom: 24px; }
        .editor-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
        .tag { color: #c79bf2; font-size: 12px; font-weight: 700; letter-spacing: 0.3px; }
        .editor-actions { display: flex; align-items: center; gap: 12px; }
        .meta { color: #666; font-size: 11px; }
        .body { width: 100%; min-height: 320px; background: #0a0a0f; border: 1px solid #1f1f2a; border-radius: 10px; color: #ddd; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13.5px; line-height: 1.6; padding: 14px; resize: vertical; box-sizing: border-box; }
        .body:focus { outline: none; border-color: #3a3a4a; }
        .hint { color: #666; font-size: 11px; margin-top: 8px; }
        .hint code { background: #14141c; border: 1px solid #1f1f2a; border-radius: 4px; padding: 1px 5px; color: #9bd0e0; }
        .btn { border: 1px solid #2a2a3a; color: #ccc; background: transparent; padding: 8px 16px; border-radius: 8px; font-size: 13px; cursor: pointer; font-weight: 600; }
        .btn.primary { background: #fff; color: #000; border-color: #fff; }
        .btn.primary:disabled { opacity: 0.4; cursor: not-allowed; }
        .btn.ghost:hover { border-color: #3a3a4a; color: #fff; }
        .inbox-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
        .count { background: #14141c; border: 1px solid #1f2a30; color: #9bd0e0; font-size: 11px; font-weight: 700; border-radius: 99px; padding: 1px 9px; }
        .inbox-head .btn { margin-left: auto; }
        .empty { background: #0e0e14; border: 1px solid #1a1a22; border-radius: 12px; padding: 28px 22px; color: #888; font-size: 13px; line-height: 1.55; }
        .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
        .card { background: #0f0f16; border: 1px solid #1a1a22; border-radius: 12px; padding: 14px 16px; }
        .card-head { margin-bottom: 6px; }
        .section { color: #f7d774; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.4px; }
        .card-text { color: #fff; font-size: 15px; line-height: 1.45; }
        .rationale { color: #999; font-size: 13px; line-height: 1.5; margin: 8px 0 0; }
        .card-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
        .act { border: 1px solid #2a2a3a; color: #ccc; background: transparent; padding: 7px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; }
        .act.primary { background: #7fd6a6; border-color: #7fd6a6; color: #0a0a0a; }
        .act.ghost { color: #888; }
        .act:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
