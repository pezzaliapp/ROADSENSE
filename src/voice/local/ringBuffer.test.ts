import { describe, expect, it } from 'vitest';

import { RingBuffer } from './ringBuffer';

const chunk = (from: number, count: number): Float32Array =>
  Float32Array.from({ length: count }, (_, i) => from + i);

describe('RingBuffer / laboratorio Fase 0', () => {
  it('rifiuta una capacita non valida', () => {
    expect(() => new RingBuffer(0)).toThrow();
    expect(() => new RingBuffer(-8)).toThrow();
    expect(() => new RingBuffer(1.5)).toThrow();
  });

  it('legge per indice assoluto, non per posizione nell anello', () => {
    const ring = new RingBuffer(100);
    ring.write(chunk(0, 30));
    expect(ring.start).toBe(0);
    expect(ring.end).toBe(30);
    expect(Array.from(ring.readFrom(10, 5))).toEqual([10, 11, 12, 13, 14]);
  });

  it('conserva i campioni attraverso la giunzione dell anello', () => {
    const ring = new RingBuffer(16);
    // Due scritture che scavalcano la fine dell'array: e' il caso in cui un
    // buffer scritto male restituisce audio incollato al contrario.
    ring.write(chunk(0, 12));
    ring.write(chunk(12, 10));
    expect(ring.start).toBe(6);
    expect(ring.end).toBe(22);
    expect(Array.from(ring.readFrom(6, 16))).toEqual([
      6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
    ]);
  });

  it('restituisce meno del richiesto quando il passato e gia stato sovrascritto', () => {
    const ring = new RingBuffer(8);
    ring.write(chunk(0, 20));
    // Chiedere dall'indice 0 non deve inventare nulla: l'anello tiene 8 campioni.
    const letto = ring.readFrom(0, 20);
    expect(letto.length).toBe(8);
    expect(Array.from(letto)).toEqual([12, 13, 14, 15, 16, 17, 18, 19]);
  });

  it('con un blocco piu lungo dell anello conserva la coda, non la testa', () => {
    // La coda e' l'audio piu' recente: e' quello che serve.
    const ring = new RingBuffer(4);
    ring.write(chunk(0, 10));
    expect(ring.end).toBe(10);
    expect(Array.from(ring.readFrom(6, 4))).toEqual([6, 7, 8, 9]);
  });

  it('non legge oltre cio che e stato scritto', () => {
    const ring = new RingBuffer(50);
    ring.write(chunk(0, 10));
    expect(ring.readFrom(8, 20).length).toBe(2);
    expect(ring.readFrom(10, 5).length).toBe(0);
    expect(ring.readFrom(999, 5).length).toBe(0);
  });

  it('reset riporta anche il riferimento assoluto a zero', () => {
    const ring = new RingBuffer(10);
    ring.write(chunk(0, 25));
    ring.reset();
    expect(ring.end).toBe(0);
    expect(ring.start).toBe(0);
    expect(ring.readFrom(0, 10).length).toBe(0);
  });
});
