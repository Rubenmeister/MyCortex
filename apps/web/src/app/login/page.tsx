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
    // El @ts-expect-error que vivía acá ya no es necesario — al quitar los
    // workspace deps del mobile app, @types/react se unificó en la workspace
    // y JSX type unification anda. Si vuelve a fallar en Vercel build,
    // re-meter el directive arriba de <Suspense>.
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
  const { signIn, signUp } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Allow callers (e.g. /invite/:token) to send the user back to a
  // specific page after login. Only accept relative paths to avoid open
  // redirect vulnerabilities.
  const next = searchParams.get('next');
  const safeNext = next && next.startsWith('/') ? next : '/app';

  // `mode` toggles the same form between signin and signup so we avoid
  // a second route. Defaults to signin; if the URL has ?mode=signup
  // (used by the shared invitation link) we land directly on signup.
  const initialMode = searchParams.get('mode') === 'signup' ? 'signup' : 'signin';
  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setErr('La contraseña debe tener al menos 6 caracteres.');
      return;
    }
    setBusy(true);
    setErr(null);
    setInfo(null);
    if (mode === 'signin') {
      const r = await signIn(email.trim(), password);
      setBusy(false);
      if (r.error) setErr(r.error);
      else router.replace(safeNext);
    } else {
      const r = await signUp(email.trim(), password);
      setBusy(false);
      if (r.error) {
        setErr(r.error);
      } else if (r.needsConfirmation) {
        // Email confirmation flow: tell the user to check their inbox.
        setInfo('Te enviamos un email para confirmar tu cuenta. Una vez confirmado, podrás entrar.');
      } else {
        // Session was returned directly — auto-redirect into the app.
        router.replace(safeNext);
      }
    }
  };

  const isSignup = mode === 'signup';

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
          autoComplete={isSignup ? 'new-password' : 'current-password'}
          minLength={6}
          required
        />
        {err && <div className="error">{err}</div>}
        {info && <div className="info">{info}</div>}
        <button type="submit" disabled={busy}>
          {busy ? '…' : isSignup ? 'Crear cuenta' : 'Entrar'}
        </button>
        <button
          type="button"
          className="link"
          onClick={() => {
            setMode(isSignup ? 'signin' : 'signup');
            setErr(null);
            setInfo(null);
          }}
        >
          {isSignup ? '¿Ya tenés cuenta? Entrá' : '¿Sos nuevo? Creá tu cuenta'}
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
        .info {
          color: #7ec99a;
          font-size: 13px;
          margin-top: 12px;
          line-height: 1.4;
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
        button.link {
          margin-top: 16px;
          background: transparent;
          color: #888;
          font-weight: 400;
          font-size: 13px;
          padding: 8px;
        }
        button.link:hover {
          color: #ccc;
        }
      `}</style>
    </main>
  );
}
