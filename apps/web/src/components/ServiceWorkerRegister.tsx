'use client';

import { useEffect } from 'react';

/**
 * Registra el service worker (solo en producción, para no cachear en dev).
 * Se monta en el layout raíz y no renderiza nada.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;
    const onLoad = () => {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    };
    window.addEventListener('load', onLoad);
    return () => window.removeEventListener('load', onLoad);
  }, []);
  return null;
}
