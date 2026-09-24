/**
 * ROAD SENSE - il telefono e' fermo nel veicolo?
 *
 * Il primo test su strada ha prodotto 257 eventi toccando il telefono.
 * Questi casi descrivono i tre criteri di contesto che ora lo impediscono.
 */

import { describe, expect, it } from 'vitest';

import { DETECTION } from '../config/config';
import { StabilityMonitor, verticalShare } from './StabilityMonitor';

const cfg = DETECTION.stability;

/** Porta il monitor in condizioni di marcia e restituisce l'istante finale. */
function inMarcia(m: StabilityMonitor, from = 0, dps = 5): number {
  let t = from;
  for (; t <= from + cfg.minMotionHoldMs + 200; t += 100) m.push(t, dps, 14);
  return t;
}

describe('moto del veicolo', () => {
  it('fermo non e\' mai stabile, qualunque cosa faccia il telefono', () => {
    const m = new StabilityMonitor();
    const s = m.push(1000, 0, 0);
    expect(s.stable).toBe(false);
    expect(s.reason).toBe('veicolo fermo');
  });

  it('serve moto CONTINUATIVO, non un campione fortunato', () => {
    const m = new StabilityMonitor();
    // Un solo campione sopra soglia: deriva del GPS, non marcia.
    expect(m.push(1000, 5, 14).stable).toBe(false);
    // Il tempo prosegue da li': i campioni non tornano indietro.
    const t = inMarcia(m, 1100);
    expect(m.push(t, 5, 14).stable).toBe(true);
  });

  it('una sosta azzera il conteggio', () => {
    const m = new StabilityMonitor();
    const t = inMarcia(m);
    expect(m.push(t, 5, 14).stable).toBe(true);
    // Semaforo.
    m.push(t + 100, 5, 0);
    const dopo = m.push(t + 200, 5, 14);
    expect(dopo.stable).toBe(false);
    expect(dopo.motionHoldMs).toBeLessThan(cfg.minMotionHoldMs);
  });
});

describe('rotazione', () => {
  it('una rotazione da mano umana rende instabile', () => {
    const m = new StabilityMonitor();
    const t = inMarcia(m);
    const s = m.push(t, cfg.gyroStableDps + 20, 14);
    expect(s.stable).toBe(false);
    expect(s.reason).toBe('rotazione');
  });

  it('le rotazioni di un veicolo in curva restano stabili', () => {
    const m = new StabilityMonitor();
    const t = inMarcia(m, 0, 25);
    expect(m.push(t, 25, 14).stable).toBe(true);
  });

  it('il massimo recente conta, non solo l\'istante', () => {
    const m = new StabilityMonitor();
    const t = inMarcia(m);
    m.push(t, cfg.gyroStableDps + 40, 14);
    // Campione successivo tranquillo: la finestra ricorda comunque lo strappo.
    const s = m.push(t + 100, 2, 14);
    expect(s.gyroMaxDps).toBeGreaterThan(cfg.gyroStableDps);
    expect(s.stable).toBe(false);
  });
});

describe('quarantena dopo una manipolazione', () => {
  it('uno strappo forte sospende tutto per un tempo dichiarato', () => {
    const m = new StabilityMonitor();
    const t = inMarcia(m);
    m.push(t, cfg.manipulationDps + 50, 14);

    // Telefono subito rimesso a posto: non basta.
    const subito = m.push(t + 200, 1, 14);
    expect(subito.stable).toBe(false);
    expect(subito.reason).toBe('quarantena');
    expect(subito.quarantineLeftMs).toBeGreaterThan(0);

    // Scaduta la quarantena, e col veicolo ancora in moto, si torna stabili.
    let ultimo = subito;
    for (let x = t + 300; x <= t + cfg.quarantineMs + 300; x += 100) {
      ultimo = m.push(x, 1, 14);
    }
    expect(ultimo.stable).toBe(true);
  });

  it('la quarantena ha la precedenza sugli altri motivi', () => {
    const m = new StabilityMonitor();
    const t = inMarcia(m);
    m.push(t, cfg.manipulationDps + 50, 14);
    // Veicolo fermo E quarantena: si dice la causa piu' specifica.
    expect(m.push(t + 100, 1, 0).reason).toBe('quarantena');
  });
});

describe('direzione dell\'urto', () => {
  it('una spinta prevalentemente verticale viene dalla strada', () => {
    expect(verticalShare(8, 9)).toBeGreaterThan(cfg.minVerticalShare);
  });

  it('una spinta sparsa in tutte le direzioni no', () => {
    expect(verticalShare(8, 40)).toBeLessThan(cfg.minVerticalShare);
  });

  it('senza il dato totale non si inventa un valore', () => {
    expect(verticalShare(8, null)).toBeNull();
    expect(verticalShare(null, 9)).toBeNull();
    expect(verticalShare(8, 0)).toBeNull();
  });

  it('non supera mai 1, qualunque rumore arrivi dai sensori', () => {
    expect(verticalShare(50, 1)).toBe(1);
  });
});

describe('giroscopio assente', () => {
  it('non viene trattato come prova di stabilita\' ne\' di manipolazione', () => {
    const m = new StabilityMonitor();
    let t = 0;
    for (; t <= cfg.minMotionHoldMs + 200; t += 100) m.push(t, null, 14);
    const s = m.push(t, null, 14);
    // Senza giroscopio resta l'unico criterio applicabile: il moto.
    expect(s.gyroMaxDps).toBe(0);
    expect(s.stable).toBe(true);
  });
});
