'use client';

import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabase';

export default function ResetPage() {
  return (
    <Suspense fallback={<main className="root"><div className="muted">Cargando…</div></main>}>
      <ResetForm />
    </Suspense>
  );
}

function ResetForm() {
  const router = useRouter();
  const { updatePassword } = useAuth();
  const [ready, setReady] = useState<'loading' | 'ok' | 'invalid'>('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // El cliente usa detectSessionInUrl:false, así que procesamos el link a mano.
    // Soportamos los dos flujos de Supabase: PKCE (?code=...) e implícito (#tokens).
    const run = async () => {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get('code');
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) return setReady('invalid');
          window.history.replaceState(null, '', window.location.pathname);
          return setReady('ok');
        }
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        const at = hash.get('access_token');
        const rt = hash.get('refresh_token');
        if (at && rt) {
          const { error } = await supabase.auth.setSession({ access_token: at, refresh_token: rt });
          if (error) return setReady('invalid');
          window.history.replaceState(null, '', window.location.pathname);
          return setReady('ok');
        }
        // Sin tokens en la URL: ¿ya hay una sesión de recuperación activa?
        const { data } = await supabase.auth.getSession();
        setReady(data.session ? 'ok' : 'invalid');
      } catch {
        setReady('invalid');
      }
    };
    void run();
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (password.length < 6) {
      setErr('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    if (password !== confirm) {
      setErr('Las contraseñas no coinciden.');
      return;
    }
    setBusy(true);
    const r = await updatePassword(password);
    setBusy(false);
    if (r.error) {
      setErr(r.error);
      return;
    }
    setDone(true);
    setTimeout(() => router.replace('/app'), 1500);
  };

  return (
    <main className="root">
      <div className="card">
        <h1>MyCortex</h1>
        <p className="subtitle">Nueva contraseña</p>

        {ready === 'loading' && <div className="muted">Verificando el link…</div>}

        {ready === 'invalid' && (
          <>
            <div className="error">Este link de recuperación es inválido o expiró.</div>
            <button type="button" onClick={() => router.replace('/login')}>
              Volver a entrar
            </button>
          </>
        )}

        {ready === 'ok' && !done && (
          <form onSubmit={onSubmit}>
            <label>Nueva contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={6}
              required
            />
            <label>Repetí la contraseña</label>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              minLength={6}
              required
            />
            {err && <div className="error">{err}</div>}
            <button type="submit" disabled={busy}>
              {busy ? '…' : 'Guardar contraseña'}
            </button>
          </form>
        )}

        {done && <div className="info">¡Listo! Tu contraseña se actualizó. Entrando…</div>}
      </div>
      <style jsx>{`
        .root { display: flex; align-items: center; justify-content: center; min-height: 100vh; padding: 24px; }
        .card { width: 100%; max-width: 380px; background: #111; border-radius: 16px; padding: 32px; display: flex; flex-direction: column; gap: 8px; }
        form { display: flex; flex-direction: column; gap: 8px; }
        h1 { font-size: 36px; font-weight: 800; margin: 0; text-align: center; }
        .subtitle { color: #888; font-size: 13px; text-align: center; margin: 0 0 24px; }
        label { font-size: 12px; color: #999; margin-top: 12px; }
        input { background: #1a1a1a; border: 1px solid #222; border-radius: 8px; color: #fff; padding: 12px 14px; font-size: 15px; font-family: inherit; outline: none; }
        input:focus { border-color: #444; }
        .error { color: #ff6b6b; font-size: 13px; margin-top: 12px; }
        .info { color: #7ec99a; font-size: 13px; margin-top: 12px; line-height: 1.4; }
        .muted { color: #888; font-size: 14px; text-align: center; padding: 12px 0; }
        button { margin-top: 20px; background: #fff; color: #000; border: none; border-radius: 8px; padding: 14px; font-weight: 700; font-size: 15px; cursor: pointer; }
        button:disabled { opacity: 0.5; cursor: not-allowed; }
      `}</style>
    </main>
  );
}
