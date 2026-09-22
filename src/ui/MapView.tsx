/**
 * ROAD SENSE - mappa.
 *
 * Leaflet usato direttamente (nessun wrapper React): meno dipendenze e
 * controllo esplicito sul ciclo di vita dei layer, che e' cio' che conta per
 * il consumo di risorse.
 *
 * SCELTE PER LA BATTERIA
 * - i marker vengono aggiornati solo quando i cluster cambiano davvero;
 * - la vista segue l'utente con un movimento semplice, senza animazioni;
 * - nessun prefetch di tile: Leaflet scarica solo cio' che e' visibile.
 */

import { useEffect, useMemo, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { MAP, TILE_PROVIDER } from '../config/config';
import { confidenceLevel } from '../core/ConfidenceEngine';
import type { EventCluster } from '../core/types';
import { EVENT_META } from './eventMeta';

interface Props {
  clusters: readonly EventCluster[];
  position: { lat: number; lon: number } | null;
  heading: number | null;
  /** Se true la mappa insegue la posizione. */
  follow: boolean;
  onMapMovedByUser?: () => void;
}

export function MapView({ clusters, position, heading, follow, onMapMovedByUser }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const meRef = useRef<L.Marker | null>(null);
  const firstFixRef = useRef(false);

  // -- inizializzazione (una sola volta) -----------------------------------
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const markers = markersRef.current;

    const map = L.map(containerRef.current, {
      center: MAP.fallbackCenter,
      zoom: MAP.fallbackZoom,
      zoomControl: true,
      attributionControl: true,
      // La rotazione a due dita non serve e crea disorientamento in auto.
      touchZoom: true,
      preferCanvas: false,
    });

    L.tileLayer(TILE_PROVIDER.url, {
      attribution: TILE_PROVIDER.attribution,
      maxZoom: TILE_PROVIDER.maxZoom,
      minZoom: MAP.minZoom,
      // Nessun prefetch fuori schermo: rispetto della policy OSM.
      keepBuffer: 1,
      updateWhenIdle: true,
    }).addTo(map);

    map.on('dragstart', () => onMapMovedByUser?.());
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markers.clear();
      meRef.current = null;
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
      const html = `<div class="rs-marker ${level}" style="color:${meta.color}">${meta.glyph}</div>`;
      const icon = L.divIcon({ className: '', html, iconSize: [30, 30] });

      const existing = markers.get(c.id);
      if (existing) {
        existing.setIcon(icon);
        existing.setLatLng([c.lat, c.lon]);
        existing.setTooltipContent(tooltip(c));
      } else {
        const m = L.marker([c.lat, c.lon], { icon, keyboard: false })
          .addTo(map)
          .bindTooltip(tooltip(c), { direction: 'top', offset: [0, -16] });
        markers.set(c.id, m);
      }
    }

    // Rimozione dei cluster scaduti o non piu' presenti.
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

    const html =
      heading === null
        ? '<div class="rs-me"></div>'
        : `<div class="rs-me"></div><div class="rs-me-arrow" style="transform:rotate(${heading}deg)"></div>`;
    const icon = L.divIcon({ className: '', html, iconSize: [22, 22] });

    if (meRef.current) {
      meRef.current.setLatLng([position.lat, position.lon]);
      meRef.current.setIcon(icon);
    } else {
      meRef.current = L.marker([position.lat, position.lon], {
        icon,
        keyboard: false,
        zIndexOffset: 1000,
      }).addTo(map);
    }

    if (follow) {
      if (!firstFixRef.current) {
        map.setView([position.lat, position.lon], MAP.followZoom);
        firstFixRef.current = true;
      } else {
        map.panTo([position.lat, position.lon], { animate: false });
      }
    }
  }, [position, heading, follow]);

  return <div id="map" ref={containerRef} role="application" aria-label="Mappa ROAD SENSE" />;
}

function tooltip(c: EventCluster): string {
  const meta = EVENT_META[c.type];
  const pct = Math.round(c.confidence * 100);
  const src = c.reporters === 1 ? '1 segnalatore' : `${c.reporters} segnalatori`;
  // Contenuto costruito solo da valori interni tipizzati: nessun input utente
  // libero finisce nell'HTML (non esistono descrizioni testuali in ROAD SENSE).
  return `${meta.label} - affidabilita' ${pct}% - ${src}`;
}
