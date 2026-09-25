import { describe, expect, it } from 'vitest';

import { RingBuffer } from './ringBuffer';
import { DEFAULT_GATE, msToSamples, SpeechGate } from './speechGate';
import { UtteranceCapture, type UtteranceSink } from './utteranceCapture';

const SR = 16_000;
const FRAME = 1024;
const PRE_ROLL_MS = 400;
/** Ampiezza del primo campione della parola: la "B" di "Buca". */
const MARKER = 0.9;
const BODY = 0.4;
const NOISE = 0.004;

function collector(): UtteranceSink & { samples: number[]; flushes: number } {
  const samples: number[] = [];
  return {
    samples,
    flushes: 0,
    feed(chunk) {
      for (const v of chunk) samples.push(v);
    },
    flush() {
      this.flushes++;
    },
  };
}

interface Rig {
  capture: UtteranceCapture;
  sink: ReturnType<typeof collector>;
  silenzio: (frames: number) => void;
  parola: (frames?: number) => void;
}

function rig(ringSeconds = 3): Rig {
  const gate = new SpeechGate({ ...DEFAULT_GATE, sampleRate: SR });
  const ring = new RingBuffer(Math.round(SR * ringSeconds));
  const sink = collector();
  const capture = new UtteranceCapture(ring, gate, sink, SR, PRE_ROLL_MS);

  const flat = (level: number): Float32Array => new Float32Array(FRAME).fill(level);

  return {
    capture,
    sink,
    silenzio(frames) {
      for (let i = 0; i < frames; i++) capture.push(flat(NOISE));
    },
    /** Una parola: il PRIMO campione e' il marcatore della prima sillaba. */
    parola(frames = 8) {
      const primo = flat(BODY);
      primo[0] = MARKER;
      capture.push(primo);
      for (let i = 1; i < frames; i++) capture.push(flat(BODY));
    },
  };
}

describe('UtteranceCapture / la prima sillaba', () => {
  it('consegna al decoder audio ANTERIORE all istante del trigger', () => {
    const r = rig();
    r.silenzio(60);
    r.parola();

    const marker = r.sink.samples.findIndex((v) => v > 0.8);
    // Il marcatore c'e': la prima sillaba non e' stata tagliata.
    expect(marker).toBeGreaterThanOrEqual(0);
    // E prima di lui c'e' il pre-roll: audio registrato quando ancora nessuno
    // sapeva che una parola fosse cominciata. E' il punto dell'esperimento.
    expect(marker).toBeGreaterThanOrEqual(msToSamples(PRE_ROLL_MS, SR));

    const stats = r.capture.stats();
    expect(stats.utterances).toBe(1);
    expect(stats.leadMs).toBeGreaterThanOrEqual(PRE_ROLL_MS);
    expect(stats.missingLeadMs).toBe(0);
  });

  it('il pre-roll include anche il tempo speso dal cancello a decidere', () => {
    const r = rig();
    r.silenzio(60);
    r.parola();
    // leadMs = pre-roll + nulla; firstChunkMs = pre-roll + sustain, quindi
    // maggiore: sono i millisecondi di voce che un riconoscitore di sistema
    // avrebbe perso mentre si apriva.
    const stats = r.capture.stats();
    expect(stats.firstChunkMs).toBeGreaterThan(stats.leadMs);
    expect(stats.firstChunkMs).toBeGreaterThanOrEqual(PRE_ROLL_MS + DEFAULT_GATE.sustainMs - 5);
  });

  it('nel silenzio non consegna NIENTE al decoder', () => {
    const r = rig();
    r.silenzio(Math.round((60 * SR) / FRAME)); // un minuto
    expect(r.sink.samples.length).toBe(0);
    expect(r.sink.flushes).toBe(0);
    expect(r.capture.stats().utterances).toBe(0);
    expect(r.capture.isCapturing()).toBe(false);
  });

  it('quattro parole di seguito senza alcun intervento fra una e l altra', () => {
    const r = rig();
    r.silenzio(60);
    for (let i = 0; i < 4; i++) {
      r.parola();
      r.silenzio(20);
    }
    expect(r.capture.stats().utterances).toBe(4);
    // Un flush per parola: nessun enunciato resta appeso nel decoder.
    expect(r.sink.flushes).toBe(4);
    // Quattro marcatori: nessuna delle quattro prime sillabe e' andata perduta.
    expect(r.sink.samples.filter((v) => v > 0.8).length).toBe(4);
  });

  it('non consegna piu volte gli stessi campioni', () => {
    const r = rig();
    r.silenzio(60);
    r.parola(12);
    r.silenzio(20);
    // Il marcatore compare una volta sola: se `nextToSend` non avanzasse, il
    // decoder riceverebbe la stessa sillaba a ogni blocco.
    expect(r.sink.samples.filter((v) => v > 0.8).length).toBe(1);
  });

  it('il flush arriva solo alla chiusura, non durante la parola', () => {
    const r = rig();
    r.silenzio(60);
    r.parola(20);
    expect(r.capture.isCapturing()).toBe(true);
    expect(r.sink.flushes).toBe(0);
    r.silenzio(20);
    expect(r.capture.isCapturing()).toBe(false);
    expect(r.sink.flushes).toBe(1);
  });

  it('consegna anche un tratto di silenzio dopo la parola', () => {
    const r = rig();
    r.silenzio(60);
    r.parola(4);
    const primaDelSilenzio = r.sink.samples.length;
    r.silenzio(20);
    // L'hangover finisce nel segmento: e' il confine che serve a Kaldi per
    // chiudere l'ipotesi invece di restare in attesa.
    expect(r.sink.samples.length).toBeGreaterThan(primaDelSilenzio);
  });

  it('dichiara il pre-roll mancante invece di consegnare una parola decapitata', () => {
    // Anello piu' corto del pre-roll richiesto: caso patologico, ma va
    // segnalato, non mascherato. E' la spia che direbbe "pre-roll troppo corto".
    const r = rig(0.2);
    // Abbondante: il cancello non puo' aprire finche' sta calibrando.
    r.silenzio(30);
    r.parola();
    expect(r.capture.stats().missingLeadMs).toBeGreaterThan(0);
  });

  it('reset azzera le misure ma non richiede di riaprire nulla', () => {
    const r = rig();
    r.silenzio(60);
    r.parola();
    r.silenzio(20);
    r.capture.reset();
    expect(r.capture.stats().utterances).toBe(0);
    expect(r.capture.isCapturing()).toBe(false);
  });
});
