/**
 * ROAD SENSE - MATRICE VOCALE: la catena completa, frase per frase.
 *
 * PERCHE' NON BASTA TESTARE IL PARSER
 *
 * Un test che chiama `parseVoiceReport('nebbia')` e lo vede rispondere
 * `sudden_fog` non dimostra nulla su cio' che accade in auto. Dimostra che SE la
 * parola arriva, viene capita. Ma per anni quella parola non poteva arrivare: la
 * grammatica Vosk ammetteva quattro termini, e "nebbia" non era fra loro. Il test
 * passava, la funzione non esisteva.
 *
 * Ogni riga della matrice qui sotto verifica quindi DUE cose insieme:
 *
 *   1. SEMANTICA    il parser produce il pericolo giusto, e la corsia solo se detta
 *   2. DICIBILITA'  ogni parola della frase e' ammessa dalla grammatica, ed e'
 *                   stata verificata nel vocabolario reale del modello
 *
 * Se una delle due cade, la riga cade. E' l'unico modo di impedire che una
 * funzione torni a esistere solo sulla carta.
 */

import { describe, expect, it } from 'vitest';

import { VOICE_GRAMMAR, UNKNOWN_TOKEN, VERIFIED_WORDS } from './local/grammar';
import { normalize } from './lexicon';
import { parseVoiceReport } from './parser';
import type { HazardType } from '../hazard/taxonomy';
import type { RoadLane } from '../core/types';

const TERMINI = new Set(VOICE_GRAMMAR.filter((v) => !v.includes(' ') && v !== UNKNOWN_TOKEN));

interface Riga {
  frase: string;
  hazard: HazardType;
  lane?: RoadLane;
}

/**
 * Le frasi della matrice concordata. L'ordine segue il modo in cui si parla in
 * auto: prima la strada, poi i veicoli, poi il meteo.
 */
const MATRICE: readonly Riga[] = [
  // --- strada -------------------------------------------------------------
  { frase: 'buca', hazard: 'pothole' },
  { frase: 'strada dissestata', hazard: 'road_surface_anomaly' },
  { frase: 'ostacolo', hazard: 'generic_obstacle' },
  { frase: 'oggetto sulla carreggiata', hazard: 'generic_obstacle', lane: 'carriageway' },
  { frase: 'acqua', hazard: 'water_on_road' },
  { frase: 'allagamento', hazard: 'flooding' },
  { frase: 'ghiaccio', hazard: 'ice' },
  { frase: 'neve', hazard: 'snow' },
  { frase: 'fango', hazard: 'mud' },
  { frase: 'lavori', hazard: 'roadworks' },
  { frase: 'strada chiusa', hazard: 'road_closed' },

  // --- incidente e corsie: da prima a quinta ------------------------------
  { frase: 'incidente', hazard: 'accident' },
  { frase: 'incidente in prima corsia', hazard: 'accident', lane: 'first_lane' },
  { frase: 'incidente in seconda corsia', hazard: 'accident', lane: 'second_lane' },
  { frase: 'incidente in terza corsia', hazard: 'accident', lane: 'third_lane' },
  { frase: 'incidente in quarta corsia', hazard: 'accident', lane: 'fourth_lane' },
  { frase: 'incidente in quinta corsia', hazard: 'accident', lane: 'fifth_lane' },

  // --- veicoli ------------------------------------------------------------
  { frase: 'veicolo fermo', hazard: 'stopped_vehicle' },
  { frase: 'auto ferma in terza corsia', hazard: 'stopped_vehicle', lane: 'third_lane' },
  { frase: 'auto contromano', hazard: 'wrong_way_car' },
  { frase: 'macchina contromano', hazard: 'wrong_way_car' },
  { frase: 'veicolo contromano', hazard: 'wrong_way_car' },
  { frase: 'coda', hazard: 'sudden_queue' },
  { frase: 'rallentamento', hazard: 'sudden_queue' },

  // --- persone e animali --------------------------------------------------
  { frase: 'persona sulla strada', hazard: 'person_on_road' },
  { frase: 'animale sulla strada', hazard: 'animals_on_road' },

  // --- meteo --------------------------------------------------------------
  { frase: 'grandine', hazard: 'hail' },
  { frase: 'grandine forte', hazard: 'hail' },
  { frase: 'temporale', hazard: 'intense_rain' },
  { frase: 'bufera', hazard: 'possible_downburst' },
  { frase: 'pioggia intensa', hazard: 'intense_rain' },
  { frase: 'vento forte', hazard: 'violent_gusts' },
  { frase: 'raffiche', hazard: 'violent_gusts' },
  { frase: 'nebbia', hazard: 'sudden_fog' },
  { frase: 'neve intensa', hazard: 'snow' },
];

describe('matrice vocale / la frase viene capita', () => {
  it.each(MATRICE)('"$frase" -> $hazard', ({ frase, hazard, lane }) => {
    const esito = parseVoiceReport(frase, { requireWakeWord: false });
    expect(esito.ok, `"${frase}" non viene capita`).toBe(true);
    if (!esito.ok) return;
    expect(esito.report.hazard).toBe(hazard);
    // La corsia c'e' se e solo se e' stata pronunciata: dedurla sarebbe inventare.
    expect(esito.report.lane).toBe(lane);
  });
});

describe('matrice vocale / la frase si puo dire al decoder', () => {
  it.each(MATRICE)('"$frase" e ammessa dalla grammatica', ({ frase }) => {
    for (const parola of normalize(frase).split(' ')) {
      expect(TERMINI.has(parola), `"${parola}" non e' in grammatica: la frase non si puo' dire`).toBe(
        true,
      );
    }
  });

  it.each(MATRICE)('"$frase" usa solo parole verificate nel modello Vosk', ({ frase }) => {
    // Vosk scarta in silenzio i token che il modello non conosce: una frase in
    // grammatica ma non nel modello resterebbe indicibile senza alcun segnale.
    for (const parola of normalize(frase).split(' ')) {
      expect(VERIFIED_WORDS.has(parola), `"${parola}" non e' verificata nel modello`).toBe(true);
    }
  });
});

describe('matrice vocale / cio che l ampliamento ha reso possibile', () => {
  /** Le frasi che prima dell'intervento nessuna voce poteva pronunciare. */
  const PRIMA_IMPOSSIBILI: readonly Riga[] = [
    { frase: 'bufera', hazard: 'possible_downburst' },
    { frase: 'tempesta', hazard: 'possible_downburst' },
    { frase: 'burrasca', hazard: 'possible_downburst' },
    { frase: 'gelata', hazard: 'ice_weather' },
    { frase: 'gelo', hazard: 'ice_weather' },
    { frase: 'brina', hazard: 'ice_weather' },
    { frase: 'oggetto sulla carreggiata', hazard: 'generic_obstacle', lane: 'carriageway' },
    { frase: 'incidente in quarta corsia', hazard: 'accident', lane: 'fourth_lane' },
    { frase: 'incidente in quinta corsia', hazard: 'accident', lane: 'fifth_lane' },
    { frase: 'frana', hazard: 'landslide' },
    { frase: 'camion contromano', hazard: 'wrong_way_truck' },
    { frase: 'auto in avaria in corsia di emergenza', hazard: 'broken_down_vehicle', lane: 'emergency_lane' },
  ];

  it.each(PRIMA_IMPOSSIBILI)('"$frase" ora si dice e si capisce', ({ frase, hazard, lane }) => {
    for (const parola of normalize(frase).split(' ')) {
      expect(TERMINI.has(parola), `"${parola}" non e' pronunciabile`).toBe(true);
    }
    const esito = parseVoiceReport(frase, { requireWakeWord: false });
    expect(esito.ok).toBe(true);
    if (!esito.ok) return;
    expect(esito.report.hazard).toBe(hazard);
    expect(esito.report.lane).toBe(lane);
  });

  it('la parola di attivazione funziona come in guida', () => {
    // In guida `requireWakeWord` e' true: senza la wake word in grammatica il
    // decoder non potrebbe trascriverla e nessuna segnalazione passerebbe.
    const esito = parseVoiceReport('road sense incidente in seconda corsia');
    expect(esito.ok).toBe(true);
    if (!esito.ok) return;
    expect(esito.report.hazard).toBe('accident');
    expect(esito.report.lane).toBe('second_lane');
    for (const parola of 'road sense'.split(' ')) expect(TERMINI.has(parola)).toBe(true);
  });
});

describe('matrice vocale / cio che NON deve cambiare', () => {
  it('gli aggettivi di intensita non producono severita', () => {
    // La gravita' resta una proprieta' della categoria, non di come la frase e'
    // stata raccontata: "grandine forte" e "grandine" sono lo stesso evento.
    const forte = parseVoiceReport('grandine forte', { requireWakeWord: false });
    const semplice = parseVoiceReport('grandine', { requireWakeWord: false });
    expect(forte.ok && semplice.ok).toBe(true);
    if (!forte.ok || !semplice.ok) return;
    expect(forte.report.hazard).toBe(semplice.report.hazard);
    expect(Object.keys(forte.report).sort()).toEqual(Object.keys(semplice.report).sort());
  });

  it('una corsia non detta resta vuota', () => {
    const esito = parseVoiceReport('auto ferma', { requireWakeWord: false });
    expect(esito.ok).toBe(true);
    if (!esito.ok) return;
    expect(esito.report.lane).toBeUndefined();
  });

  it('le parole inerti non generano segnalazioni da sole', () => {
    // Sono in grammatica per rendere dicibile la frase intera; da sole non
    // devono produrre nulla, altrimenti un rumore basterebbe a segnalare.
    for (const inerte of ['in', 'su', 'sulla', 'della', 'forte', 'grande', 'molto', 'intensa']) {
      expect(TERMINI.has(inerte), `"${inerte}" dovrebbe essere pronunciabile`).toBe(true);
      const esito = parseVoiceReport(inerte, { requireWakeWord: false });
      expect(esito.ok, `"${inerte}" da sola ha generato una segnalazione`).toBe(false);
    }
  });

  it('senza parola di attivazione, in guida, non passa nulla', () => {
    const esito = parseVoiceReport('incidente in prima corsia');
    expect(esito.ok).toBe(false);
  });
});
