'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../../lib/auth';
import { WorkspaceProvider } from '../../lib/workspace';
import { WorkspaceSwitcher } from '../../components/WorkspaceSwitcher';

const TABS = [
  { href: '/app/capture', label: 'Capturar', icon: '✎' },
  { href: '/app/ask', label: 'Preguntar', icon: '💬' },
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
          <nav>
            {TABS.map((t) => {
              const active = pathname === t.href || (t.href === '/app/capture' && pathname === '/app');
              return (
                <Link key={t.href} href={t.href} className={active ? 'tab tab-active' : 'tab'}>
                  <span style={{ marginRight: 6 }}>{t.icon}</span>
                  {t.label}
                </Link>
              );
            })}
          </nav>
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
        }
        .brand {
          font-weight: 800;
          font-size: 18px;
        }
        nav {
          display: flex;
          gap: 4px;
          flex: 1;
          margin-left: 24px;
        }
        .tab {
          padding: 6px 14px;
          border-radius: 8px;
          color: #aaa;
          text-decoration: none;
          font-size: 14px;
        }
        .tab:hover {
          background: #1a1a1a;
        }
        .tab-active {
          background: #1a1a1a;
          color: #fff;
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
