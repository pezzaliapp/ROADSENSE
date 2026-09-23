/**
 * ROAD SENSE - Screen Wake Lock.
 *
 * Involucro sottile attorno a `WakeLockController`: la logica sta li', qui
 * c'e' solo il legame con il ciclo di vita del componente e lo stato da
 * mostrare a schermo.
 *
 * Lo stato viene mostrato davvero: se il blocco non e' disponibile,
 * l'interfaccia lo dice invece di lasciar credere che lo schermo restera'
 * acceso. E' una limitazione reale delle PWA, dichiarata e non aggirata.
 */

import { useEffect, useState } from 'react';

import {
  browserWakeLockEnvironment,
  WakeLockController,
  type WakeLockStatus,
} from './wakeLockController';

export type { WakeLockStatus } from './wakeLockController';

export function useWakeLock(active: boolean): WakeLockStatus {
  const [status, setStatus] = useState<WakeLockStatus>(() =>
    browserWakeLockEnvironment().request ? 'idle' : 'unsupported',
  );

  useEffect(() => {
    const controller = new WakeLockController(browserWakeLockEnvironment(), setStatus);
    setStatus(controller.currentStatus());
    if (!active) return;

    controller.start();
    // Il rilascio avviene sempre: allo STOP, cambiando pagina, smontando.
    return () => controller.stop();
  }, [active]);

  return status;
}
