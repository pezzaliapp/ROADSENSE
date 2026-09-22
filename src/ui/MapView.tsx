/**
 * ROAD SENSE - mappa.
 *
 * MapView NON conosce il fornitore cartografico: consuma `MapTileProvider`
 * (vedi `config/mapProviders.ts`) e sa costruire lo stile sia per una sorgente
 * VETTORIALE sia per una RASTER. Cambiare fornitore, o passare da vettoriale a
 * raster, non richiede alcuna modifica a questo file.
 *
 * SCELTE PER LA BATTERIA
 * - `fadeDuration: 0` e nessuna animazione: la mappa disegna un fotogramma
 *   quando qualcosa cambia, non di continuo;
 * - i marker vengono aggiornati per differenza, non ricreati a ogni ciclo;
 * - `attributionControl` compatto: occupa poco e resta sempre visibile.
 *
 * ATTRIBUZIONE
 * E' obbligatoria e non rimovibile: viene presa dal fornitore attivo e passata
 * al controllo di attribuzione di MapLibre.
 */

import { useEffect, useMemo, useRef } from 'react';
// maplibre-gl v6 espone solo export nominali: nessun export di default.
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  setWorkerUrl,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * MapLibre GL 6 non incorpora il proprio worker nel bundle principale: lo
 * carica da un file separato, calcolando l'URL come
 * `new URL('./maplibre-gl-worker.mjs', import.meta.url)`.
 *
 * Dopo il bundling quell'URL diventa `/assets/maplibre-gl-worker.mjs`, un file
 * che non esiste: il server risponde con il fallback SPA (`index.html`) e il
 * caricamento del modulo fallisce con
 *   "Failed to load module script: ... non-JavaScript MIME type of text/html".
 *
 * Senza worker nessuna tile viene decodificata: la mappa resta nera pur
 * inizializzandosi correttamente.
 *
 * `?worker&url` chiede a Vite di costruire il worker come chunk a se' stante
 * - risolvendo anche il suo import di `maplibre-gl-shared.mjs` - e di
 * restituirne l'URL con hash, che passiamo a MapLibre.
 * Richiede `worker.format: 'es'` in vite.config.ts, perche' MapLibre lo
 * istanzia con `{ type: 'module' }`.
 */
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

setWorkerUrl(maplibreWorkerUrl);

import { ACTIVE_MAP_PROVIDER, MAP, type MapTileProvider } from '../config/config';
import { confidenceLevel } from '../core/ConfidenceEngine';
import { destinationPoint } from '../core/geo';
import type { EventCluster } from '../core/types';
import type { AreaOverlay } from './areaOverlay';
import { EVENT_META } from './eventMeta';

/** Veicolo secondario disegnato sulla mappa. */
export interface PeerVehicle {
  id: string;
  lat: number;
  lon: number;
  heading: number;
  /** Etichetta temporanea accanto al veicolo, es. "BUCA RILEVATA". */
  flash?: string | null;
  /** Colore dell'alone quando il veicolo si trova dentro un'area. */
  halo?: string | null;
}

interface Props {
  clusters: readonly EventCluster[];
  position: { lat: number; lon: number } | null;
  heading: number | null;
  follow: boolean;
  /**
   * Vista di partenza. Serve soprattutto alla DEMO MODE, che deve mostrare
   * subito l'anello simulato invece di aprirsi su tutta l'Italia.
   * Se assente si usa il fallback di `MAP`.
   */
  initialView?: { lat: number; lon: number; zoom: number } | null;
  /**
   * Tracciato da disegnare come linea sottile, in coppie [lat, lon].
   * Usato SOLO dalla DEMO MODE per rendere visibile il percorso previsto.
   * Per rimuovere la funzione basta smettere di passare questa prop: tutto il
   * codice che la riguarda e' raccolto in un unico effetto piu' sotto.
   */
  /** Zoom usato quando la mappa aggancia la posizione. */
  followZoom?: number;
  routeOverlay?: readonly (readonly [number, number])[] | null;
  /**
   * Aree da disegnare sotto agli eventi: cerchi semitrasparenti con
   * un'etichetta e una direzione di spostamento.
   *
   * MapView non sa cosa rappresentino. Nella v0.1.0 le usa solo la DEMO MODE
   * per le celle meteo simulate; per rimuoverle basta non passare la prop.
   */
  areaOverlays?: readonly AreaOverlay[] | null;
  /**
   * Altri veicoli da disegnare, piu' piccoli e discreti di quello principale.
   * Nella v0.1.0 li usa solo la DEMO MODE per i veicoli ROAD SENSE simulati;
   * per rimuoverli basta non passare la prop.
   */
  peerVehicles?: readonly PeerVehicle[] | null;
  onMapMovedByUser?: () => void;
}

/**
 * Traduce un `MapTileProvider` in qualcosa che MapLibre sappia caricare.
 * Per il vettoriale basta l'URL dello stile; per il raster si costruisce uno
 * stile minimo con un'unica sorgente di immagini.
 */
function styleFor(provider: MapTileProvider): string | StyleSpecification {
  if (provider.kind === 'vector') return provider.styleUrl;

  return {
    version: 8,
    sources: {
      base: {
        type: 'raster',
        tiles: [provider.tileUrl],
        tileSize: provider.tileSize,
        maxzoom: provider.maxZoom,
        attribution: provider.attribution,
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#0b0e11' } },
      { id: 'base', type: 'raster', source: 'base' },
    ],
  };
}

export function MapView({
  clusters,
  position,
  heading,
  follow,
  initialView,
  followZoom: followZoomProp,
  routeOverlay,
  areaOverlays,
  peerVehicles,
  onMapMovedByUser,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const meRef = useRef<Marker | null>(null);
  const meElRef = useRef<HTMLDivElement | null>(null);
  const areaMarkersRef = useRef<Map<string, Marker>>(new Map());
  const peerMarkersRef = useRef<Map<string, { marker: Marker; el: HTMLDivElement }>>(new Map());
  const firstFixRef = useRef(false);

  // -- inizializzazione (una sola volta) -----------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const markers = markersRef.current;
    const provider = ACTIVE_MAP_PROVIDER;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: styleFor(provider),
      // MapLibre usa [lon, lat].
      center: initialView
        ? [initialView.lon, initialView.lat]
        : [MAP.fallbackCenter[1], MAP.fallbackCenter[0]],
      zoom: initialView ? initialView.zoom : MAP.fallbackZoom,
      minZoom: MAP.minZoom,
      maxZoom: Math.min(MAP.maxZoom, provider.maxZoom),
      // Un solo controllo di attribuzione: quello integrato. L'attribuzione
      // arriva dai dati (dallo stile per il vettoriale, dalla sorgente per il
      // raster), che e' la sua collocazione corretta.
      attributionControl: { compact: true },
      // Nessuna dissolvenza: meno fotogrammi, meno batteria.
      fadeDuration: 0,
      // La rotazione a due dita disorienta in auto e non serve a nulla qui.
      pitchWithRotate: false,
      dragRotate: false,
      touchZoomRotate: true,
    });

    map.touchZoomRotate.disableRotation();
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');

    map.on('load', () => {
      readyRef.current = true;
      // Garanzia: l'attribuzione non e' rimovibile. Se per qualunque motivo la
      // sorgente non ne dichiarasse una, si inserisce quella del fornitore.
      // Nel caso normale non fa nulla, quindi non puo' duplicarla.
      const box = map.getContainer().querySelector('.maplibregl-ctrl-attrib-inner');
      if (box && box.textContent !== null && box.textContent.trim().length === 0) {
        box.innerHTML = provider.attribution;
      }
    });
    // Uno stile di terze parti puo' riferirsi a immagini assenti dal proprio
    // sprite: lo stile "dark" di OpenFreeMap richiede `circle-11` e
    // `wood-pattern`, che non ci sono. Senza gestore MapLibre segnala un
    // errore per ognuna.
    //
    // Si registra un'immagine TRASPARENTE, non un segnaposto disegnato:
    // ROAD SENSE non inventa grafica per conto di un fornitore. L'effetto
    // visivo e' identico a quello attuale (il simbolo semplicemente non c'e'),
    // ma lo stile smette di segnalare errori.
    map.on('styleimagemissing', (e) => {
      if (map.hasImage(e.id)) return;
      map.addImage(e.id, { width: 1, height: 1, data: new Uint8Array(4) });
    });

    map.on('dragstart', () => onMapMovedByUser?.());

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
      markers.clear();
      meRef.current = null;
      meElRef.current = null;
    };
    // onMapMovedByUser e' stabile per costruzione nel chiamante.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- marker eventi --------------------------------------------------------
  const clusterKey = useMemo(
    () => clusters.map((c) => `${c.id}|${c.confidence}|${c.severity}`).join(','),
    [clusters],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    const seen = new Set<string>();

    for (const c of clusters) {
      seen.add(c.id);
      const meta = EVENT_META[c.type];
      const level = confidenceLevel(c.confidence);
      const existing = markers.get(c.id);

      if (existing) {
        const el = existing.getElement().firstElementChild as HTMLElement | null;
        if (el) el.className = `rs-marker ${level}`;
        existing.setLngLat([c.lon, c.lat]);
      } else {
        const wrapper = document.createElement('div');
        const dot = document.createElement('div');
        dot.className = `rs-marker ${level}`;
        dot.style.color = meta.color;
        // textContent, non innerHTML: nessun contenuto viene interpretato come
        // markup. In ROAD SENSE non esistono testi liberi, ma la regola vale.
        dot.textContent = meta.glyph;
        dot.title = tooltip(c);
        wrapper.appendChild(dot);
        markers.set(
          c.id,
          new Marker({ element: wrapper }).setLngLat([c.lon, c.lat]).addTo(map),
        );
      }
    }

    for (const [id, marker] of markers) {
      if (!seen.has(id)) {
        marker.remove();
        markers.delete(id);
      }
    }
    // clusterKey riassume il contenuto: evita ricalcoli inutili.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusterKey]);

  // -- posizione utente -----------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !position) return;

    if (!meRef.current) {
      const wrapper = document.createElement('div');
      wrapper.className = 'rs-me-wrap';
      const arrow = document.createElement('div');
      arrow.className = 'rs-me-arrow';
      const dot = document.createElement('div');
      dot.className = 'rs-me';
      wrapper.append(arrow, dot);
      meElRef.current = wrapper;
      meRef.current = new Marker({ element: wrapper })
        .setLngLat([position.lon, position.lat])
        .addTo(map);
    } else {
      meRef.current.setLngLat([position.lon, position.lat]);
    }

    const arrow = meElRef.current?.querySelector<HTMLElement>('.rs-me-arrow');
    if (arrow) {
      arrow.style.visibility = heading === null ? 'hidden' : 'visible';
      if (heading !== null) arrow.style.transform = `rotate(${heading}deg)`;
    }

    if (follow) {
      if (!firstFixRef.current) {
        map.jumpTo({
          center: [position.lon, position.lat],
          zoom: followZoomProp ?? MAP.followZoom,
        });
        firstFixRef.current = true;
      } else {
        // Scorrimento continuo invece di uno scatto a ogni aggiornamento GPS.
        // La durata copre l'intervallo tra due posizioni e l'andamento e'
        // lineare: la mappa segue il veicolo senza accelerazioni percepibili
        // e senza rimbalzi. Costa qualche fotogramma in piu' di `jumpTo`,
        // ma uno scatto al secondo e' fastidioso proprio mentre si guida.
        map.easeTo({
          center: [position.lon, position.lat],
          duration: MAP.followEaseMs,
          easing: (t) => t,
          essential: true,
        });
      }
    }
  }, [position, heading, follow, followZoomProp]);

  // -- tracciato della demo (rimovibile: basta non passare `routeOverlay`) ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !routeOverlay || routeOverlay.length < 2) return;

    const SOURCE = 'rs-demo-route';
    const LAYER = 'rs-demo-route-line';

    const add = () => {
      if (map.getSource(SOURCE)) return;
      map.addSource(SOURCE, {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            // GeoJSON vuole [lon, lat].
            coordinates: routeOverlay.map(([lat, lon]) => [lon, lat]),
          },
        },
      });
      map.addLayer({
        id: LAYER,
        type: 'line',
        source: SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        // Volutamente discreto: deve far capire il percorso previsto durante
        // lo sviluppo, non competere con gli eventi.
        paint: { 'line-color': '#3da5ff', 'line-width': 2, 'line-opacity': 0.35 },
      });
    };

    if (map.isStyleLoaded()) add();
    else map.once('load', add);

    return () => {
      if (!mapRef.current) return;
      if (map.getLayer(LAYER)) map.removeLayer(LAYER);
      if (map.getSource(SOURCE)) map.removeSource(SOURCE);
    };
  }, [routeOverlay]);

  // -- altri veicoli (rimovibili: basta non passare `peerVehicles`) ---------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = peerMarkersRef.current;
    const seen = new Set<string>();

    for (const v of peerVehicles ?? []) {
      seen.add(v.id);
      let entry = markers.get(v.id);

      if (!entry) {
        const el = document.createElement('div');
        el.className = 'rs-peer-wrap';
        const halo = document.createElement('div');
        halo.className = 'rs-peer-halo';
        const arrow = document.createElement('div');
        arrow.className = 'rs-peer-arrow';
        const dot = document.createElement('div');
        dot.className = 'rs-peer';
        const flash = document.createElement('div');
        flash.className = 'rs-peer-flash';
        el.append(halo, arrow, dot, flash);
        entry = { marker: new Marker({ element: el }).setLngLat([v.lon, v.lat]).addTo(map), el };
        markers.set(v.id, entry);
      } else {
        entry.marker.setLngLat([v.lon, v.lat]);
      }

      const arrow = entry.el.querySelector<HTMLElement>('.rs-peer-arrow');
      if (arrow) arrow.style.transform = `rotate(${v.heading}deg)`;

      const halo = entry.el.querySelector<HTMLElement>('.rs-peer-halo');
      if (halo) {
        halo.style.borderColor = v.halo ?? 'transparent';
        halo.style.opacity = v.halo ? '1' : '0';
      }

      const flash = entry.el.querySelector<HTMLElement>('.rs-peer-flash');
      if (flash) {
        // textContent, mai innerHTML: nessun contenuto interpretato come markup.
        flash.textContent = v.flash ?? '';
        flash.hidden = !v.flash;
      }
      entry.el.classList.toggle('detecting', Boolean(v.flash));
    }

    for (const [id, entry] of markers) {
      if (!seen.has(id)) {
        entry.marker.remove();
        markers.delete(id);
      }
    }
  }, [peerVehicles]);

  // I marker dei veicoli vanno rimossi quando la mappa viene smontata.
  useEffect(() => {
    const markers = peerMarkersRef.current;
    return () => {
      for (const entry of markers.values()) entry.marker.remove();
      markers.clear();
    };
  }, []);

  // -- aree generiche (rimovibili: basta non passare `areaOverlays`) --------
  const areaKey = useMemo(
    () => (areaOverlays ?? []).map((a) => `${a.id}|${a.lat}|${a.lon}|${a.radiusM}`).join(','),
    [areaOverlays],
  );

  useEffect(() => {
    const map = mapRef.current;
    const markers = areaMarkersRef.current;
    if (!map || !areaOverlays || areaOverlays.length === 0) return;

    const AREA_SOURCE = 'rs-areas';
    const DRIFT_SOURCE = 'rs-areas-drift';
    const FILL = 'rs-areas-fill';
    const OUTLINE = 'rs-areas-outline';
    const DRIFT = 'rs-areas-drift-line';

    const add = () => {
      if (map.getSource(AREA_SOURCE)) return;

      map.addSource(AREA_SOURCE, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: areaOverlays.map((a) => ({
            type: 'Feature' as const,
            properties: { color: a.color },
            geometry: { type: 'Polygon' as const, coordinates: [circle(a)] },
          })),
        },
      });

      map.addSource(DRIFT_SOURCE, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: areaOverlays
            .filter((a) => a.driftHeading !== null)
            .map((a) => ({
              type: 'Feature' as const,
              properties: { color: a.color },
              geometry: { type: 'LineString' as const, coordinates: driftLine(a) },
            })),
        },
      });

      // Riempimento molto tenue: l'area deve leggersi come atmosfera, non
      // come un oggetto sulla carreggiata. La strada resta protagonista.
      map.addLayer({
        id: FILL,
        type: 'fill',
        source: AREA_SOURCE,
        paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.13 },
      });
      // Contorno tratteggiato: un fronte meteo non ha un bordo netto.
      map.addLayer({
        id: OUTLINE,
        type: 'line',
        source: AREA_SOURCE,
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 1.5,
          'line-opacity': 0.55,
          'line-dasharray': [3, 2],
        },
      });
      // Traiettoria prevista: comunica "quest'area si sta muovendo verso di te"
      // senza bisogno di alcuna animazione.
      map.addLayer({
        id: DRIFT,
        type: 'line',
        source: DRIFT_SOURCE,
        layout: { 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': 2,
          'line-opacity': 0.7,
          'line-dasharray': [1, 1.6],
        },
      });

      // I livelli delle aree vanno sotto agli eventi ROAD SENSE, che sono
      // marker HTML e quindi gia' sopra al canvas: qui basta l'ordine interno.
      for (const a of areaOverlays) {
        const el = document.createElement('div');
        el.className = 'rs-area-badge';
        el.style.borderColor = a.color;

        const glyph = document.createElement('span');
        glyph.className = 'g';
        glyph.textContent = a.glyph;

        const text = document.createElement('span');
        text.className = 't';
        const caption = document.createElement('em');
        caption.textContent = a.caption;
        const label = document.createElement('strong');
        label.textContent = a.label;
        text.append(caption, label);

        el.append(glyph, text);

        if (a.driftHeading !== null) {
          const arrow = document.createElement('span');
          arrow.className = 'arrow';
          arrow.textContent = '➤';
          // L'emoji punta a destra: si ruota per indicare la deriva reale.
          arrow.style.transform = `rotate(${a.driftHeading - 90}deg)`;
          el.append(arrow);
        }

        markers.set(a.id, new Marker({ element: el }).setLngLat([a.lon, a.lat]).addTo(map));
      }
    };

    if (map.isStyleLoaded()) add();
    else map.once('load', add);

    return () => {
      for (const m of markers.values()) m.remove();
      markers.clear();
      if (!mapRef.current) return;
      for (const id of [FILL, OUTLINE, DRIFT]) if (map.getLayer(id)) map.removeLayer(id);
      for (const id of [AREA_SOURCE, DRIFT_SOURCE]) if (map.getSource(id)) map.removeSource(id);
    };
    // areaKey riassume il contenuto delle aree.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [areaKey]);

  return <div id="map" ref={containerRef} role="application" aria-label="Mappa ROAD SENSE" />;
}

/** Poligono che approssima il cerchio dell'area, in coordinate GeoJSON. */
function circle(area: AreaOverlay): [number, number][] {
  const steps = 48;
  const out: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const p = destinationPoint(area, (i * 360) / steps, area.radiusM);
    out.push([p.lon, p.lat]);
  }
  return out;
}

/** Segmento che parte dal centro e indica dove si sta spostando l'area. */
function driftLine(area: AreaOverlay): [number, number][] {
  const heading = area.driftHeading ?? 0;
  const tip = destinationPoint(area, heading, area.radiusM * 1.9);
  return [
    [area.lon, area.lat],
    [tip.lon, tip.lat],
  ];
}

function tooltip(c: EventCluster): string {
  const meta = EVENT_META[c.type];
  const pct = Math.round(c.confidence * 100);
  const src = c.reporters === 1 ? '1 segnalatore' : `${c.reporters} segnalatori`;
  return `${meta.label} - affidabilita' ${pct}% - ${src}`;
}
