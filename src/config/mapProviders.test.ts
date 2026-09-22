/**
 * ROAD SENSE - vincoli sulla sorgente cartografica.
 *
 * Questi test proteggono regole che non sono negoziabili: l'attribuzione deve
 * esserci sempre, e ROAD SENSE non deve tornare a usare i server di
 * OpenStreetMap, che vietano l'uso da parte di applicazioni distribuite.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ACTIVE_MAP_PROVIDER, MAP_PROVIDERS, type MapTileProvider } from './mapProviders';

const all: MapTileProvider[] = Object.values(MAP_PROVIDERS);

describe('fornitori cartografici', () => {
  it('l\'elenco non e\' vuoto e il fornitore attivo vi appartiene', () => {
    expect(all.length).toBeGreaterThan(0);
    expect(MAP_PROVIDERS[ACTIVE_MAP_PROVIDER.id]).toBe(ACTIVE_MAP_PROVIDER);
  });

  it('ogni fornitore dichiara un\'attribuzione non vuota', () => {
    for (const p of all) {
      expect(p.attribution.trim().length).toBeGreaterThan(0);
    }
  });

  it('ogni attribuzione cita OpenStreetMap, da cui derivano i dati', () => {
    for (const p of all) {
      expect(p.attribution).toMatch(/OpenStreetMap/i);
    }
  });

  it('ogni fornitore rimanda alle proprie condizioni d\'uso', () => {
    for (const p of all) {
      expect(p.terms).toMatch(/^https:\/\//);
    }
  });

  it('tutti gli URL sono HTTPS', () => {
    for (const p of all) {
      const url = p.kind === 'vector' ? p.styleUrl : p.tileUrl;
      expect(url).toMatch(/^https:\/\//);
      for (const host of p.hosts) expect(host).toMatch(/^https:\/\//);
    }
  });

  it('nessun fornitore usa i server di OpenStreetMap', () => {
    // I server OSMF sono gestiti da volontari e la loro Tile Usage Policy
    // vieta l'uso da parte di applicazioni distribuite. Vedi mapProviders.ts.
    for (const p of all) {
      const url = p.kind === 'vector' ? p.styleUrl : p.tileUrl;
      expect(url).not.toMatch(/tile\.openstreetmap\.org/);
      for (const host of p.hosts) expect(host).not.toMatch(/tile\.openstreetmap\.org/);
    }
  });

  it('i domini del fornitore attivo sono consentiti dalla Content-Security-Policy', () => {
    const root = resolve(import.meta.dirname, '..', '..');
    const headers = readFileSync(resolve(root, 'public', '_headers'), 'utf8');
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    for (const host of ACTIVE_MAP_PROVIDER.hosts) {
      expect(headers).toContain(host);
      expect(html).toContain(host);
    }
  });

  it('la Referrer-Policy non impedisce l\'invio del Referer', () => {
    // Una policy `no-referrer` e' esplicitamente vietata dalla Tile Usage
    // Policy di OpenStreetMap ed e' malvista da diversi fornitori, perche'
    // impedisce di capire quale applicazione stia chiamando.
    const root = resolve(import.meta.dirname, '..', '..');
    const headers = readFileSync(resolve(root, 'public', '_headers'), 'utf8');
    const html = readFileSync(resolve(root, 'index.html'), 'utf8');
    expect(headers).not.toMatch(/Referrer-Policy:\s*no-referrer/);
    expect(html).not.toMatch(/name="referrer"\s+content="no-referrer"/);
  });
});

describe('service worker', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '..', '..', 'public', 'sw.js'),
    'utf8',
  );
  // Si controlla il CODICE, non i commenti: il service worker cita di
  // proposito la vecchia cache `roadsense-tiles-v1` per spiegare che viene
  // cancellata sui dispositivi che l'hanno gia'.
  const sw = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('non intercetta nulla al di fuori della propria origine', () => {
    // E' la riga che garantisce che nessuna cartografia finisca in cache.
    expect(sw).toMatch(/url\.origin !== self\.location\.origin\) return;/);
  });

  it('non contiene alcuna cache dedicata alle tile', () => {
    expect(sw).not.toMatch(/TILE_CACHE|roadsense-tiles|MAX_TILES|tileStrategy|trimTiles/);
  });

  it('non nomina alcun dominio cartografico', () => {
    expect(sw).not.toMatch(/openstreetmap\.org|openfreemap\.org|cartocdn|basemaps/);
  });

  it('non mette in cache le risposte delle API', () => {
    expect(sw).toMatch(/pathname\.startsWith\('\/api\/'\)\) return;/);
  });
});
