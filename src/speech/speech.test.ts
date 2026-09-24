/**
 * ROAD SENSE - verifiche su priorita', avvisi parlati e degradazione.
 *
 * Il punto piu' importante: la priorita' NON e' la confidenza. Un veicolo
 * contromano e' critico fin dalla prima segnalazione, ma resta non confermato
 * finche' un secondo segnalatore non concorda.
 */

import { describe, expect, it, vi } from 'vitest';

import { ALERT, SPEECH } from '../config/config';
import { buildClusters } from '../core/ConfidenceEngine';
import { installMemoryStorage } from '../core/testUtils';
import type { EventCluster, RoadEvent } from '../core/types';
import {
  HAZARD_META,
  HAZARD_TYPES,
  hazardFamily,
  hazardPriority,
  PRIORITY_ORDER,
} from '../hazard/taxonomy';
import { mostDescriptiveEvent } from '../hazard/describe';
import { AlertSpeechEngine } from './AlertSpeechEngine';
import { BrowserSpeechProvider } from './BrowserSpeechProvider';
import { SilentSpeechProvider, type SpeechProvider } from './SpeechProvider';
import { roadAlertPhrase, spokenDistance } from './phrases';
import type { HazardAssessment } from '../hazard/assessment';

/** Valutazione di comodo per i test delle frasi. */
const valutazione = (over: Partial<HazardAssessment> = {}): HazardAssessment => ({
  confirmation: 'corroborated',
  priority: null,
  bestSource: 'voice',
  ...over,
});

installMemoryStorage();

/** Provider che registra cio' che avrebbe pronunciato. */
class RecordingSpeech implements SpeechProvider {
  readonly id = 'recording';
  spoken: string[] = [];
  cancelled = 0;
  isSupported(): boolean {
    return true;
  }
  speak(text: string): void {
    this.spoken.push(text);
  }
  cancel(): void {
    this.cancelled++;
  }
}

// Tempo reale: le famiglie ZERO TOUCH hanno TTL brevi - un contromano dura
// quindici minuti - e una base dei tempi fittizia risulterebbe gia' scaduta.
const NOW = Date.now();

let n = 0;
function ev(overrides: Partial<RoadEvent> = {}): RoadEvent {
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    lat: 45.4642,
    lon: 9.19,
    ts: NOW,
    type: 'vehicle',
    severity: 2,
    source: 'voice',
    confidence: 0.55,
    heading: 90,
    reporterId: String(n).padStart(16, '0'),
    ...overrides,
  };
}

describe('tassonomia e priorita\'', () => {
  it('ogni pericolo ha una famiglia e una priorita\'', () => {
    for (const hazard of HAZARD_TYPES) {
      expect(hazardFamily(hazard)).toBeTruthy();
      expect(['critical', 'high', 'medium']).toContain(hazardPriority(hazard));
      expect(HAZARD_META[hazard].label.length).toBeGreaterThan(2);
    }
  });

  it('i pericoli per la vita sono critici', () => {
    for (const h of ['wrong_way_car', 'wrong_way_truck', 'person_on_road', 'accident', 'road_closed'] as const) {
      expect(hazardPriority(h)).toBe('critical');
    }
  });

  it('i disagi sono medi', () => {
    for (const h of ['pothole', 'roadworks', 'stopped_vehicle', 'sudden_queue', 'blocked_toll_booth'] as const) {
      expect(hazardPriority(h)).toBe('medium');
    }
  });

  it('le situazioni gravi ma non immediate sono alte', () => {
    for (const h of ['broken_down_vehicle', 'water_on_road', 'flooding', 'animals_on_road', 'lost_load', 'dangerous_vehicle_behaviour'] as const) {
      expect(hazardPriority(h)).toBe('high');
    }
  });

  it('LA PRIORITA\' NON E\' LA CONFIDENZA', () => {
    // Una sola segnalazione vocale di un veicolo contromano: massima urgenza,
    // ma la zona resta sotto la soglia di allerta finche' non e' confermata.
    const solo = buildClusters([ev({ type: 'wrong_way', hazard: 'wrong_way_truck' })])[0]!;
    expect(hazardPriority('wrong_way_truck')).toBe('critical');
    expect(solo.confidence).toBeLessThan(ALERT.minConfidence);

    // Con un secondo segnalatore indipendente la confidenza sale: la priorita'
    // invece non e' cambiata, perche' non dipende da quanti l'hanno vista.
    const confermato = buildClusters([
      ev({ type: 'wrong_way', hazard: 'wrong_way_truck' }),
      ev({ type: 'wrong_way', hazard: 'wrong_way_truck' }),
    ])[0]!;
    expect(confermato.confidence).toBeGreaterThan(solo.confidence);
    expect(hazardPriority('wrong_way_truck')).toBe('critical');
  });

  it('l\'ordine di urgenza e\' quello atteso', () => {
    expect(PRIORITY_ORDER.critical).toBeLessThan(PRIORITY_ORDER.high);
    expect(PRIORITY_ORDER.high).toBeLessThan(PRIORITY_ORDER.medium);
  });
});

describe('descrizione piu\' informativa di una zona', () => {
  const cluster: EventCluster = {
    id: 'vehicle:45.4642:9.1900',
    lat: 45.4642,
    lon: 9.19,
    type: 'vehicle',
    severity: 2,
    confidence: 0.6,
    count: 2,
    reporters: 2,
    lastTs: NOW,
    heading: 90,
    expiresAt: Number.MAX_SAFE_INTEGER,
  };

  it('preferisce il pericolo piu\' urgente', () => {
    const detail = mostDescriptiveEvent(
      [ev({ hazard: 'stopped_vehicle' }), ev({ hazard: 'broken_down_vehicle' })],
      cluster,
    );
    expect(detail?.hazard).toBe('broken_down_vehicle');
  });

  it('a parita\' di urgenza preferisce chi indica la corsia', () => {
    const detail = mostDescriptiveEvent(
      [ev({ hazard: 'stopped_vehicle' }), ev({ hazard: 'stopped_vehicle', lane: 'second_lane' })],
      cluster,
    );
    expect(detail?.lane).toBe('second_lane');
  });

  it('ignora gli eventi senza classificazione fine', () => {
    expect(mostDescriptiveEvent([ev({ hazard: undefined })], cluster)).toBeUndefined();
  });
});

describe('frasi pronunciate', () => {
  const cluster: EventCluster = {
    id: 'c',
    lat: 45.4642,
    lon: 9.19,
    type: 'vehicle',
    severity: 2,
    confidence: 0.6,
    count: 2,
    reporters: 2,
    lastTs: 0,
    heading: null,
    expiresAt: Number.MAX_SAFE_INTEGER,
  };

  it('sono brevi e nell\'ordine attenzione, cosa, dove, quando', () => {
    const frase = roadAlertPhrase(
      cluster,
      800,
      valutazione({
        priority: hazardPriority('broken_down_vehicle'),
        detail: { hazard: 'broken_down_vehicle', lane: 'second_lane' },
      }),
    );
    expect(frase).toBe('Attenzione. Veicolo in avaria in seconda corsia tra 800 metri.');
  });

  it('senza corsia non inventano una posizione', () => {
    const frase = roadAlertPhrase(
      cluster,
      500,
      valutazione({
        priority: hazardPriority('stopped_vehicle'),
        detail: { hazard: 'stopped_vehicle' },
      }),
    );
    // Nessuna corsia nei dati, nessuna corsia nella frase.
    expect(frase).toBe('Veicolo fermo tra 500 metri.');
  });

  it('"Attenzione" e\' riservato ai pericoli gravi', () => {
    // Se precedesse ogni avviso smetterebbe di significare qualcosa.
    const grave = roadAlertPhrase(
      cluster,
      300,
      valutazione({ priority: 'critical', detail: { hazard: 'wrong_way_car' } }),
    );
    const ordinario = roadAlertPhrase(
      cluster,
      300,
      valutazione({ priority: 'medium', detail: { hazard: 'stopped_vehicle' } }),
    );
    expect(grave).toMatch(/^Attenzione\. /);
    expect(ordinario).not.toMatch(/Attenzione/);
  });

  it('ricadono sulla famiglia quando manca il dettaglio', () => {
    // Un rilevamento dei sensori non sa dire di piu' di "buca": e non lo dice.
    const frase = roadAlertPhrase(cluster, 300);
    expect(frase).toBe('Veicolo fermo tra 300 metri.');
    expect(frase).not.toMatch(/corsia/);
  });

  it('quando non e\' confermata, la frase lo dice', () => {
    // Gravita' e affidabilita' sono cose diverse: l'avviso arriva comunque,
    // ma chi ascolta deve sapere che nessun altro lo ha confermato.
    const frase = roadAlertPhrase(
      cluster,
      1400,
      valutazione({
        confirmation: 'reported',
        priority: 'critical',
        detail: { hazard: 'wrong_way_truck' },
      }),
    );
    expect(frase).toBe(
      'Attenzione. Camion contromano segnalato tra 1,4 chilometri. Segnalazione non ancora confermata.',
    );
  });

  it('la distanza parlata e\' arrotondata', () => {
    expect(spokenDistance(812)).toBe('800 metri');
    expect(spokenDistance(1430)).toBe('1,4 chilometri');
    expect(spokenDistance(12_300)).toBe('12 chilometri');
  });
});

describe('quando parlare', () => {
  it('pronuncia il primo avviso', () => {
    const rec = new RecordingSpeech();
    const engine = new AlertSpeechEngine(rec);
    expect(engine.announce('a', 'Attenzione uno.', 1000)).toBe(true);
    expect(rec.spoken).toEqual(['Attenzione uno.']);
  });

  it('NON ripete lo stesso avviso entro il periodo di attesa', () => {
    const rec = new RecordingSpeech();
    const engine = new AlertSpeechEngine(rec);
    engine.announce('a', 'uno', 1000);
    expect(engine.announce('a', 'uno', 1000 + SPEECH.cooldownMs / 2)).toBe(false);
    expect(engine.announce('a', 'uno', 1000 + SPEECH.cooldownMs + 1)).toBe(true);
    expect(rec.spoken).toHaveLength(2);
  });

  it('deduplica anche se il testo cambia, perche\' l\'avviso e\' lo stesso', () => {
    const rec = new RecordingSpeech();
    const engine = new AlertSpeechEngine(rec);
    engine.announce('a', 'Attenzione. Buca tra 300 metri.', 1000);
    // Avvicinandosi il testo cambia, ma e' sempre la stessa buca.
    expect(engine.announce('a', 'Attenzione. Buca tra 150 metri.', 2000)).toBe(false);
    expect(rec.spoken).toHaveLength(1);
  });

  it('non accavalla due avvisi diversi', () => {
    const rec = new RecordingSpeech();
    const engine = new AlertSpeechEngine(rec);
    engine.announce('a', 'uno', 1000);
    expect(engine.announce('b', 'due', 1000 + SPEECH.minGapMs / 2)).toBe(false);
    expect(engine.announce('b', 'due', 1000 + SPEECH.minGapMs + 1)).toBe(true);
  });

  it('reset dimentica e interrompe', () => {
    const rec = new RecordingSpeech();
    const engine = new AlertSpeechEngine(rec);
    engine.announce('a', 'uno', 1000);
    engine.reset();
    expect(rec.cancelled).toBe(1);
    expect(engine.announce('a', 'uno', 1100)).toBe(true);
  });
});

describe('degradazione senza sintesi vocale', () => {
  it('senza speechSynthesis non parla e non lancia', () => {
    const engine = new AlertSpeechEngine(new SilentSpeechProvider());
    expect(engine.isSupported()).toBe(false);
    expect(engine.announce('a', 'uno', 1000)).toBe(false);
    expect(() => engine.stop()).not.toThrow();
  });

  it('BrowserSpeechProvider rileva l\'assenza dell\'API senza rompersi', () => {
    vi.stubGlobal('window', {});
    const provider = new BrowserSpeechProvider();
    expect(provider.isSupported()).toBe(false);
    expect(() => provider.speak('ciao')).not.toThrow();
    expect(() => provider.cancel()).not.toThrow();
    vi.unstubAllGlobals();
  });
});
