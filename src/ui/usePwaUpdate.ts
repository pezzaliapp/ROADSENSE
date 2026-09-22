/**
 * ROAD SENSE - registrazione del service worker e gestione aggiornamenti.
 *
 * L'aggiornamento non viene MAI applicato a sorpresa: se ne trova uno pronto,
 * si mostra una barra e l'utente decide. Ricaricare l'app da soli mentre
 * qualcuno sta guidando sarebbe inaccettabile.
 */

import { useCallback, useEffect, useState } from 'react';

export function usePwaUpdate(): { updateReady: boolean; applyUpdate: () => void } {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (import.meta.env.DEV) return; // in sviluppo il SW darebbe solo fastidio

    let cancelled = false;

    const onControllerChange = () => window.location.reload();
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .then((reg) => {
        if (cancelled) return;
        if (reg.waiting) setWaiting(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) setWaiting(sw);
          });
        });
      })
      .catch(() => {
        // Nessun service worker: l'app funziona comunque, solo senza offline.
      });

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    waiting?.postMessage({ type: 'SKIP_WAITING' });
  }, [waiting]);

  return { updateReady: waiting !== null, applyUpdate };
}
