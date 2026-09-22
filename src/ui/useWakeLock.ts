/**
 * ROAD SENSE - Screen Wake Lock.
 *
 * Durante il monitoraggio lo schermo deve restare acceso: nessun browser
 * garantisce l'esecuzione dei sensori con schermo spento o app in background.
 * E' una limitazione reale delle PWA, dichiarata nel README, non aggirata.
 *
 * L'API non esiste su tutti i browser (in particolare Safari meno recenti):
 * l'assenza non e' un errore, semplicemente lo schermo si spegnera' da solo.
 */

import { useEffect } from 'react';

interface WakeLockSentinelLike {
  release: () => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
}

interface WakeLockApi {
  request: (type: 'screen') => Promise<WakeLockSentinelLike>;
}

export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const api = (navigator as unknown as { wakeLock?: WakeLockApi }).wakeLock;
    if (!api) return;

    let sentinel: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const s = await api.request('screen');
        if (cancelled) {
          void s.release();
          return;
        }
        sentinel = s;
      } catch {
        // Permesso negato o tab non visibile: non e' un errore bloccante.
      }
    };

    // Il wake lock decade quando la pagina passa in background: va ripreso.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active]);
}
