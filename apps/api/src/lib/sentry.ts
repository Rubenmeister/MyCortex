/**
 * Inicialización de Sentry para el API.
 *
 * Llamar UNA SOLA VEZ desde index.ts ANTES de buildServer(). Sentry parchea
 * los módulos http/fastify en tiempo de require, así que tiene que correr
 * antes de que se importen los modules de la app.
 *
 * Si SENTRY_DSN no está configurado (típicamente en dev), el SDK se carga
 * pero `init` con DSN vacío equivale a "disabled" — no envía datos, pero
 * los `Sentry.captureException` no rompen. Eso permite escribir código
 * que loguee a Sentry sin ramificar por env.
 */
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';

let initialized = false;

export function initSentry(opts: {
  dsn: string | undefined;
  environment: string;
  tracesSampleRate: number;
}): void {
  if (initialized) return;
  initialized = true;

  if (!opts.dsn) {
    // Mismo SDK, sin DSN: captureException es no-op. Útil en dev/test.
    return;
  }

  Sentry.init({
    dsn: opts.dsn,
    environment: opts.environment,
    // Performance tracing: muestreamos `tracesSampleRate` de las requests.
    // 10% en producción evita quemar cupo y captura suficiente para ver
    // regresiones de p95.
    tracesSampleRate: opts.tracesSampleRate,
    // Profiling muestreamos sobre los traces ya muestreados. Profiles son
    // caros, así que profilesSampleRate=1.0 = "todos los traces que ya
    // muestreamos también tienen profile". Net = 10% de requests con profile.
    profilesSampleRate: 1.0,
    integrations: [
      nodeProfilingIntegration(),
    ],
    // No mandar errores 4xx (eso es del cliente, no nuestro problema).
    // Solo los 5xx + uncaught exceptions cuentan como bugs reales.
    beforeSend(event, hint) {
      const ex = hint.originalException as { statusCode?: number } | undefined;
      if (ex && typeof ex.statusCode === 'number' && ex.statusCode < 500) {
        return null;
      }
      return event;
    },
  });
}

/** Re-export para uso en módulos. */
export { Sentry };
