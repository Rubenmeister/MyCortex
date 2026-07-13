'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  extractEntities,
  getEntity,
  listEntities,
  type Entity,
  type EntityDetail,
  type EntityType,
} from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';

const TYPE_META: Record<EntityType, { label: string; emoji: string }> = {
  persona: { label: 'Personas', emoji: '👤' },
  proyecto: { label: 'Proyectos', emoji: '🚀' },
  organizacion: { label: 'Organizaciones', emoji: '🏢' },
  lugar: { label: 'Lugares', emoji: '📍' },
  tema: { label: 'Temas', emoji: '🏷️' },
  otro: { label: 'Otros', emoji: '•' },
};

export default function GrafoPage() {
  const { current } = useWorkspace();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [filter, setFilter] = useState<EntityType | 'all'>('all');
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setEntities(await listEntities());
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (current) void load();
  }, [current, load]);

  const open = async (id: string) => {
    setDetailLoading(true);
    setError(null);
    try {
      setDetail(await getEntity(id));
    } catch (err) {
      setError(String(err));
    } finally {
      setDetailLoading(false);
    }
  };

  const build = async () => {
    setBusy(true);
    setMsg(null);
    setError(null);
    try {
      const r = await extractEntities();
      setMsg(`Grafo actualizado: ${r.entities} entidades, ${r.mentions} menciones.`);
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const shown = filter === 'all' ? entities : entities.filter((e) => e.type === filter);
  const types = Array.from(new Set(entities.map((e) => e.type)));

  return (
    <div className="page">
      <header className="head">
        <div>
          <h1>Grafo 🕸️</h1>
          <p className="sub">Personas, proyectos y temas de tu segundo cerebro. Toca uno para ver todo sobre él.</p>
        </div>
        <button type="button" className="btn" disabled={busy} onClick={build}>
          {busy ? 'Construyendo…' : 'Construir grafo'}
        </button>
      </header>

      {msg && <div className="info">{msg}</div>}
      {error && <div className="err">{error}</div>}
      {loading && <div className="muted">Cargando…</div>}

      {!loading && entities.length === 0 && (
        <section className="empty">
          <div className="empty-emoji">🕸️</div>
          <div className="empty-title">Tu grafo está vacío</div>
          <div className="empty-sub">Pulsa «Construir grafo» y voy a extraer las entidades de tu material.</div>
        </section>
      )}

      {!loading && entities.length > 0 && (
        <div className="cols">
          <div className="list-col">
            <div className="filters">
              <button type="button" className={filter === 'all' ? 'f active' : 'f'} onClick={() => setFilter('all')}>
                Todas
              </button>
              {types.map((t) => (
                <button key={t} type="button" className={filter === t ? 'f active' : 'f'} onClick={() => setFilter(t)}>
                  {TYPE_META[t].emoji} {TYPE_META[t].label}
                </button>
              ))}
            </div>
            <ul className="list">
              {shown.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    className={detail?.entity.id === e.id ? 'ent active' : 'ent'}
                    onClick={() => open(e.id)}
                  >
                    <span>{TYPE_META[e.type].emoji} {e.name}</span>
                    <span className="mc">{e.mention_count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="detail-col">
            {detailLoading && <div className="muted">Cargando…</div>}
            {!detailLoading && !detail && <div className="muted">Elige una entidad para ver todo sobre ella.</div>}
            {!detailLoading && detail && (
              <div>
                <h2>{TYPE_META[detail.entity.type].emoji} {detail.entity.name}</h2>
                {detail.entity.summary && <p className="ent-summary">{detail.entity.summary}</p>}

                {detail.related.length > 0 && (
                  <div className="related">
                    <span className="rel-tag">Relacionadas:</span>
                    {detail.related.map((r) => (
                      <button key={r.id} type="button" className="rel" onClick={() => open(r.id)}>
                        {TYPE_META[r.type].emoji} {r.name} <span className="rel-c">×{r.count}</span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="nodes-tag">{detail.nodes.length} menciones</div>
                <ul className="nodes">
                  {detail.nodes.map((n) => (
                    <li key={n.id} className="node">
                      <div className="node-top">
                        <span className="node-origin">{n.external_source ?? n.source}</span>
                        <span className="node-date">{new Date(n.created_at).toLocaleDateString()}</span>
                      </div>
                      {n.title && <div className="node-title">{n.title}</div>}
                      <div className="node-body">{n.content.slice(0, 200)}</div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}

      <style jsx>{`
        .page { max-width: 1000px; margin: 0 auto; padding: 32px 24px 96px; }
        .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
        h1 { margin: 0 0 4px; font-size: 24px; }
        .sub { color: #888; font-size: 14px; margin: 0; max-width: 480px; line-height: 1.5; }
        .btn { border: 1px solid #2a2a3a; color: #ccc; background: transparent; padding: 8px 14px; border-radius: 8px; font-size: 13px; cursor: pointer; font-weight: 600; }
        .btn:hover { border-color: #4a4a5a; color: #fff; }
        .btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .info { background: #152030; border: 1px solid #253545; color: #9bc; padding: 9px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
        .err { background: #2a1a1a; border: 1px solid #4a2a2a; color: #ff9b9b; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
        .muted { color: #888; font-size: 13px; padding: 16px 0; }
        .empty { background: #0e0e14; border: 1px solid #1a1a22; border-radius: 14px; padding: 48px 24px; text-align: center; }
        .empty-emoji { font-size: 36px; margin-bottom: 12px; }
        .empty-title { color: #ddd; font-size: 16px; margin-bottom: 6px; font-weight: 600; }
        .empty-sub { color: #888; font-size: 13px; max-width: 380px; margin: 0 auto; line-height: 1.5; }
        .cols { display: grid; grid-template-columns: 280px 1fr; gap: 16px; }
        @media (max-width: 720px) { .cols { grid-template-columns: 1fr; } }
        .filters { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
        .f { background: #111; border: 1px solid #1a1a22; color: #aaa; padding: 4px 10px; border-radius: 8px; font-size: 11px; cursor: pointer; }
        .f.active { background: #1a1a2a; border-color: #2a2a3a; color: #fff; }
        .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; max-height: 70vh; overflow-y: auto; }
        .ent { width: 100%; display: flex; justify-content: space-between; align-items: center; gap: 8px; background: #0f0f16; border: 1px solid #1a1a22; color: #ddd; padding: 8px 12px; border-radius: 8px; font-size: 13px; cursor: pointer; text-align: left; }
        .ent:hover { border-color: #2a2a3a; }
        .ent.active { background: #16131c; border-color: #c79bf2; color: #fff; }
        .mc { color: #666; font-size: 11px; }
        .detail-col { min-width: 0; }
        h2 { margin: 0 0 8px; font-size: 18px; color: #fff; }
        .ent-summary { color: #bbb; font-size: 14px; line-height: 1.55; margin: 0 0 12px; }
        .related { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 14px; }
        .rel-tag { color: #666; font-size: 11px; }
        .rel { background: #16131c; border: 1px solid #271f30; color: #c79bf2; padding: 3px 10px; border-radius: 99px; font-size: 11px; cursor: pointer; }
        .rel:hover { border-color: #c79bf2; }
        .rel-c { color: #777; }
        .nodes-tag { color: #888; font-size: 12px; margin-bottom: 8px; }
        .nodes { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
        .node { background: #0f0f16; border: 1px solid #1a1a22; border-radius: 10px; padding: 10px 12px; }
        .node-top { display: flex; justify-content: space-between; font-size: 11px; color: #777; margin-bottom: 4px; }
        .node-title { color: #fff; font-size: 13px; font-weight: 600; margin-bottom: 2px; }
        .node-body { color: #999; font-size: 12px; line-height: 1.45; }
      `}</style>
    </div>
  );
}
