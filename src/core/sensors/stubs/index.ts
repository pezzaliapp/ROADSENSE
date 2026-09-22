/**
 * ROAD SENSE - provider futuri (SOLO INTERFACCE / STUB).
 *
 * Nessuno di questi provider e' implementato nella v0.1.0. Esistono per fissare
 * il contratto architetturale e dimostrare che ROAD SENSE non dipende dai
 * sensori del telefono.
 *
 * REGOLE NON NEGOZIABILI
 * - Nessun reverse engineering di protocolli proprietari.
 * - Nessuna intercettazione di comunicazioni di terzi.
 * - Nessun uso di marchi o API proprietarie senza autorizzazione.
 * - Ogni integrazione futura deve passare da SDK/API/documentazione ufficiali.
 *
 * ROAD SENSE resta VENDOR-NEUTRAL: i dati pneumatico sono un arricchimento
 * opzionale, mai un requisito.
 */

import type { SensorCapabilities } from '../../types';
import type { SensorProvider, SensorProviderEvents } from '../SensorProvider';

const NOT_IMPLEMENTED: SensorCapabilities = {
  geolocation: false,
  accelerometer: false,
  gyroscope: false,
  orientation: false,
  needsMotionPermission: false,
};

abstract class StubProvider implements SensorProvider {
  abstract readonly id: string;
  abstract readonly label: string;
  /** Motivo per cui il provider non e' attivo, mostrabile nella UI. */
  abstract readonly reason: string;

  async probe(): Promise<SensorCapabilities> {
    return NOT_IMPLEMENTED;
  }

  async requestPermissions(): Promise<SensorCapabilities> {
    return NOT_IMPLEMENTED;
  }

  async start(handlers: SensorProviderEvents): Promise<void> {
    handlers.onError?.({ kind: 'unsupported', message: this.reason });
  }

  stop(): void {
    /* nessuna risorsa da rilasciare */
  }
}

/**
 * Dongle o sensore esterno via Web Bluetooth.
 * Limite noto: Web Bluetooth non esiste su iOS/Safari.
 */
export class BleSensorProvider extends StubProvider {
  readonly id = 'ble';
  readonly label = 'Sensore Bluetooth';
  readonly reason = 'Provider BLE non implementato nella v0.1.0 (Web Bluetooth assente su iOS).';
}

/**
 * Dati veicolo da interfaccia OBD-II tramite adattatore compatibile.
 * Utile per velocita' e stato veicolo indipendenti dal GPS.
 */
export class ObdSensorProvider extends StubProvider {
  readonly id = 'obd';
  readonly label = 'Interfaccia OBD-II';
  readonly reason = 'Provider OBD non implementato nella v0.1.0.';
}

/**
 * Sensori pneumatico generici (pressione, temperatura, accelerazioni, aderenza)
 * esposti da un sistema che ne pubblichi un'API documentata.
 */
export class SmartTyreProvider extends StubProvider {
  readonly id = 'smart-tyre';
  readonly label = 'Pneumatico sensorizzato';
  readonly reason = 'Provider pneumatico sensorizzato non implementato nella v0.1.0.';
}

/**
 * Segnaposto per una eventuale integrazione con un sistema di pneumatici
 * intelligenti di un costruttore. Rimane uno STUB: qualsiasi integrazione
 * potra' avvenire solo tramite API/SDK ufficiali e autorizzati.
 */
export class CyberTyreProvider extends StubProvider {
  readonly id = 'cyber-tyre';
  readonly label = 'Pneumatico intelligente (futuro)';
  readonly reason =
    'Interfaccia predisposta. Integrazione possibile solo tramite API o SDK ufficialmente autorizzati.';
}
