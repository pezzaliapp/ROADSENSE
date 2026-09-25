/**
 * ROAD SENSE - l'osservazione non altera cio' che osserva.
 *
 * Il ramo `road-geometry` del corridoio non e' verificabile in automatico:
 * dipende da `querySourceFeatures`, che in Node non esiste. Si verifica su un
 * telefono reale, e per farlo serve vederlo. Questi test dimostrano che il
 * fatto di guardarlo non cambia il comportamento.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CORRIDOR } from '../config/config';
import {
  buildForwardCorridor,
  type ForwardCorridor,
  type RoadPolyline,
} from '../core/forwardCorridor';
import { destinationPoint } from '../core/geo';
import { corridorDebug } from './corridorDebug';

const ROOT = resolve(import.meta.dirname, '..', '..');
const ORIGINE = { lat: 45.0, lon: 9.0 };

function retta(from: { lat: number; lon: number }, bearing: number, lunghezza: number): RoadPolyline {
  const points = [];
  for (let d = 0; d <= lunghezza; d += 50) points.push(destinationPoint(from, bearing, d));
  return { points };
}

describe('il debug non modifica il comportamento', () => {
  it('e\' una funzione pura: non tocca il corridoio che riceve', () => {
    const strada = retta(destinationPoint(ORIGINE, 180, 200), 0, 2000);
    const c = buildForwardCorridor({ position: ORIGINE, heading: 0, speedMps: 20, roads: [strada] });
    const prima = JSON.stringify(c);

    corridorDebug(c, { heading: 0, speedMps: 20, roadFeatures: 1 });
    corridorDebug(c, { heading: 0, speedMps: 20, roadFeatures: 1 });

    expect(JSON.stringify(c)).toBe(prima);
  });

  it('il corridoio viene costruito SEMPRE, non solo in debug', () => {
    // Se la costruzione dipendesse dal debug, il comportamento osservato non
    // sarebbe quello reale.
    const app = readFileSync(resolve(ROOT, 'src', 'App.tsx'), 'utf8');
    const codice = app.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const costruzione = codice.indexOf('buildForwardCorridor({');
    expect(costruzione).toBeGreaterThan(-1);

    // Nessuna condizione di debug fra l'inizio del ramo non-demo e la
    // costruzione del corridoio.
    const ramo = codice.slice(codice.lastIndexOf('} else {', costruzione), costruzione);
    expect(ramo).not.toMatch(/sensorDebug|voiceDebug|corridorDebug/);
  });

  it('non conserva coordinate ne\' cronologia', () => {
    const modulo = readFileSync(resolve(ROOT, 'src', 'ui', 'corridorDebug.ts'), 'utf8');
    const codice = modulo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(codice).not.toMatch(/localStorage|sessionStorage|indexedDB|push\(|history/);
    // Espone conteggi e stati, mai posizioni.
    expect(codice).not.toMatch(/\blat\b|\blon\b/);
  });
});

describe('cosa si legge sul telefono', () => {
  const strada = retta(destinationPoint(ORIGINE, 180, 200), 0, 2000);
  const veicolo = { position: ORIGINE, heading: 0, speedMps: 20 };

  it('aggancio riuscito: road-geometry, reliable, evidenza vera, nessun motivo', () => {
    const c = buildForwardCorridor({ ...veicolo, roads: [strada] });
    const d = corridorDebug(c, { heading: 0, speedMps: 20, roadFeatures: 1 });

    expect(d.source).toBe('road-geometry');
    expect(d.status).toBe('reliable');
    expect(d.roadEvidence).toBe(true);
    expect(d.reason).toBeNull();
    expect(d.roadFeatures).toBe(1);
    expect(d.points).toBeGreaterThan(2);
    expect(d.lengthM).toBeGreaterThan(0);
  });

  it('mappa senza strade: no-road-features', () => {
    const c = buildForwardCorridor({ ...veicolo, roads: [] });
    const d = corridorDebug(c, { heading: 0, speedMps: 20, roadFeatures: 0 });
    expect(d.source).toBe('heading');
    expect(d.roadEvidence).toBe(false);
    expect(d.reason).toBe('no-road-features');
  });

  it('strade presenti ma nessuna agganciabile: insufficient-geometry', () => {
    const lontana = retta(destinationPoint(ORIGINE, 90, 500), 0, 2000);
    const c = buildForwardCorridor({ ...veicolo, roads: [lontana] });
    const d = corridorDebug(c, { heading: 0, speedMps: 20, roadFeatures: 1 });
    expect(d.source).toBe('heading');
    expect(d.reason).toBe('insufficient-geometry');
  });

  it('biforcazione: ambiguous, ma evidenza stradale ancora vera', () => {
    const tronco = retta(destinationPoint(ORIGINE, 180, 100), 0, 400);
    const nodo = tronco.points.at(-1)!;
    const c = buildForwardCorridor({
      ...veicolo,
      roads: [tronco, retta(nodo, 340, 800), retta(nodo, 20, 800)],
    });
    const d = corridorDebug(c, { heading: 0, speedMps: 20, roadFeatures: 3 });

    expect(d.source).toBe('road-geometry');
    expect(d.status).toBe('uncertain');
    expect(d.reason).toBe('ambiguous');
    expect(d.roadEvidence).toBe(true);
  });

  it('senza direzione: none, no-heading', () => {
    const c = buildForwardCorridor({ ...veicolo, heading: null, roads: [strada] });
    const d = corridorDebug(c, { heading: null, speedMps: 20, roadFeatures: 1 });
    expect(d.source).toBe('none');
    expect(d.status).toBe('unavailable');
    expect(d.reason).toBe('no-heading');
    expect(d.points).toBe(0);
  });

  it('troppo lenti: none, low-speed', () => {
    const c = buildForwardCorridor({ ...veicolo, speedMps: CORRIDOR.minSpeedMps - 0.5, roads: [strada] });
    const d = corridorDebug(c, {
      heading: 0,
      speedMps: CORRIDOR.minSpeedMps - 0.5,
      roadFeatures: 1,
    });
    expect(d.source).toBe('none');
    expect(d.reason).toBe('low-speed');
  });

  it('corridoio assente: nessun errore, stato dichiarato', () => {
    const d = corridorDebug(null, { heading: null, speedMps: null, roadFeatures: 0 });
    expect(d.source).toBe('none');
    expect(d.roadEvidence).toBe(false);
    expect(d.points).toBe(0);
    expect(d.lengthM).toBe(0);
  });

  it('un corridoio non nullo ma vuoto non inventa evidenza', () => {
    const finto = {
      points: [],
      lengthM: 0,
      source: 'none',
      status: 'unavailable',
      confidence: 0,
      roadEvidence: false,
    } as ForwardCorridor;
    expect(corridorDebug(finto, { heading: 0, speedMps: 20, roadFeatures: 5 }).roadEvidence).toBe(
      false,
    );
  });
});
