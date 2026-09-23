/**
 * ROAD SENSE - Screen Wake Lock, la logica.
 *
 * Tenuta fuori da React di proposito: e' una macchina a stati che parla con
 * un'API del browser, e in quanto tale deve poter essere verificata senza
 * montare un componente.
 *
 * PERCHE' SERVE
 * Con lo schermo spento nessun browser garantisce l'esecuzione dei sensori.
 * Il blocco schermo non e' un lusso: e' cio' che rende possibile ZERO TOUCH
 * per la durata di un viaggio. Dove l'API non esiste, lo schermo si spegnera'
 * da solo e l'applicazione lo dichiara, invece di far finta di nulla.
 *
 * DUE ERRORI CHE QUESTA CLASSE EVITA, ed erano entrambi presenti prima
 *  - chiedere un nuovo blocco quando se ne possiede gia' uno valido: il
 *    riferimento al precedente andava perso e quel blocco non veniva mai
 *    rilasciato;
 *  - richieste sovrapposte: due `request()` in volo contemporaneamente
 *    producono due sentinelle, e solo l'ultima viene poi rilasciata.
 */

export type WakeLockStatus =
  /** Il browser non offre l'API: lo schermo potra' spegnersi. */
  | 'unsupported'
  /** Supportato, ma in questo momento non e' tenuto. */
  | 'idle'
  /** Blocco schermo attivo. */
  | 'active';

export interface WakeLockSentinelLike {
  released?: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

/**
 * Tutto cio' che il controller usa del mondo esterno.
 * Iniettarlo permette di verificare il comportamento con una finta API,
 * inclusi i casi che in un browser vero sarebbero difficili da provocare.
 */
export interface WakeLockEnvironment {
  /** `null` quando il browser non offre l'API. */
  request: ((type: 'screen') => Promise<WakeLockSentinelLike>) | null;
  isVisible: () => boolean;
  /** Registra un ascoltatore sui cambi di visibilita'; ritorna come disiscriversi. */
  onVisibilityChange: (listener: () => void) => () => void;
}

export class WakeLockController {
  private sentinel: WakeLockSentinelLike | null = null;
  private acquiring = false;
  private stopped = true;
  private unsubscribe: (() => void) | null = null;
  private status: WakeLockStatus;

  constructor(
    private readonly env: WakeLockEnvironment,
    private readonly onStatus: (status: WakeLockStatus) => void = () => {},
  ) {
    this.status = env.request ? 'idle' : 'unsupported';
  }

  currentStatus(): WakeLockStatus {
    return this.status;
  }

  /** true se in questo istante il blocco e' realmente posseduto. */
  isHeld(): boolean {
    return this.sentinel !== null && this.sentinel.released !== true;
  }

  /**
   * Chiede il blocco e resta in ascolto dei cambi di visibilita'.
   * Chiamarla due volte non produce due blocchi.
   */
  start(): void {
    if (!this.env.request) {
      this.emit('unsupported');
      return;
    }
    if (!this.stopped) return;
    this.stopped = false;

    this.unsubscribe = this.env.onVisibilityChange(() => {
      // Tornati visibili: si riprende SOLO se nel frattempo e' stato perso.
      if (this.env.isVisible()) void this.acquire();
    });

    void this.acquire();
  }

  /** Rilascia sempre, anche se la richiesta era ancora in volo. */
  stop(): void {
    this.stopped = true;
    this.unsubscribe?.();
    this.unsubscribe = null;

    const sentinel = this.sentinel;
    this.sentinel = null;
    if (sentinel) {
      sentinel.removeEventListener?.('release', this.handleRelease);
      void sentinel.release().catch(() => undefined);
    }
    this.emit(this.env.request ? 'idle' : 'unsupported');
  }

  // -- interni --------------------------------------------------------------

  private readonly handleRelease = (): void => {
    // Rilasciato dal sistema, tipicamente passando in secondo piano.
    this.sentinel = null;
    if (!this.stopped) this.emit('idle');
  };

  private async acquire(): Promise<void> {
    const request = this.env.request;
    if (!request || this.stopped) return;
    // Gia' posseduto: chiederne un altro lascerebbe il primo senza padrone.
    if (this.isHeld()) return;
    // Una richiesta per volta: due in volo produrrebbero due sentinelle.
    if (this.acquiring) return;
    // A pagina nascosta la richiesta fallirebbe: si attende il ritorno.
    if (!this.env.isVisible()) return;

    this.acquiring = true;
    try {
      const sentinel = await request('screen');
      if (this.stopped) {
        void sentinel.release().catch(() => undefined);
        return;
      }
      this.sentinel = sentinel;
      sentinel.addEventListener?.('release', this.handleRelease);
      this.emit('active');
    } catch {
      // Permesso negato, batteria bassa, pagina non visibile: nessuno di questi
      // casi deve interrompere il monitoraggio.
      if (!this.stopped) this.emit('idle');
    } finally {
      this.acquiring = false;
    }
  }

  private emit(status: WakeLockStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.onStatus(status);
  }
}

/** Ambiente reale del browser. */
export function browserWakeLockEnvironment(): WakeLockEnvironment {
  const api = (
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } })
          .wakeLock
  );

  return {
    request: api ? (type) => api.request(type) : null,
    isVisible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
    onVisibilityChange: (listener) => {
      if (typeof document === 'undefined') return () => undefined;
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
  };
}
