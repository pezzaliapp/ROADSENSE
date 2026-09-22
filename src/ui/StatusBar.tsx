/**
 * ROAD SENSE - barra di stato.
 * Tre soli indicatori: GPS, SENSORI, RETE. Niente dashboard.
 */

import { APP } from '../config/config';
import type { SystemStatus } from '../core/types';

interface Props {
  status: SystemStatus;
  demo: boolean;
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

const NET_LABEL: Record<SystemStatus['network'], [string, string]> = {
  online: ['ok', 'RETE'],
  local: ['warn', 'LOCALE'],
  offline: ['bad', 'OFFLINE'],
};

export function StatusBar({ status, demo }: Props) {
  const gps = GPS_LABEL[status.gps];
  const sensors = SENSOR_LABEL[status.sensors];
  const net = NET_LABEL[status.network];

  return (
    <header className="topbar">
      <div className="brand">
        ROAD SENSE <span className="ver">v{APP.version}</span>
      </div>
      <div className="chips">
        {demo && <span className="chip demo">DEMO</span>}
        <span className={`chip ${gps[0]}`}>{gps[1]}</span>
        <span className={`chip ${sensors[0]}`}>{sensors[1]}</span>
        <span className={`chip ${net[0]}`}>{net[1]}</span>
      </div>
    </header>
  );
}
