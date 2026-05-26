// Sentry config para el cliente (browser).
// Se carga vía instrumentation-client.ts en Next.js 15.
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV,
    // 10% de sesiones con traces. Las sesiones con errores siempre se
    // envían completas (replaysOnErrorSampleRate=1).
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0.0, // Off en beta — Session Replay come storage
    replaysOnErrorSampleRate: 1.0, // Solo cuando hay error, capturamos replay
    integrations: [
      Sentry.replayIntegration({
        // No grabar input fields ni texto sensible.
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
      }),
    ],
    // Filtrar errores que sabemos que son ruido (ad blockers, extensiones,
    // etc.). Agregar más a medida que aparezcan en el dashboard.
    ignoreErrors: [
      'ResizeObserver loop limit exceeded',
      'Non-Error promise rejection captured',
      // Extensiones de browser que tocan el DOM.
      /chrome-extension:\/\//,
      /moz-extension:\/\//,
    ],
  });
}
