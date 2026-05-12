'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '../../lib/auth';

/**
 * Wraps the actual login form in a Suspense boundary because
 * useSearchParams() in Next.js 15 forces dynamic rendering — without
 * Suspense the page bails out of static pre-rendering with a build
 * error. Suspense boundary lets the static shell render while the
 * client component hydrates with the search params.
 */
export default function LoginPage() {
  return (
    // @ts-expect-error — multi-version @types/react in workspace (mobile=18,
    // web=19) confuses JSX type unification on Suspense. Runtime is fine.
    <Suspense fallback={<LoginFormFallback />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginFormFallback() {
  // Mirrors LoginForm's shell so users don't see a layout flash before
  // hydration completes.
  return (
    <main style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <div style={{ color: '#888' }}>Cargando…</div>
    </main>
  );
}

function LoginForm() {
  const { signIn } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Allow callers (e.g. /invite/:token) to send the user back to a
  // specific page after login. Only accept relative paths to avoid open
  // redirect vulnerabilities.
  const next = searchParams.get('next');
  const safeNext = next && next.startsWith('/') ? next : '/app';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const r = await signIn(email.trim(), password);
    setBusy(false);
    if (r.error) setErr(r.error);
    else router.replace(safeNext);
  };

  return (
    <main className="login-root">
      <form className="card" onSubmit={onSubmit}>
        <h1>MyCortex</h1>
        <p className="subtitle">Tu segundo cerebro</p>
        <label>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="tu@email.com"
          autoComplete="email"
          required
        />
        <label>Contraseña</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="••••••••"
          autoComplete="current-password"
          required
        />
        {err && <div className="error">{err}</div>}
        <button type="submit" disabled={busy}>
          {busy ? '…' : 'Entrar'}
        </button>
      </form>
      <style jsx>{`
        .login-root {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 24px;
        }
        .card {
          width: 100%;
          max-width: 380px;
          background: #111;
          border-radius: 16px;
          padding: 32px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        h1 {
          font-size: 36px;
          font-weight: 800;
          margin: 0;
          text-align: center;
        }
        .subtitle {
          color: #888;
          font-size: 13px;
          text-align: center;
          margin: 0 0 24px;
        }
        label {
          font-size: 12px;
          color: #999;
          margin-top: 12px;
        }
        input {
          background: #1a1a1a;
          border: 1px solid #222;
          border-radius: 8px;
          color: #fff;
          padding: 12px 14px;
          font-size: 15px;
          font-family: inherit;
          outline: none;
        }
        input:focus {
          border-color: #444;
        }
        .error {
          color: #ff6b6b;
          font-size: 13px;
          margin-top: 12px;
        }
        button {
          margin-top: 24px;
          background: #fff;
          color: #000;
          border: none;
          border-radius: 8px;
          padding: 14px;
          font-weight: 700;
          font-size: 15px;
          cursor: pointer;
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
      `}</style>
    </main>
  );
}
