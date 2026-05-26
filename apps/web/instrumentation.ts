// Next.js 15 instrumentation hook — carga la config de Sentry para
// server y edge según el runtime activo. Es el punto de entrada oficial
// para inicializar Sentry server-side.
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

// Hook opcional: captura errores de Server Components / Route Handlers
// que no son capturados por error boundaries.
export const onRequestError = Sentry.captureRequestError;
