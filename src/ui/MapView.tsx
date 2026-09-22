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
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import { ACTIVE_MAP_PROVIDER, MAP, type MapTileProvider } from '../config/config';
import { confidenceLevel } from '../core/ConfidenceEngine';
import type { EventCluster } from '../core/types';
import { EVENT_META } from './eventMeta';

interface Props {
  clusters: readonly EventCluster[];
  position: { lat: number; lon: number } | null;
  heading: number | null;
  follow: boolean;
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

export function MapView({ clusters, position, heading, follow, onMapMovedByUser }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const meRef = useRef<Marker | null>(null);
  const meElRef = useRef<HTMLDivElement | null>(null);
  const firstFixRef = useRef(false);

  // -- inizializzazione (una sola volta) -----------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const markers = markersRef.current;
    const provider = ACTIVE_MAP_PROVIDER;

    const map = new MapLibreMap({
      container: containerRef.current,
      style: styleFor(provider),
      center: [MAP.fallbackCenter[1], MAP.fallbackCenter[0]], // MapLibre usa [lon, lat]
      zoom: MAP.fallbackZoom,
      minZoom: MAP.minZoom,
      maxZoom: Math.min(MAP.maxZoom, provider.maxZoom),
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

    // L'attribuzione del fornitore vettoriale arriva dallo stile; per il raster
    // e' gia' nella sorgente. Questo la garantisce in entrambi i casi.
    map.addControl(
      new AttributionControl({ compact: true, customAttribution: provider.attribution }),
    );

    map.on('load', () => {
      readyRef.current = true;
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
        map.jumpTo({ center: [position.lon, position.lat], zoom: MAP.followZoom });
        firstFixRef.current = true;
      } else {
        // `jumpTo` e non `easeTo`: nessuna animazione, nessun fotogramma extra.
        map.jumpTo({ center: [position.lon, position.lat] });
      }
    }
  }, [position, heading, follow]);

  return <div id="map" ref={containerRef} role="application" aria-label="Mappa ROAD SENSE" />;
}

function tooltip(c: EventCluster): string {
  const meta = EVENT_META[c.type];
  const pct = Math.round(c.confidence * 100);
  const src = c.reporters === 1 ? '1 segnalatore' : `${c.reporters} segnalatori`;
  return `${meta.label} - affidabilita' ${pct}% - ${src}`;
}
