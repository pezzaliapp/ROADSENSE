/**
 * ROAD SENSE - piu' comandi di seguito, separati dalla voce sintetica.
 *
 * IL GUASTO CHE QUESTO FILE DESCRIVE
 *
 * Sul Samsung Fold: START, VOCE, "Buca" riconosciuta, evento creato, ROAD SENSE
 * pronuncia "Buca tra 50 metri". Poi "Ostacolo" tre volte e "Acqua": nessuna
 * reazione. Il microfono era aperto, il decoder era pronto, il cancello
 * funzionava. Eppure dal secondo comando in poi il decoder non riceveva piu'
 * l'audio giusto.
 *
 * Il motivo sta nel sistema di riferimento. `UtteranceCapture` legge dal buffer
 * circolare usando INDICI ASSOLUTI di campione, e li chiede al cancello:
 *
 *     ring.readFrom(gate.position() - preRoll, ...)
 *
 * I due contatori - `RingBuffer.written` e `SpeechGate.consumed` - avanzano
 * insieme, perche' avanzano nella stessa riga di `UtteranceCapture.push()`.
 * Restano quindi allineati per costruzione... finche' qualcuno non azzera solo
 * uno dei due.
 *
 * Ed e' esattamente cio' che faceva il provider quando ROAD SENSE cominciava a
 * parlare: `gate.reset()`, che riporta `consumed` a zero mentre il buffer
 * continua da dove era. Da quel momento gli indici del cancello indicano un
 * punto del buffer che non esiste piu', e cio' che arriva al decoder e' audio
 * vecchio di secondi - o niente affatto.
 *
 * Un comando funzionava: il primo, quando i due contatori partono entrambi da
 * zero. Tutti i successivi no. E' la firma esatta osservata in auto.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { RingBuffer } from './ringBuffer';
import { DEFAULT_GATE, msToSamples, SpeechGate } from './speechGate';
import { UtteranceCapture, type UtteranceSink } from './utteranceCapture';

const SR = 16_000;
const FRAME = 1024;
const PRE_ROLL_MS = 400;
/** Ampiezza del primo campione di ogni parola: serve a ritrovarla nel segmento. */
const MARKER = 0.9;
const BODY = 0.4;
const NOISE = 0.004;

/**
 * Riproduce la catena del provider: microfono continuo, buffer, cancello,
 * consegna al decoder. `parla()` e `taci()` fanno cio' che fanno `pause()` e
 * `resume()` quando ROAD SENSE usa la voce sintetica.
 */
function catena() {
  const gate = new SpeechGate({ ...DEFAULT_GATE, sampleRate: SR });
  const ring = new RingBuffer(SR * 3);
  /** Segmenti consegnati al decoder, uno per enunciato. */
  const enunciati: number[][] = [];
  /** Frammenti abbandonati perche' interrotti dalla voce sintetica. */
  const scartati: number[][] = [];
  let corrente: number[] = [];

  const sink: UtteranceSink = {
    feed: (s) => {
      for (const v of s) corrente.push(v);
    },
    flush: () => {
      enunciati.push(corrente);
      corrente = [];
    },
  };
  const capture = new UtteranceCapture(ring, gate, sink, SR, PRE_ROLL_MS);

  /** ROAD SENSE sta parlando: i campioni non vengono consegnati. */
  let speaking = false;
  const frame = (level: number, marker = false): Float32Array => {
    const f = new Float32Array(FRAME).fill(level);
    if (marker) f[0] = MARKER;
    return f;
  };
  const spingi = (f: Float32Array): void => {
    // E' `VoskVoiceProvider.onFrame`: mentre si parla, il frame si scarta.
    if (speaking) return;
    capture.push(f);
  };

  return {
    gate,
    capture,
    enunciati,
    scartati,
    silenzio: (n: number) => {
      for (let i = 0; i < n; i++) spingi(frame(NOISE));
    },
    parola: (n = 8) => {
      spingi(frame(BODY, true));
      for (let i = 1; i < n; i++) spingi(frame(BODY));
    },
    /** Inizio della voce sintetica: come `provider.pause()`. */
    parla: () => {
      speaking = true;
      capture.suspend();
      // Il provider chiude anche il decoder (`recognizer.flush()`): cio' che
      // era stato consegnato a meta' viene scartato, non appeso all'enunciato
      // successivo. Senza, una parola spezzata dal TTS si fonderebbe con la
      // prossima.
      scartati.push(corrente);
      corrente = [];
    },
    /** Fine della voce sintetica: come `provider.resume()`. */
    taci: (durataFrame = 30) => {
      // Mentre parla, il microfono resta APERTO e i frame continuano ad
      // arrivare dal worklet: semplicemente non vengono consegnati.
      for (let i = 0; i < durataFrame; i++) spingi(frame(0.7));
      speaking = false;
    },
  };
}

/** Quante parole sono arrivate davvero al decoder. */
const marcatori = (segmento: number[]): number => segmento.filter((v) => v > 0.8).length;

describe('tre comandi di seguito, separati dalla voce sintetica', () => {
  it('ogni comando arriva al decoder, non solo il primo', () => {
    const c = catena();
    c.silenzio(60); // calibrazione

    for (let parola = 0; parola < 3; parola++) {
      c.parola();
      c.silenzio(20); // il cancello chiude e consegna
      c.parla();
      c.taci(); // ROAD SENSE pronuncia l'avviso
      c.silenzio(20);
    }

    expect(c.enunciati).toHaveLength(3);
    // Il cuore del guasto: il primo enunciato arrivava, gli altri no.
    c.enunciati.forEach((seg, i) => {
      expect(marcatori(seg), `enunciato ${i + 1}: parola assente nel segmento`).toBe(1);
      expect(seg.length, `enunciato ${i + 1}: segmento vuoto`).toBeGreaterThan(
        msToSamples(PRE_ROLL_MS, SR),
      );
    });
  });

  it('il riferimento del cancello resta allineato al buffer dopo la voce sintetica', () => {
    // E' l'invariante che il guasto rompeva. Verificarla direttamente rende il
    // difetto impossibile da reintrodurre senza accorgersene.
    const c = catena();
    c.silenzio(60);
    const primaDelTts = c.gate.position();

    c.parla();
    c.taci();

    // Durante la voce sintetica nessun campione viene consegnato: il
    // riferimento non deve ne' avanzare ne' - soprattutto - azzerarsi.
    expect(c.gate.position()).toBe(primaDelTts);

    c.silenzio(5);
    expect(c.gate.position()).toBe(primaDelTts + 5 * FRAME);
  });

  it('dieci comandi di seguito: nessuna deriva', () => {
    const c = catena();
    c.silenzio(60);
    for (let i = 0; i < 10; i++) {
      c.parola();
      c.silenzio(20);
      c.parla();
      c.taci(10);
      c.silenzio(20);
    }
    expect(c.enunciati).toHaveLength(10);
    expect(c.enunciati.every((s) => marcatori(s) === 1)).toBe(true);
  });

  it('la voce sintetica non entra mai nel segmento consegnato', () => {
    // Il livello del TTS e' 0.7: se comparisse nei campioni consegnati,
    // ROAD SENSE potrebbe segnalare cio' che ha appena detto.
    const c = catena();
    c.silenzio(60);
    c.parola();
    c.silenzio(20);
    c.parla();
    c.taci();
    c.silenzio(20);
    c.parola();
    c.silenzio(20);

    for (const seg of c.enunciati) {
      // Nel segmento ci sono solo silenzio (0.004), corpo parola (0.4) e
      // marcatore (0.9). Il valore 0.7 del TTS non deve comparire.
      expect(seg.filter((v) => v > 0.65 && v < 0.75)).toHaveLength(0);
    }
  });

  it('la voce sintetica che interrompe una parola non lascia il cancello aperto', () => {
    // Se il TTS parte mentre qualcuno sta parlando, i frame smettono di
    // arrivare e il cancello resterebbe bloccato in SPEECH per sempre: non
    // vedrebbe mai il silenzio che serve a chiudere.
    const c = catena();
    c.silenzio(60);
    c.parola(4); // enunciato APERTO
    expect(c.gate.state()).toBe('speech');

    c.parla();
    c.taci();
    expect(c.gate.state()).toBe('silence');

    // E il comando successivo viene riconosciuto normalmente.
    c.silenzio(20);
    c.parola();
    c.silenzio(20);
    const ultimo = c.enunciati.at(-1) as number[];
    expect(marcatori(ultimo)).toBe(1);
    // Il frammento interrotto e' stato scartato, non fuso con la parola nuova.
    expect(c.scartati).toHaveLength(1);
  });
});

describe('il provider non puo reintrodurre il difetto', () => {
  const provider = readFileSync(
    join(process.cwd(), 'src', 'voice', 'local', 'VoskVoiceProvider.ts'),
    'utf8',
  ).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');

  it('non azzera il cancello quando ROAD SENSE parla', () => {
    // `gate.reset()` riporta a zero il riferimento assoluto mentre il buffer
    // circolare prosegue: e' il disallineamento che ha rotto tutto in auto.
    expect(provider).not.toContain('gate?.reset()');
    expect(provider).not.toContain('gate.reset()');
  });

  it('sospende la cattura e chiude il decoder all inizio della voce sintetica', () => {
    expect(provider).toContain('capture?.suspend()');
    expect(provider).toContain('recognizer?.flush()');
  });

  it('un risultato che arriva durante la voce sintetica non diventa segnalazione', () => {
    // Due protezioni distinte, entrambe necessarie: una scarta i CAMPIONI
    // mentre ROAD SENSE parla (`onFrame`), l'altra scarta un RISULTATO che
    // arrivasse comunque dal decoder (`onResult`) - la coda dell'enunciato
    // chiuso da `pause()`, che altrimenti diventerebbe una segnalazione.
    const guardie = provider.split('if (this.speaking) return;').length - 1;
    expect(guardie).toBeGreaterThanOrEqual(2);
    const onResult = provider.slice(provider.indexOf('onResult(text'));
    expect(onResult.indexOf('if (this.speaking) return;')).toBeLessThan(
      onResult.indexOf('onTranscript'),
    );
  });
});
