/**
 * ROAD SENSE - interfaccia astratta delle sorgenti dati.
 *
 * Ogni sorgente (telefono, futuro dongle BLE, OBD, sensori pneumatico)
 * implementa questa interfaccia. La app non conosce mai l'origine concreta:
 * questo mantiene ROAD SENSE VENDOR-NEUTRAL.
 */

import type { GeoSample, SensorCapabilities, SensorSample } from '../types';

export interface SensorProviderEvents {
  /** Campione di movimento normalizzato. */
  onMotion?: (sample: SensorSample) => void;
  /** Posizione normalizzata. */
  onGeo?: (sample: GeoSample) => void;
  /** Errore non bloccante (permesso negato, sensore sparito, GPS off). */
  onError?: (error: SensorProviderError) => void;
}

export interface SensorProviderError {
  /** Sottosistema coinvolto. */
  kind: 'geolocation' | 'motion' | 'permission' | 'unsupported';
  message: string;
}

/**
 * Dati opzionali provenienti da sensori pneumatico / veicolo.
 * Definiti qui fin dalla v0.1.0 perche' il resto dell'architettura sia pronto,
 * ma nessun provider concreto li fornisce ancora.
 */
export interface VehicleSample {
  ts: number;
  tyrePressureKpa?: number;
  tyreTemperatureC?: number;
  gripIndex?: number;
  /** Identificativo TECNICO del sensore, mai riferibile a una persona. */
  sensorRef?: string;
}

export interface SensorProvider {
  /** Identificativo stabile del provider. */
  readonly id: string;
  /** Nome leggibile per la UI. */
  readonly label: string;

  /**
   * Rileva cosa e' realmente disponibile su questo dispositivo/browser.
   * Non deve mai lanciare: un sensore assente e' una condizione normale.
   */
  probe(): Promise<SensorCapabilities>;

  /**
   * Richiede i permessi necessari. Deve essere chiamato da un gesto utente
   * (requisito iOS per DeviceMotionEvent.requestPermission).
   */
  requestPermissions(): Promise<SensorCapabilities>;

  /** Avvia l'acquisizione. */
  start(handlers: SensorProviderEvents): Promise<void>;

  /** Ferma l'acquisizione e rilascia le risorse (importante per la batteria). */
  stop(): void;
}
