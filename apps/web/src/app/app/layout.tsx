'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../lib/auth';
import { WorkspaceProvider, useWorkspace } from '../../lib/workspace';
import { WorkspaceSwitcher } from '../../components/WorkspaceSwitcher';
import { getAlertsUnreadCount } from '../../lib/api';

const TABS = [
  { href: '/app/coach', label: 'Coach', icon: '🎯' },
  { href: '/app/capture', label: 'Capturar', icon: '✎' },
  { href: '/app/ask', label: 'Preguntar', icon: '💬' },
  { href: '/app/digest', label: 'Briefing', icon: '☀️' },
  { href: '/app/alerts', label: 'Alertas', icon: '🚨' },
  { href: '/app/nodes', label: 'Notas', icon: '☰' },
  { href: '/app/settings', label: 'Ajustes', icon: '⚙' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { session, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !session) router.replace('/login');
  }, [loading, session, router]);

  if (loading || !session) {
    return (
      <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ color: '#888' }}>Cargando…</div>
      </main>
    );
  }

  return (
    <WorkspaceProvider>
      <div className="shell">
        <header className="topbar">
          <div className="brand">MyCortex</div>
          <WorkspaceSwitcher />
          <NavTabs pathname={pathname} />

          <div className="user">
            <span style={{ color: '#888', fontSize: 12 }}>{session.user.email}</span>
            <button
              type="button"
              onClick={async () => {
                await signOut();
                router.replace('/login');
              }}
            >
              Salir
            </button>
          </div>
        </header>
        <main className="content">{children}</main>
      <style jsx>{`
        .shell {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
        }
        .topbar {
          display: flex;
          align-items: center;
          gap: 16px;
          padding: 14px 24px;
          background: #0f0f0f;
          border-bottom: 1px solid #1a1a1a;
          flex-wrap: wrap;
        }
        @media (max-width: 720px) {
          .topbar {
            padding: 10px 14px;
            gap: 10px;
          }
        }
        .brand {
          font-weight: 800;
          font-size: 18px;
        }
        .user {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .user button {
          background: transparent;
          border: 1px solid #2a2a2a;
          color: #aaa;
          padding: 6px 14px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 13px;
        }
        .user button:hover {
          color: #fff;
          border-color: #444;
        }
        .content {
          flex: 1;
        }
      `}</style>
      </div>
    </WorkspaceProvider>
  );
}

/**
 * Renders the nav inside WorkspaceProvider so it can subscribe to the
 * current workspace and refresh the alerts unread count when the user
 * switches contexts. Polls every 60s — cheap (1 indexed count query)
 * and keeps the badge fresh without needing realtime subscriptions.
 */
function NavTabs({ pathname }: { pathname: string }) {
  const { current } = useWorkspace();
  const [unread, setUnread] = useState<number>(0);

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    const fetchCount = async () => {
      try {
        const n = await getAlertsUnreadCount();
        if (!cancelled) setUnread(n);
      } catch {
        /* badge is a nice-to-have, fail silently */
      }
    };
    void fetchCount();
    const id = setInterval(fetchCount, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [current]);

  return (
    <nav>
      {TABS.map((t) => {
        const active =
          pathname === t.href || (t.href === '/app/capture' && pathname === '/app');
        const showBadge = t.href === '/app/alerts' && unread > 0;
        return (
          <Link key={t.href} href={t.href} className={active ? 'tab tab-active' : 'tab'}>
            <span style={{ marginRight: 6 }}>{t.icon}</span>
            {t.label}
            {showBadge && <span className="tab-badge">{unread > 99 ? '99+' : unread}</span>}
          </Link>
        );
      })}
      <style jsx>{`
        nav {
          display: flex;
          gap: 4px;
          flex: 1;
          margin-left: 24px;
          flex-wrap: wrap;
        }
        .tab {
          padding: 6px 14px;
          border-radius: 8px;
          color: #aaa;
          text-decoration: none;
          font-size: 14px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        .tab:hover {
          background: #1a1a1a;
        }
        .tab-active {
          background: #1a1a1a;
          color: #fff;
        }
        .tab-badge {
          background: #d33;
          color: #fff;
          font-size: 10px;
          font-weight: 700;
          padding: 1px 7px;
          border-radius: 99px;
          line-height: 1.4;
        }
        @media (max-width: 720px) {
          nav {
            order: 3;
            width: 100%;
            margin-left: 0;
            margin-top: 4px;
            overflow-x: auto;
            flex-wrap: nowrap;
            padding-bottom: 2px;
          }
          .tab {
            padding: 5px 10px;
            font-size: 13px;
            flex-shrink: 0;
          }
        }
      `}</style>
    </nav>
  );
}
