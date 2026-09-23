/**
 * ROAD SENSE - verifiche sul parser vocale.
 *
 * Il test piu' importante di questo file non riguarda cio' che il parser
 * riconosce, ma cio' che NON inventa: un attributo dedotto e mai pronunciato
 * diventa un avviso falso a chi guida.
 */

import { describe, expect, it } from 'vitest';

import { parseVoiceReport } from './parser';
import { normalize } from './lexicon';

/** Esegue il parser su una frase completa e ne restituisce il risultato. */
function parse(phrase: string) {
  const r = parseVoiceReport(phrase);
  return r.ok ? r.report : null;
}

describe('parola di attivazione', () => {
  it('senza "ROAD SENSE" la frase viene ignorata', () => {
    const r = parseVoiceReport('incidente in seconda corsia');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('no-wake-word');
  });

  it('tollera le varianti che il riconoscimento produce davvero', () => {
    for (const wake of ['ROAD SENSE', 'roadsense', 'Rod sense']) {
      expect(parse(`${wake}, incidente`)?.hazard).toBe('accident');
    }
  });

  it('funziona anche se il riconoscimento aggancia qualcosa prima', () => {
    expect(parse('ehm allora road sense buca')?.hazard).toBe('pothole');
  });

  it('nei test si puo\' disattivare la parola di attivazione', () => {
    const r = parseVoiceReport('grandine', { requireWakeWord: false });
    expect(r.ok).toBe(true);
  });

  it('la sola parola di attivazione non e\' una segnalazione', () => {
    const r = parseVoiceReport('road sense');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('empty');
  });
});

describe('sinonimi', () => {
  it('auto, macchina e vettura sono la stessa cosa', () => {
    for (const w of ['auto', 'macchina', 'vettura', 'automobile']) {
      expect(parse(`road sense, ${w} contromano`)?.hazard).toBe('wrong_way_car');
    }
  });

  it('camion, autocarro e tir sono la stessa cosa', () => {
    for (const w of ['camion', 'autocarro', 'tir', 'autoarticolato']) {
      expect(parse(`road sense, ${w} contromano`)?.hazard).toBe('wrong_way_truck');
    }
  });

  it('uomo, persona e pedone sono la stessa cosa', () => {
    for (const w of ['uomo', 'persona', 'pedone', 'donna']) {
      expect(parse(`road sense, ${w} in strada`)?.hazard).toBe('person_on_road');
    }
  });

  it('avaria, panne e guasto sono la stessa cosa', () => {
    for (const w of ['in avaria', 'in panne', 'guasto']) {
      expect(parse(`road sense, auto ${w}`)?.hazard).toBe('broken_down_vehicle');
    }
  });

  it('acqua, pozzanghera e allagamento non sono la stessa cosa', () => {
    // Allagamento e' piu' grave di una pozzanghera: categorie diverse.
    expect(parse('road sense, acqua sulla carreggiata')?.hazard).toBe('water_on_road');
    expect(parse('road sense, pozzanghera')?.hazard).toBe('water_on_road');
    expect(parse('road sense, strada allagata')?.hazard).toBe('flooding');
  });
});

describe('auto contro camion', () => {
  it('distingue il mezzo nel contromano', () => {
    expect(parse('road sense, camion contromano')?.hazard).toBe('wrong_way_truck');
    expect(parse('road sense, auto contromano')?.hazard).toBe('wrong_way_car');
  });

  it('senza mezzo resta il contromano generico', () => {
    const r = parse('road sense, contromano');
    expect(r?.hazard).toBe('wrong_way_car');
    // Nessun soggetto inventato.
    expect(r?.subject).toBeUndefined();
  });

  it('registra il soggetto quando viene nominato', () => {
    expect(parse('road sense, camion contromano')?.subject).toBe('truck');
    expect(parse('road sense, auto contromano')?.subject).toBe('car');
  });
});

describe('corsie', () => {
  it('riconosce le corsie numerate', () => {
    expect(parse('road sense, incidente in prima corsia')?.lane).toBe('first_lane');
    expect(parse('road sense, incidente in seconda corsia')?.lane).toBe('second_lane');
    expect(parse('road sense, incidente in terza corsia')?.lane).toBe('third_lane');
  });

  it('riconosce le corsie per nome', () => {
    expect(parse('road sense, auto ferma in corsia di emergenza')?.lane).toBe('emergency_lane');
    expect(parse('road sense, macchina ferma in corsia di sorpasso')?.lane).toBe('overtaking_lane');
    expect(parse('road sense, ostacolo in corsia di marcia')?.lane).toBe('driving_lane');
    expect(parse('road sense, detriti in corsia centrale')?.lane).toBe('central_lane');
    expect(parse('road sense, persona sulla carreggiata')?.lane).toBe('carriageway');
    expect(parse('road sense, auto ferma sul bordo strada')?.lane).toBe('roadside');
  });

  it('NON inventa la corsia quando non viene detta', () => {
    expect(parse('road sense, auto ferma')?.lane).toBeUndefined();
    expect(parse('road sense, incidente')?.lane).toBeUndefined();
    expect(parse('road sense, buca')?.lane).toBeUndefined();
  });
});

describe('nessuna invenzione di attributi', () => {
  it('"auto ferma" non diventa un\'avaria', () => {
    const r = parse('road sense, auto ferma');
    expect(r?.hazard).toBe('stopped_vehicle');
    expect(r?.state).toBe('stopped');
    expect(r?.lane).toBeUndefined();
  });

  it('"auto ferma" non diventa un incidente', () => {
    expect(parse('road sense, auto ferma')?.hazard).not.toBe('accident');
  });

  it('"incidente" non acquisisce ne\' corsia ne\' soggetto', () => {
    const r = parse('road sense, incidente');
    expect(r?.hazard).toBe('accident');
    expect(r?.lane).toBeUndefined();
    expect(r?.subject).toBeUndefined();
    expect(r?.state).toBeUndefined();
  });

  it('nessun campo valorizzato senza una parola che lo sostenga', () => {
    const r = parse('road sense, grandine');
    expect(r?.hazard).toBe('hail');
    expect(r?.subject).toBeUndefined();
    expect(r?.state).toBeUndefined();
    expect(r?.lane).toBeUndefined();
  });
});

describe('frase completa dell\'esempio di riferimento', () => {
  it('"auto in avaria ferma in seconda corsia"', () => {
    const r = parse('ROAD SENSE, auto in avaria ferma in seconda corsia');
    expect(r?.hazard).toBe('broken_down_vehicle');
    expect(r?.state).toBe('broken_down');
    expect(r?.lane).toBe('second_lane');
    expect(r?.subject).toBe('car');
  });
});

describe('categorie riconosciute', () => {
  const casi: ReadonlyArray<[string, string]> = [
    ['road sense, camion contromano', 'wrong_way_truck'],
    ['road sense, auto contromano', 'wrong_way_car'],
    ['road sense, auto in avaria in seconda corsia', 'broken_down_vehicle'],
    ['road sense, macchina ferma in corsia di sorpasso', 'stopped_vehicle'],
    ['road sense, uomo in strada', 'person_on_road'],
    ['road sense, persona sulla carreggiata', 'person_on_road'],
    ['road sense, animali sulla strada', 'animals_on_road'],
    ['road sense, gregge sulla strada', 'herd_on_road'],
    ['road sense, acqua sulla carreggiata', 'water_on_road'],
    ['road sense, strada allagata', 'flooding'],
    ['road sense, grandine', 'hail'],
    ['road sense, incidente', 'accident'],
    ['road sense, incidente in seconda corsia', 'accident'],
    ['road sense, ostacolo in corsia', 'generic_obstacle'],
    ['road sense, casello bloccato', 'blocked_toll_booth'],
    ['road sense, processione', 'procession'],
    ['road sense, manifestazione', 'demonstration'],
    ['road sense, auto pericolosa', 'dangerous_vehicle_behaviour'],
    ['road sense, camion fermo in corsia di emergenza', 'stopped_vehicle'],
    ['road sense, frana', 'landslide'],
    ['road sense, albero caduto', 'fallen_tree'],
    ['road sense, nebbia', 'sudden_fog'],
    ['road sense, neve', 'snow'],
    ['road sense, coda', 'sudden_queue'],
    ['road sense, lavori in corso', 'roadworks'],
    ['road sense, ghiaccio', 'ice'],
    ['road sense, detriti sulla strada', 'debris'],
    ['road sense, buca', 'pothole'],
  ];

  for (const [frase, atteso] of casi) {
    it(`"${frase}" -> ${atteso}`, () => {
      expect(parse(frase)?.hazard).toBe(atteso);
    });
  }
});

describe('frasi incomplete o sconosciute', () => {
  it('una frase che parla di pericolo senza dire quale resta non identificata', () => {
    const r = parse('road sense, c\'e\' qualcosa di pericoloso');
    expect(r?.hazard).toBe('unknown_hazard');
  });

  it('conserva comunque corsia e soggetto se pronunciati', () => {
    const r = parse('road sense, attenzione in seconda corsia');
    expect(r?.hazard).toBe('unknown_hazard');
    expect(r?.lane).toBe('second_lane');
  });

  it('una frase senza alcun indizio non produce nulla', () => {
    const r = parseVoiceReport('road sense, che bella giornata');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not-understood');
  });

  it('una frase vuota non produce nulla', () => {
    const r = parseVoiceReport('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('empty');
  });

  it('conserva la trascrizione normalizzata per poter capire la decisione', () => {
    expect(parse('ROAD SENSE, Auto Contromano!')?.transcript).toBe('auto contromano');
  });
});

describe('normalizzazione', () => {
  it('toglie accenti, maiuscole e punteggiatura', () => {
    expect(normalize('Perché, ATTENZIONE!')).toBe('perche attenzione');
  });
});
