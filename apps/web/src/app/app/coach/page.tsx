'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  actOnCoachSuggestion,
  getCoachProfile,
  getCoachSuggestions,
  listCoachSuggestions,
  refreshCoachProfile,
  suggestionToTask,
  type CoachGeneration,
  type CoachProfile,
  type GrowthDomain,
  type PersistedCoachSuggestion,
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

const PRIORITY_RANK: Record<PersistedCoachSuggestion['priority'], number> = { alta: 0, media: 1, baja: 2 };
const PRIORITY_META: Record<PersistedCoachSuggestion['priority'], { label: string; color: string }> = {
  alta: { label: 'ALTA', color: '#ff9b9b' },
  media: { label: 'MEDIA', color: '#fb6' },
  baja: { label: 'BAJA', color: '#9bc' },
};
const HORIZON_LABEL: Record<PersistedCoachSuggestion['horizon'], string> = {
  hoy: 'Hoy',
  'esta-semana': 'Esta semana',
  'este-mes': 'Este mes',
};
const TASK_STATUS_LABEL: Record<string, string> = {
  todo: 'por hacer',
  doing: 'en curso',
  done: 'hecha',
};

const LOOKBACKS = [
  { days: 45, label: '45 días' },
  { days: 90, label: '90 días' },
  { days: 180, label: '6 meses' },
];

export default function CoachPage() {
  const { current } = useWorkspace();
  const [generation, setGeneration] = useState<CoachGeneration | null>(null);
  const [inbox, setInbox] = useState<PersistedCoachSuggestion[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lookback, setLookback] = useState(45);
  const [profile, setProfile] = useState<CoachProfile | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadInbox = useCallback(async () => {
    setInboxLoading(true);
    try {
      const rows = await listCoachSuggestions({ limit: 100 });
      rows.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
      setInbox(rows);
    } catch (err) {
      setError(String(err));
    } finally {
      setInboxLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    getCoachProfile()
      .then((p) => {
        if (!cancelled) setProfile(p);
      })
      .catch(() => undefined);
    loadInbox();
    return () => {
      cancelled = true;
    };
  }, [current, loadInbox]);

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
        // save:true persiste las sugerencias para que tengan id y entren a la
        // bandeja de seguimiento (donde se pueden volver tarea).
        const out = await getCoachSuggestions(days, true);
        setGeneration(out);
        await loadInbox();
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [loadInbox],
  );

  const convertToTask = useCallback(async (s: PersistedCoachSuggestion) => {
    setBusyId(s.id);
    setError(null);
    try {
      const { task } = await suggestionToTask(s.id);
      setInbox((prev) =>
        prev.map((it) => (it.id === s.id ? { ...it, task_id: task.id, task_status: task.status } : it)),
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyId(null);
    }
  }, []);

  const act = useCallback(
    async (s: PersistedCoachSuggestion, action: 'done' | 'dismiss' | 'snooze') => {
      setBusyId(s.id);
      setError(null);
      try {
        await actOnCoachSuggestion(s.id, action, action === 'snooze' ? 7 : undefined);
        // La bandeja muestra solo pendientes → sale de la lista.
        setInbox((prev) => prev.filter((it) => it.id !== s.id));
      } catch (err) {
        setError(String(err));
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  return (
    <div className="page">
      <header className="head">
        <div>
          <h1>Coach 🎯</h1>
          <p className="sub">
            Tu mentor de crecimiento. Lee tus notas, mails, docs y eventos, y te propone cómo mejorar
            en salud, ejercicio, proyectos y productividad — fundado en lo que ya sabe de ti. Cada
            sugerencia la puedes volver una tarea con un clic.
          </p>
        </div>
      </header>

      <section className="profile">
        <div className="profile-head">
          <span className="profile-tag">🧠 Lo que sé de ti</span>
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
            Todavía no aprendí tu perfil. Pulsa «Construir perfil» y voy a leer tu material para
            conocerte: en qué andas, tus metas, rutinas y tendencias en el tiempo.
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
          {loading ? 'Pensando…' : 'Generar nuevas sugerencias'}
        </button>
      </div>

      {error && <div className="err">{error}</div>}

      {generation && !loading && (
        <section className="focus-card">
          <div className="focus-tag">⭐ Tu foco de la semana</div>
          <div className="focus-text">{generation.result.focus}</div>
          <p className="summary">{generation.result.summary}</p>
        </section>
      )}

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

      <div className="inbox-head">
        <span className="inbox-tag">🔁 Seguimiento — sugerencias pendientes</span>
        {inbox.length > 0 && <span className="inbox-count">{inbox.length}</span>}
      </div>

      {!loading && inbox.length === 0 && (
        <section className="empty">
          <div className="empty-emoji">🎯</div>
          <div className="empty-title">{inboxLoading ? 'Cargando…' : 'Sin sugerencias pendientes'}</div>
          <div className="empty-sub">
            Pulsa «Generar nuevas sugerencias» y voy a revisar tu segundo cerebro para proponerte
            acciones concretas. Cada lunes también genero un lote automático.
          </div>
        </section>
      )}

      {inbox.length > 0 && (
        <ul className="list">
          {inbox.map((s) => {
            const dm = DOMAIN_META[s.domain] ?? DOMAIN_META.otro;
            const pm = PRIORITY_META[s.priority];
            const busy = busyId === s.id;
            const isTask = Boolean(s.task_id);
            return (
              <li key={s.id} className="card">
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
                <div className="card-actions">
                  {isTask ? (
                    <span className="in-tasks">
                      ✓ En tareas{s.task_status ? ` · ${TASK_STATUS_LABEL[s.task_status] ?? s.task_status}` : ''}
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="act primary"
                      disabled={busy}
                      onClick={() => convertToTask(s)}
                    >
                      {busy ? '…' : '＋ Convertir en tarea'}
                    </button>
                  )}
                  <button type="button" className="act" disabled={busy} onClick={() => act(s, 'done')}>
                    ✓ Hecho
                  </button>
                  <button type="button" className="act ghost" disabled={busy} onClick={() => act(s, 'snooze')}>
                    ⏰ Posponer
                  </button>
                  <button type="button" className="act ghost" disabled={busy} onClick={() => act(s, 'dismiss')}>
                    ✕ Descartar
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {generation && !loading && (
        <div className="meta">
          Analicé {generation.meta.nodesAnalyzed} ítems de los últimos {generation.meta.lookbackDays} días ·{' '}
          {new Date(generation.meta.generatedAt).toLocaleString(undefined, {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
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
        .inbox-head { display: flex; align-items: center; gap: 8px; margin: 8px 0 12px; }
        .inbox-tag { color: #9bd0e0; font-size: 12px; font-weight: 700; letter-spacing: 0.3px; }
        .inbox-count { background: #14141c; border: 1px solid #1f2a30; color: #9bd0e0; font-size: 11px; font-weight: 700; border-radius: 99px; padding: 1px 9px; }
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
        .card-actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 14px; }
        .act { border: 1px solid #2a2a3a; color: #ccc; background: transparent; padding: 7px 12px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; }
        .act:hover { border-color: #3a3a4a; color: #fff; }
        .act.primary { background: #8ab4f8; border-color: #8ab4f8; color: #0a0a0a; }
        .act.primary:hover { opacity: 0.9; }
        .act.ghost { color: #888; }
        .act:disabled { opacity: 0.5; cursor: not-allowed; }
        .in-tasks { color: #7fd6a6; font-size: 12px; font-weight: 700; background: rgba(127,214,166,0.08); border: 1px solid rgba(127,214,166,0.25); border-radius: 8px; padding: 6px 12px; }
        .meta { color: #555; font-size: 11px; text-align: center; margin-top: 24px; }
      `}</style>
    </div>
  );
}
