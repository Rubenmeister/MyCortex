'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useWorkspace } from '../../lib/workspace';
import { listRecent, type RecentNode } from '../../lib/api';
import { publicConfig } from '../../lib/publicConfig';
import { supabase } from '../../lib/supabase';

type Integration = {
  provider: 'google_drive' | 'gmail' | 'google_calendar' | 'notion' | 'slack';
  status: 'active' | 'revoked' | 'error';
};

/**
 * Home dashboard. Shows different layouts depending on user state:
 *   - First-time (0 sources, 0 nodes) → onboarding checklist
 *   - Active user → quick-action grid + recent activity preview
 *
 * Used to redirect blindly to /app/capture; that was hostile for new
 * users who land here without knowing what to do.
 */
export default function AppHomePage() {
  const { current, workspaces } = useWorkspace();
  const [integrations, setIntegrations] = useState<Integration[] | null>(null);
  const [recent, setRecent] = useState<RecentNode[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!current) return;
    setLoading(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token;
      const headers: Record<string, string> = token
        ? { Authorization: `Bearer ${token}`, 'X-MyCortex-Workspace-Id': current.id }
        : {};

      const [intResp, nodes] = await Promise.all([
        fetch(`${publicConfig.apiUrl}/integrations`, { headers }).then((r) =>
          r.ok ? r.json() : { integrations: [] },
        ),
        listRecent(5).catch(() => []),
      ]);
      setIntegrations(intResp.integrations as Integration[]);
      setRecent(nodes);
    } catch {
      setIntegrations([]);
      setRecent([]);
    } finally {
      setLoading(false);
    }
  }, [current]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!current || loading) {
    return (
      <div className="page">
        <div className="muted">Cargando…</div>
        <style jsx>{styles}</style>
      </div>
    );
  }

  const activeIntegrations = (integrations ?? []).filter((i) => i.status === 'active');
  const hasDrive = activeIntegrations.some((i) => i.provider === 'google_drive');
  const hasGmail = activeIntegrations.some((i) => i.provider === 'gmail');
  const hasCal = activeIntegrations.some((i) => i.provider === 'google_calendar');
  const hasNotes = (recent?.length ?? 0) > 0;
  const completed = [hasDrive, hasGmail, hasCal, hasNotes].filter(Boolean).length;
  const total = 4;
  const isNewUser = completed === 0;

  return (
    <div className="page">
      <header className="head">
        <h1>Hola{current.is_personal ? '' : `, ${current.name}`}</h1>
        <p className="sub">
          {isNewUser
            ? 'Conectá tu primera fuente para empezar a usar tu segundo cerebro.'
            : `Tu segundo cerebro tiene ${activeIntegrations.length} fuente${
                activeIntegrations.length === 1 ? '' : 's'
              } activa${activeIntegrations.length === 1 ? '' : 's'}.`}
        </p>
      </header>

      {/* Onboarding checklist — visible always until 100% done */}
      {completed < total && (
        <section className="card onboarding">
          <div className="onboarding-head">
            <div>
              <div className="onboarding-title">Empezar</div>
              <div className="onboarding-sub">
                Cada paso desbloquea más capacidades de MyCortex.
              </div>
            </div>
            <div className="progress">
              <span className="progress-num">{completed}/{total}</span>
            </div>
          </div>

          <ul className="checklist">
            <ChecklistItem
              done={hasNotes}
              title="Capturá tu primera nota"
              desc="Texto rápido, voz, o desde Telegram. Lo que sea que quieras recordar."
              href="/app/capture"
              cta="Capturar"
              icon="✎"
            />
            <ChecklistItem
              done={hasDrive}
              title="Conectá Google Drive"
              desc="PDFs, Google Docs, Sheets — todo se indexa y se vuelve buscable + citable."
              href="/app/settings/integrations"
              cta="Conectar"
              icon="📁"
            />
            <ChecklistItem
              done={hasGmail}
              title="Conectá Gmail"
              desc="Tus mails recientes (90 días INBOX por defecto). Ideal para 'qué me dijo X sobre Y'."
              href="/app/settings/integrations"
              cta="Conectar"
              icon="📧"
            />
            <ChecklistItem
              done={hasCal}
              title="Conectá Google Calendar"
              desc="Eventos pasados + próximos. El briefing diario los incluye automáticamente."
              href="/app/settings/integrations"
              cta="Conectar"
              icon="📅"
            />
          </ul>
        </section>
      )}

      {/* Quick actions — primary tools */}
      <section className="grid">
        <Link href="/app/capture" className="tile">
          <div className="tile-icon">✎</div>
          <div className="tile-title">Capturar</div>
          <div className="tile-desc">Nota rápida o voz</div>
        </Link>
        <Link href="/app/ask" className="tile primary">
          <div className="tile-icon">💬</div>
          <div className="tile-title">Preguntar</div>
          <div className="tile-desc">Tu cerebro responde con citas</div>
        </Link>
        <Link href="/app/digest" className="tile">
          <div className="tile-icon">☀️</div>
          <div className="tile-title">Briefing</div>
          <div className="tile-desc">Tu mañana resumida</div>
        </Link>
        <Link href="/app/alerts" className="tile">
          <div className="tile-icon">🚨</div>
          <div className="tile-title">Alertas</div>
          <div className="tile-desc">Urgencias en tiempo real</div>
        </Link>
      </section>

      {/* Recent activity preview (only for active users) */}
      {hasNotes && recent && recent.length > 0 && (
        <section className="recent">
          <div className="recent-head">
            <h3>Actividad reciente</h3>
            <Link href="/app/nodes" className="recent-more">
              Ver todas →
            </Link>
          </div>
          <ul className="recent-list">
            {recent.slice(0, 5).map((n) => (
              <li key={n.id}>
                <div className="recent-source">
                  {n.source === 'drive'
                    ? '📁'
                    : n.source === 'gmail'
                      ? '📧'
                      : n.source === 'calendar'
                        ? '📅'
                        : n.source === 'telegram'
                          ? '📲'
                          : '✎'}
                </div>
                <div className="recent-body">
                  <div className="recent-title">{n.title ?? '(sin título)'}</div>
                  <div className="recent-meta">
                    {n.category} · {new Date(n.created_at).toLocaleDateString()}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Multi-workspace hint */}
      {workspaces.length === 1 && current.is_personal && completed >= 2 && (
        <section className="hint-card">
          <div className="hint-emoji">🏢</div>
          <div>
            <div className="hint-title">¿Vas a usar MyCortex en equipo?</div>
            <div className="hint-desc">
              Creá un workspace de equipo para compartir tu segundo cerebro con otros miembros.
              Cada uno tiene su propio acceso con roles.
            </div>
            <Link href="/app/settings" className="hint-cta">
              Crear workspace de equipo →
            </Link>
          </div>
        </section>
      )}

      <style jsx>{styles}</style>
    </div>
  );
}

function ChecklistItem({
  done,
  title,
  desc,
  href,
  cta,
  icon,
}: {
  done: boolean;
  title: string;
  desc: string;
  href: string;
  cta: string;
  icon: string;
}) {
  return (
    <li className={done ? 'check-item done' : 'check-item'}>
      <div className="check-box">{done ? '✓' : icon}</div>
      <div className="check-body">
        <div className="check-title">{title}</div>
        <div className="check-desc">{desc}</div>
      </div>
      {!done && (
        <Link href={href} className="check-cta">
          {cta} →
        </Link>
      )}
    </li>
  );
}

const styles = `
  .page { max-width: 880px; margin: 0 auto; padding: 32px 24px 96px; }
  .head { margin-bottom: 28px; }
  h1 { margin: 0 0 6px; font-size: 28px; letter-spacing: -1px; }
  .sub { color: #888; font-size: 14px; margin: 0; }
  .muted { color: #888; font-size: 13px; }

  .card { background: #0e0e14; border: 1px solid #1a1a22; border-radius: 14px; padding: 22px; margin-bottom: 24px; }
  .onboarding-head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 18px; }
  .onboarding-title { color: #fff; font-size: 16px; font-weight: 700; }
  .onboarding-sub { color: #888; font-size: 13px; margin-top: 2px; }
  .progress-num { background: #1a1a2a; color: #aac; padding: 4px 12px; border-radius: 99px; font-size: 12px; font-weight: 700; border: 1px solid #2a2a3a; }
  .checklist { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; }
  .check-item { display: grid; grid-template-columns: auto 1fr auto; gap: 14px; align-items: center; padding: 14px 16px; background: #0a0a12; border: 1px solid #15151c; border-radius: 10px; }
  .check-item.done { opacity: 0.55; }
  .check-box { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; background: #1a1a2a; border-radius: 50%; font-size: 16px; }
  .check-item.done .check-box { background: #1a3a1a; color: #9c9; }
  .check-title { color: #fff; font-size: 14px; font-weight: 600; }
  .check-desc { color: #888; font-size: 12px; line-height: 1.45; margin-top: 2px; }
  :global(.check-cta) { color: #ddd; background: transparent; border: 1px solid #2a2a3a; padding: 6px 14px; border-radius: 8px; font-size: 12px; text-decoration: none; font-weight: 600; }
  :global(.check-cta:hover) { border-color: #4a4a5a; color: #fff; }

  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; margin-bottom: 28px; }
  :global(.tile) { display: flex; flex-direction: column; gap: 6px; background: #0e0e14; border: 1px solid #1a1a22; border-radius: 12px; padding: 22px 20px; text-decoration: none; color: #eee; transition: border-color 0.15s; }
  :global(.tile:hover) { border-color: #2a2a3a; }
  :global(.tile.primary) { background: linear-gradient(135deg, #1a1a3a 0%, #1a0e22 100%); border-color: #2a2a5a; }
  :global(.tile-icon) { font-size: 22px; }
  :global(.tile-title) { color: #fff; font-size: 15px; font-weight: 700; }
  :global(.tile-desc) { color: #888; font-size: 12px; }

  .recent { background: #0e0e14; border: 1px solid #1a1a22; border-radius: 14px; padding: 22px; margin-bottom: 24px; }
  .recent-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
  .recent h3 { margin: 0; font-size: 14px; color: #aaa; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
  :global(.recent-more) { color: #888; font-size: 12px; text-decoration: none; }
  :global(.recent-more:hover) { color: #ccc; }
  .recent-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
  .recent-list li { display: flex; gap: 12px; align-items: center; padding: 10px 12px; background: #0a0a12; border: 1px solid #15151c; border-radius: 8px; }
  .recent-source { font-size: 16px; }
  .recent-body { flex: 1; min-width: 0; }
  .recent-title { color: #ddd; font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .recent-meta { color: #666; font-size: 11px; margin-top: 1px; }

  .hint-card { display: flex; gap: 18px; background: #14141c; border: 1px dashed #2a2a3a; border-radius: 12px; padding: 22px 24px; align-items: flex-start; }
  .hint-emoji { font-size: 28px; }
  .hint-title { color: #fff; font-size: 15px; font-weight: 700; margin-bottom: 4px; }
  .hint-desc { color: #999; font-size: 13px; line-height: 1.55; margin-bottom: 10px; }
  :global(.hint-cta) { color: #aac; font-size: 13px; text-decoration: none; font-weight: 600; }
  :global(.hint-cta:hover) { color: #fff; }
`;
