'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { publicConfig } from '../../../lib/publicConfig';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../lib/auth';

/**
 * Public invitation landing page. Anyone with a valid token can VIEW
 * the invitation (workspace name + inviter + role + expiry). Accepting
 * requires being authenticated as the email the invitation was sent to.
 *
 * Flow:
 *   1. Page loads → GET /invitations/:token (no auth, returns invite details)
 *   2. If unauthed → show "Iniciar sesión para aceptar"
 *   3. If authed but wrong email → show "Esta invitación es para X, no Y"
 *   4. If authed correct email + not expired → "Aceptar" → POST accept → redirect /app
 */

type InvitationView = {
  id: string;
  email: string;
  role: 'admin' | 'member' | 'viewer';
  workspace_name: string;
  inviter_email: string | null;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  expired: boolean;
};

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const [invitation, setInvitation] = useState<InvitationView | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = params?.token;

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${publicConfig.apiUrl}/invitations/${token}`);
      if (res.status === 404) {
        setError('Esta invitación no existe o fue revocada.');
        return;
      }
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json = (await res.json()) as { invitation: InvitationView };
      setInvitation(json.invitation);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async () => {
    if (!session || !token) return;
    setAccepting(true);
    setError(null);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const accessToken = sess.session?.access_token;
      if (!accessToken) throw new Error('not_authenticated');
      const res = await fetch(`${publicConfig.apiUrl}/invitations/${token}/accept`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body?.error === 'email_mismatch') {
          // API no longer echoes the invitation's target email (to avoid
          // disclosing it on token-only guesses), but the FE already has
          // it from the GET above — show that instead.
          throw new Error(
            `Tu cuenta (${body.your_email ?? '?'}) no coincide con la invitación a ${invitation?.email ?? 'este workspace'}. Sal y entra con la cuenta correcta.`,
          );
        }
        if (body?.error === 'invitation_expired') {
          throw new Error('Esta invitación expiró. Pide una nueva al admin.');
        }
        throw new Error(body?.detail ?? `${res.status}`);
      }
      const json = (await res.json()) as { workspace_id: string };
      // Persist target workspace + reload into the app at that workspace
      window.localStorage.setItem('mycortex.workspaceId', json.workspace_id);
      router.push('/app');
    } catch (err) {
      setError(String(err));
    } finally {
      setAccepting(false);
    }
  };

  if (loading || authLoading) {
    return (
      <div className="page">
        <div className="card">
          <div className="muted">Cargando invitación…</div>
        </div>
        <style jsx>{styles}</style>
      </div>
    );
  }

  if (error && !invitation) {
    return (
      <div className="page">
        <div className="card">
          <h1>Invitación no válida</h1>
          <p className="err">{error}</p>
          <Link href="/" className="btn ghost">
            Volver al inicio
          </Link>
        </div>
        <style jsx>{styles}</style>
      </div>
    );
  }

  if (!invitation) return null;

  const myEmail = session?.user.email?.toLowerCase() ?? null;
  const matches = myEmail === invitation.email.toLowerCase();
  const alreadyAccepted = Boolean(invitation.accepted_at);
  const expired = invitation.expired && !alreadyAccepted;

  return (
    <div className="page">
      <div className="card">
        <div className="brand">MyCortex</div>

        {alreadyAccepted ? (
          <>
            <h1>Esta invitación ya fue aceptada</h1>
            <p className="muted">
              Aceptaste esta invitación el {new Date(invitation.accepted_at!).toLocaleDateString()}.
            </p>
            <Link href="/app" className="btn">
              Ir a la app
            </Link>
          </>
        ) : expired ? (
          <>
            <h1>Esta invitación expiró</h1>
            <p className="muted">
              La invitación a <strong>{invitation.workspace_name}</strong> venció el{' '}
              {new Date(invitation.expires_at).toLocaleDateString()}. Pedile al admin que te
              mande una nueva.
            </p>
            <Link href="/" className="btn ghost">
              Volver al inicio
            </Link>
          </>
        ) : (
          <>
            <div className="kicker">Te invitaron a colaborar</div>
            <h1>{invitation.workspace_name}</h1>
            <p className="meta">
              {invitation.inviter_email ? (
                <>
                  <strong>{invitation.inviter_email}</strong> te invitó como{' '}
                  <span className="role-chip">{invitation.role}</span>
                </>
              ) : (
                <>
                  Invitación para <strong>{invitation.email}</strong> como{' '}
                  <span className="role-chip">{invitation.role}</span>
                </>
              )}
            </p>

            {!session ? (
              <>
                <p className="muted small">
                  Iniciá sesión con <strong>{invitation.email}</strong> para aceptar.
                </p>
                <Link
                  href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
                  className="btn"
                >
                  Iniciar sesión / Crear cuenta
                </Link>
              </>
            ) : !matches ? (
              <>
                <p className="err">
                  Estás en sesión como <strong>{myEmail}</strong>, pero esta invitación es para{' '}
                  <strong>{invitation.email}</strong>.
                </p>
                <p className="muted small">
                  Cierra sesión y vuelve a entrar con la cuenta correcta para aceptar.
                </p>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={async () => {
                    await supabase.auth.signOut();
                    router.push(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
                  }}
                >
                  Cerrar sesión y reintentar
                </button>
              </>
            ) : (
              <>
                <p className="muted small">
                  Al aceptar te unís como <strong>{invitation.role}</strong> al workspace{' '}
                  <strong>{invitation.workspace_name}</strong>.
                </p>
                <button
                  type="button"
                  className="btn primary"
                  onClick={accept}
                  disabled={accepting}
                >
                  {accepting ? 'Aceptando…' : 'Aceptar invitación'}
                </button>
              </>
            )}

            {error && <p className="err small">{error}</p>}
          </>
        )}
      </div>

      <style jsx>{styles}</style>
    </div>
  );
}

const styles = `
  .page {
    min-height: 100vh;
    background: #050507;
    color: #eee;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
  }
  .card {
    background: #0e0e14;
    border: 1px solid #1a1a22;
    border-radius: 16px;
    padding: 36px;
    max-width: 440px;
    width: 100%;
  }
  .brand {
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 1px;
    color: #888;
    text-transform: uppercase;
    margin-bottom: 24px;
  }
  .kicker {
    color: #aac;
    font-size: 12px;
    letter-spacing: 1px;
    text-transform: uppercase;
    font-weight: 600;
    margin-bottom: 8px;
  }
  h1 {
    font-size: 26px;
    font-weight: 800;
    letter-spacing: -1px;
    margin: 0 0 16px;
    line-height: 1.15;
  }
  .meta {
    color: #ccc;
    font-size: 14px;
    line-height: 1.55;
    margin: 0 0 24px;
  }
  .meta :global(strong) { color: #fff; }
  .role-chip {
    display: inline-block;
    background: #1a2a5a;
    color: #aac;
    padding: 2px 10px;
    border-radius: 99px;
    font-size: 11px;
    letter-spacing: 0.5px;
    font-weight: 700;
    text-transform: uppercase;
    margin-left: 4px;
  }
  .muted {
    color: #999;
    font-size: 14px;
    line-height: 1.55;
    margin: 0 0 20px;
  }
  .small {
    font-size: 13px;
  }
  .err {
    color: #ff9b9b;
    background: #2a1a1a;
    border: 1px solid #4a2a2a;
    padding: 10px 14px;
    border-radius: 8px;
    margin: 0 0 16px;
  }
  :global(.btn) {
    display: inline-block;
    background: #fff;
    color: #000;
    border: none;
    border-radius: 10px;
    padding: 12px 22px;
    font-weight: 700;
    font-size: 14px;
    text-decoration: none;
    cursor: pointer;
    font-family: inherit;
  }
  :global(.btn:hover) {
    opacity: 0.9;
  }
  :global(.btn:disabled) {
    opacity: 0.45;
    cursor: not-allowed;
  }
  :global(.btn.primary) {
    background: linear-gradient(135deg, #fff, #d8d8e8);
  }
  :global(.btn.ghost) {
    background: transparent;
    color: #ccc;
    border: 1px solid #2a2a3a;
  }
`;
