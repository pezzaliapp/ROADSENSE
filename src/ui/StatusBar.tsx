/**
 * ROAD SENSE - barra di stato.
 * Tre soli indicatori: GPS, SENSORI, RETE. Niente dashboard.
 */

import { APP } from '../config/config';
import type { SystemStatus } from '../core/types';
import type { WakeLockStatus } from './useWakeLock';

interface Props {
  status: SystemStatus;
  /** Stato del blocco schermo, mostrato solo durante il monitoraggio. */
  wakeLock: WakeLockStatus;
  /** true quando il monitoraggio e' attivo. */
  running: boolean;
  demo: boolean;
  /**
   * Attiva o disattiva la voce. Disponibile SOLO a monitoraggio fermo:
   * durante la guida non si tocca nulla, ed e' il senso di ZERO TOUCH.
   */
  onToggleVoice?: () => void;
}

const GPS_LABEL: Record<SystemStatus['gps'], [string, string]> = {
  ok: ['ok', 'GPS'],
  weak: ['warn', 'GPS ~'],
  off: ['', 'GPS --'],
  denied: ['bad', 'GPS ✕'],
};

const SENSOR_LABEL: Record<SystemStatus['sensors'], [string, string]> = {
  ok: ['ok', 'SENSORI'],
  partial: ['warn', 'SENSORI ~'],
  off: ['', 'SENSORI --'],
};

/**
 * La voce ha piu' stati degli altri indicatori perche' ne ha davvero di piu':
 * "non disponibile" e "non attiva" sono cose diverse, e chi guida deve poterle
 * distinguere senza indagare.
 */
const VOICE_LABEL: Record<SystemStatus['voice'], [string, string]> = {
  listening: ['ok', 'VOCE'],
  restarting: ['warn', 'VOCE ~'],
  ready: ['warn', 'VOCE ON'],
  consent: ['warn', 'VOCE ?'],
  off: ['', 'VOCE OFF'],
  denied: ['bad', 'VOCE ✕'],
  error: ['bad', 'VOCE ✕'],
  unsupported: ['', 'VOCE --'],
};

/**
 * Blocco schermo. Dichiarato esplicitamente perche' la sua assenza cambia
 * come si usa l'app: senza, lo schermo si spegne e il monitoraggio si ferma.
 */
const SCREEN_LABEL: Record<WakeLockStatus, [string, string]> = {
  active: ['ok', 'SCHERMO ATTIVO'],
  idle: ['warn', 'SCHERMO ~'],
  unsupported: ['bad', 'SCHERMO NON DISPONIBILE'],
};

const NET_LABEL: Record<SystemStatus['network'], [string, string]> = {
  online: ['ok', 'RETE'],
  local: ['warn', 'LOCALE'],
  offline: ['bad', 'OFFLINE'],
};

export function StatusBar({ status, wakeLock, running, demo, onToggleVoice }: Props) {
  const gps = GPS_LABEL[status.gps];
  const sensors = SENSOR_LABEL[status.sensors];
  const net = NET_LABEL[status.network];
  const voice = VOICE_LABEL[status.voice];
  const screen = SCREEN_LABEL[wakeLock];
  const voiceToggleable = status.voice !== 'unsupported' && onToggleVoice !== undefined;

  return (
    <header className="topbar">
      <div className="brand">
        ROAD SENSE <span className="ver">v{APP.version}</span>
      </div>
      <div className="chips">
        {demo && <span className="chip demo">DEMO</span>}
        <span className={`chip ${gps[0]}`}>{gps[1]}</span>
        <span className={`chip ${sensors[0]}`}>{sensors[1]}</span>
        {voiceToggleable ? (
          <button className={`chip ${voice[0]}`} onClick={onToggleVoice} aria-pressed={status.voice === 'listening'}>
            {voice[1]}
          </button>
        ) : (
          <span className={`chip ${voice[0]}`}>{voice[1]}</span>
        )}
        {/* Il blocco schermo interessa solo mentre si guida: da fermi
            occuperebbe spazio senza dire nulla di utile. */}
        {(running || wakeLock === 'unsupported') && (
          <span className={`chip ${screen[0]}`}>{screen[1]}</span>
        )}
        <span className={`chip ${net[0]}`}>{net[1]}</span>
      </div>
    </header>
  );
}
