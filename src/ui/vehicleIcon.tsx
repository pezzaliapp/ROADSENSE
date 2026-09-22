/**
 * ROAD SENSE - icona dei veicoli ROAD SENSE simulati.
 *
 * PERCHE' ESISTE QUESTO MODULO
 * La stessa automobile deve comparire in due posti costruiti in modo diverso:
 * come marker sulla mappa (DOM imperativo, creato da MapView) e nella legenda
 * (JSX). Definire la forma UNA SOLA VOLTA garantisce che la legenda mostri
 * davvero il simbolo che si vede sulla mappa, e non un'approssimazione.
 *
 * ORIENTAMENTO
 * Nel sistema di riferimento del disegno il muso punta verso l'ALTO, cioe'
 * verso y decrescente. Coincide con heading 0 = nord: per orientare l'auto
 * basta ruotare di `heading` gradi, senza correzioni.
 *
 * DIMENSIONE
 * Volutamente piccola. A zoom 15 un pixel vale circa 3,3 metri: un'auto in
 * scala sarebbe poco piu' di un pixel e non si vedrebbe. L'icona e' quindi
 * simbolica, ma resta piu' discreta del marker principale, che deve restare
 * il protagonista.
 */

export const CAR_VIEWBOX = '0 0 20 34';

/** Larghezza in pixel dell'icona sulla mappa; l'altezza segue le proporzioni. */
export const CAR_WIDTH_PX = 13;
export const CAR_HEIGHT_PX = Math.round((CAR_WIDTH_PX * 34) / 20);

type Part = 'body' | 'glass';

interface CarShape {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
  part: Part;
}

/** Sagoma vista dall'alto: scocca, parabrezza, lunotto, specchietti. */
const CAR_SHAPES: readonly CarShape[] = [
  { x: 2.5, y: 1, w: 15, h: 32, r: 5.5, part: 'body' },
  { x: 0.4, y: 11, w: 2.6, h: 4.5, r: 1.2, part: 'body' },
  { x: 17, y: 11, w: 2.6, h: 4.5, r: 1.2, part: 'body' },
  { x: 5.2, y: 4.6, w: 9.6, h: 6.4, r: 2.4, part: 'glass' },
  { x: 5.2, y: 22.4, w: 9.6, h: 5.6, r: 2.2, part: 'glass' },
];

const GLASS = '#10161d';

/**
 * Crea l'elemento SVG dell'auto senza usare `innerHTML`.
 * La sagoma e' scritta nel codice e non deriva da alcun input, ma costruirla
 * nodo per nodo evita del tutto la questione.
 */
export function createCarSvg(bodyColor: string): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', CAR_VIEWBOX);
  svg.setAttribute('width', String(CAR_WIDTH_PX));
  svg.setAttribute('height', String(CAR_HEIGHT_PX));
  svg.setAttribute('aria-hidden', 'true');

  for (const s of CAR_SHAPES) {
    const rect = document.createElementNS(NS, 'rect');
    rect.setAttribute('x', String(s.x));
    rect.setAttribute('y', String(s.y));
    rect.setAttribute('width', String(s.w));
    rect.setAttribute('height', String(s.h));
    rect.setAttribute('rx', String(s.r));
    rect.setAttribute('fill', s.part === 'glass' ? GLASS : bodyColor);
    svg.appendChild(rect);
  }
  return svg;
}

/** Cambia il colore della scocca senza ricostruire l'elemento. */
export function setCarBodyColor(svg: SVGSVGElement, color: string): void {
  const rects = svg.querySelectorAll('rect');
  CAR_SHAPES.forEach((s, i) => {
    if (s.part === 'body') rects[i]?.setAttribute('fill', color);
  });
}

/** La stessa automobile, per la legenda. */
export function CarGlyph({ color, width = 11 }: { color: string; width?: number }) {
  return (
    <svg
      viewBox={CAR_VIEWBOX}
      width={width}
      height={Math.round((width * 34) / 20)}
      aria-hidden="true"
    >
      {CAR_SHAPES.map((s, i) => (
        <rect
          key={i}
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          rx={s.r}
          fill={s.part === 'glass' ? GLASS : color}
        />
      ))}
    </svg>
  );
}

/** Colori della scocca. */
export const CAR_COLOR = {
  /** Veicolo ROAD SENSE simulato, in condizioni normali. */
  peer: '#aab6c2',
  /** Veicolo che sta rilevando qualcosa. */
  detecting: '#ffb020',
} as const;
