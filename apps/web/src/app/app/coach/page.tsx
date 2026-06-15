'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  getCoachProfile,
  getCoachSuggestions,
  refreshCoachProfile,
  type CoachGeneration,
  type CoachProfile,
  type CoachSuggestion,
  type GrowthDomain,
} from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';

const DOMAIN_META: Record<GrowthDomain, { label: string; emoji: string; color: string }> = {
  salud: { label: 'Salud', emoji: '🩺', color: '#7fd6a6' },
  ejercicio: { label: 'Ejercicio', emoji: '💪', color: '#f0a868' },
  proyectos: { label: 'Proyectos', emoji: '🚀', color: '#8ab4f8' },
  productividad: { label: 'Productividad', emoji: '⚡', color: '#f7d774' },
  aprendizaje: { label: 'Aprendizaje', emoji: '📚', color: '#c79bf2' },
  finanzas: { label: 'Finanzas', emoji: '💰', color: '#6fd6c4' },
  relaciones: { label: 'Relaciones', emoji: '🤝', color: '#f29bb5' },
  bienestar: { label: 'Bienestar', emoji: '🧘', color: '#9bd0e0' },
  otro: { label: 'Otro', emoji: '•', color: '#9aa' },
};

const PRIORITY_RANK: Record<CoachSuggestion['priority'], number> = { alta: 0, media: 1, baja: 2 };
const PRIORITY_META: Record<CoachSuggestion['priority'], { label: string; color: string }> = {
  alta: { label: 'ALTA', color: '#ff9b9b' },
  media: { label: 'MEDIA', color: '#fb6' },
  baja: { label: 'BAJA', color: '#9bc' },
};
const HORIZON_LABEL: Record<CoachSuggestion['horizon'], string> = {
  hoy: 'Hoy',
  'esta-semana': 'Esta semana',
  'este-mes': 'Este mes',
};

const LOOKBACKS = [
  { days: 45, label: '45 días' },
  { days: 90, label: '90 días' },
  { days: 180, label: '6 meses' },
];

export default function CoachPage() {
  const { current } = useWorkspace();
  const [data, setData] = useState<CoachGeneration | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookback, setLookback] = useState(45);
  const [profile, setProfile] = useState<CoachProfile | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    getCoachProfile()
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [current]);

  const refreshProfile = useCallback(async () => {
    setProfileBusy(true);
    setError(null);
    try {
      setProfile(await refreshCoachProfile());
    } catch (err) {
      setError(String(err));
    } finally {
      setProfileBusy(false);
    }
  }, []);

  const generate = useCallback(
    async (days: number) => {
      setLoading(true);
      setError(null);
      try {
        const out = await getCoachSuggestions(days);
        setData(out);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const suggestions = data
    ? [...data.result.suggestions].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])
    : [];

  return (
    <div className="page">
      <header className="head">
        <div>
          <h1>Coach 🎯</h1>
          <p className="sub">
            Tu mentor de crecimiento. Lee tus notas, mails, docs y eventos, y te propone cómo mejorar
            en salud, ejercicio, proyectos y productividad — fundado en lo que ya sabe de vos.
          </p>
        </div>
      </header>

      <section className="profile">
        <div className="profile-head">
          <span className="profile-tag">🧠 Lo que sé de vos</span>
          <button type="button" className="lb" disabled={profileBusy || !current} onClick={refreshProfile}>
            {profileBusy ? 'Aprendiendo…' : profile && profile.summary ? 'Actualizar' : 'Construir perfil'}
          </button>
        </div>
        {profile && profile.summary ? (
          <div className="profile-body">
            <p className="profile-summary">{profile.summary}</p>
            {profile.focus_areas?.length > 0 && (
              <div className="chips">
                {profile.focus_areas.map((f, i) => (
                  <span key={i} className="chip">{f}</span>
                ))}
              </div>
            )}
            {profile.trends && <div className="profile-row"><b>Tendencias:</b> {profile.trends}</div>}
            {profile.wellbeing && <div className="profile-row"><b>Bienestar:</b> {profile.wellbeing}</div>}
          </div>
        ) : (
          <p className="profile-empty">
            Todavía no aprendí tu perfil. Apretá «Construir perfil» y voy a leer tu material para
            conocerte: en qué andás, tus metas, rutinas y tendencias en el tiempo.
          </p>
        )}
      </section>

      <div className="controls">
        <div className="lookback">
          <span className="lb-label">Analizar</span>
          {LOOKBACKS.map((l) => (
            <button
              key={l.days}
              type="button"
              className={lookback === l.days ? 'lb active' : 'lb'}
              onClick={() => setLookback(l.days)}
              disabled={loading}
            >
              {l.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn primary"
          disabled={loading || !current}
          onClick={() => generate(lookback)}
        >
          {loading ? 'Pensando…' : data ? 'Regenerar' : 'Generar mis sugerencias'}
        </button>
      </div>

      {error && <div className="err">{error}</div>}

      {loading && (
        <section className="empty">
          <div className="empty-emoji">🧠</div>
          <div className="empty-title">Analizando tu material…</div>
          <div className="empty-sub">
            Estoy leyendo tus últimas notas, mails y eventos para encontrar oportunidades de
            crecimiento. Esto puede tardar unos segundos.
          </div>
        </section>
      )}

      {!loading && !data && (
        <section className="empty">
          <div className="empty-emoji">🎯</div>
          <div className="empty-title">Listo para tu coaching</div>
          <div className="empty-sub">
            Apretá «Generar mis sugerencias» y voy a revisar tu segundo cerebro para proponerte
            acciones concretas de mejora. Cuanto más material tengas conectado, mejor el análisis.
          </div>
        </section>
      )}

      {!loading && data && (
        <>
          <section className="focus-card">
            <div className="focus-tag">⭐ Tu foco de la semana</div>
            <div className="focus-text">{data.result.focus}</div>
            <p className="summary">{data.result.summary}</p>
          </section>

          {suggestions.length === 0 ? (
            <section className="empty">
              <div className="empty-emoji">🌱</div>
              <div className="empty-title">Todavía no hay suficiente para coachear</div>
              <div className="empty-sub">
                Cargá más notas sobre tus proyectos y metas (o conectá Gmail/Drive/Calendar) y volvé
                a generar.
              </div>
            </section>
          ) : (
            <ul className="list">
              {suggestions.map((s, i) => {
                const dm = DOMAIN_META[s.domain] ?? DOMAIN_META.otro;
                const pm = PRIORITY_META[s.priority];
                const cited = s.sourceNodeIds
                  .map((id) => data.citedNodes[id])
                  .filter(Boolean);
                return (
                  <li key={i} className="card">
                    <div className="card-head">
                      <span className="domain-chip" style={{ color: dm.color, borderColor: dm.color }}>
                        {dm.emoji} {dm.label}
                      </span>
                      <span className="priority" style={{ color: pm.color }}>
                        ● {pm.label}
                      </span>
                      <span className="horizon">{HORIZON_LABEL[s.horizon]}</span>
                    </div>
                    <div className="card-title">{s.title}</div>
                    <p className="insight">{s.insight}</p>
                    <div className="action">
                      <span className="action-tag">→ Próximo paso</span>
                      {s.action}
                    </div>
                    {cited.length > 0 && (
                      <div className="sources">
                        <span className="src-tag">Basado en:</span>
                        {cited.map((c, j) => (
                          <span key={j} className="src" title={c!.snippet}>
                            {c!.origin} › {c!.title ?? c!.snippet.slice(0, 40)}
                          </span>
                        ))}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="meta">
            Analicé {data.meta.nodesAnalyzed} ítems de los últimos {data.meta.lookbackDays} días ·{' '}
            {new Date(data.meta.generatedAt).toLocaleString(undefined, {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </div>
        </>
      )}

      <style jsx>{`
        .page { max-width: 820px; margin: 0 auto; padding: 32px 24px 96px; }
        .head { margin-bottom: 20px; }
        h1 { margin: 0 0 6px; font-size: 24px; }
        .sub { color: #888; font-size: 14px; margin: 0; max-width: 600px; line-height: 1.5; }
        .profile { background: #0e0e14; border: 1px solid #1a1a22; border-radius: 12px; padding: 16px 18px; margin-bottom: 20px; }
        .profile-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 10px; }
        .profile-tag { color: #c79bf2; font-size: 12px; font-weight: 700; letter-spacing: 0.3px; }
        .profile-summary { color: #ddd; font-size: 14px; line-height: 1.55; margin: 0 0 10px; }
        .chips { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
        .chip { color: #9bd0e0; font-size: 11px; background: #14141c; border: 1px solid #1f2a30; border-radius: 99px; padding: 2px 10px; }
        .profile-row { color: #aaa; font-size: 13px; line-height: 1.5; margin-top: 4px; }
        .profile-row b { color: #ccc; }
        .profile-empty { color: #888; font-size: 13px; line-height: 1.5; margin: 0; }
        .controls { display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap; margin-bottom: 24px; }
        .lookback { display: flex; align-items: center; gap: 6px; }
        .lb-label { color: #777; font-size: 12px; margin-right: 4px; }
        .lb { background: #111; border: 1px solid #1a1a22; color: #aaa; padding: 6px 12px; border-radius: 8px; font-size: 12px; cursor: pointer; }
        .lb:hover { border-color: #2a2a3a; color: #ccc; }
        .lb.active { background: #1a1a2a; border-color: #2a2a3a; color: #fff; }
        .lb:disabled { opacity: 0.5; cursor: not-allowed; }
        .btn { border: 1px solid #2a2a3a; color: #ccc; background: transparent; padding: 9px 18px; border-radius: 8px; font-size: 14px; cursor: pointer; font-weight: 600; }
        .btn.primary { background: #fff; color: #000; border-color: #fff; }
        .btn.primary:hover { opacity: 0.9; }
        .btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .err { background: #2a1a1a; border: 1px solid #4a2a2a; color: #ff9b9b; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
        .empty { background: #0e0e14; border: 1px solid #1a1a22; border-radius: 14px; padding: 48px 24px; text-align: center; }
        .empty-emoji { font-size: 36px; margin-bottom: 12px; }
        .empty-title { color: #ddd; font-size: 16px; margin-bottom: 6px; font-weight: 600; }
        .empty-sub { color: #888; font-size: 13px; max-width: 420px; margin: 0 auto; line-height: 1.5; }
        .focus-card { background: linear-gradient(135deg, #161620, #12121a); border: 1px solid #2a2a3a; border-radius: 14px; padding: 20px 22px; margin-bottom: 20px; }
        .focus-tag { color: #f7d774; font-size: 12px; font-weight: 700; letter-spacing: 0.4px; margin-bottom: 8px; }
        .focus-text { color: #fff; font-size: 17px; font-weight: 600; line-height: 1.45; margin-bottom: 12px; }
        .summary { color: #aaa; font-size: 14px; line-height: 1.55; margin: 0; }
        .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 12px; }
        .card { background: #0f0f16; border: 1px solid #1a1a22; border-radius: 12px; padding: 16px 18px; }
        .card-head { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; font-size: 11px; }
        .domain-chip { display: inline-block; padding: 2px 10px; border-radius: 99px; border: 1px solid; font-weight: 700; font-size: 11px; }
        .priority { font-weight: 700; font-size: 10px; letter-spacing: 0.5px; }
        .horizon { color: #777; margin-left: auto; font-size: 11px; }
        .card-title { color: #fff; font-size: 15px; font-weight: 700; margin-bottom: 6px; line-height: 1.35; }
        .insight { color: #bbb; font-size: 14px; line-height: 1.55; margin: 0 0 12px; }
        .action { color: #e6e6e6; font-size: 14px; line-height: 1.5; background: rgba(255,255,255,0.03); border-left: 2px solid #3a3a4a; padding: 10px 12px; border-radius: 6px; }
        .action-tag { display: block; color: #8ab4f8; font-size: 11px; font-weight: 700; margin-bottom: 4px; }
        .sources { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 12px; }
        .src-tag { color: #666; font-size: 11px; }
        .src { color: #888; font-size: 11px; background: #14141c; border: 1px solid #1f1f2a; border-radius: 6px; padding: 2px 8px; max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .meta { color: #555; font-size: 11px; text-align: center; margin-top: 24px; }
      `}</style>
    </div>
  );
}
