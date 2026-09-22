/**
 * ROAD SENSE - identificatore anonimo a rotazione.
 *
 * PERCHE' ESISTE
 * Per calcolare la confidenza serve sapere se due rilevamenti vengono da due
 * dispositivi diversi o dallo stesso dispositivo che ripassa. Serve quindi un
 * identificatore, ma NON deve identificare la persona.
 *
 * COME FUNZIONA
 * - 16 caratteri esadecimali casuali generati con crypto.getRandomValues();
 * - nessun legame con hardware, account, IP, IMEI, numero o email;
 * - ruota automaticamente ogni PRIVACY.anonIdRotationMs (12 ore), quindi non
 *   consente di seguire un dispositivo nel tempo;
 * - e' memorizzato solo sul dispositivo;
 * - puo' essere azzerato in qualsiasi momento (resetAnonId).
 *
 * CONSEGUENZA ACCETTATA: dopo una rotazione lo stesso dispositivo appare come
 * un nuovo segnalatore. E' un compromesso voluto a favore della privacy.
 */

import { PRIVACY, STORAGE } from '../config/config';

interface StoredAnonId {
  id: string;
  createdAt: number;
}

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

function readStorage(): StoredAnonId | null {
  try {
    const raw = localStorage.getItem(STORAGE.anonIdKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAnonId>;
    if (typeof parsed.id !== 'string' || !/^[0-9a-f]{16}$/.test(parsed.id)) return null;
    if (typeof parsed.createdAt !== 'number') return null;
    return { id: parsed.id, createdAt: parsed.createdAt };
  } catch {
    return null;
  }
}

function writeStorage(value: StoredAnonId): void {
  try {
    localStorage.setItem(STORAGE.anonIdKey, JSON.stringify(value));
  } catch {
    // Storage non disponibile (modalita' privata): si prosegue in memoria.
  }
}

let cached: StoredAnonId | null = null;

/** Ritorna l'identificatore anonimo corrente, ruotandolo se scaduto. */
export function getAnonId(now: number = Date.now()): string {
  if (!cached) cached = readStorage();
  if (!cached || now - cached.createdAt > PRIVACY.anonIdRotationMs) {
    cached = { id: randomHex(8), createdAt: now };
    writeStorage(cached);
  }
  return cached.id;
}

/** Forza la generazione di un nuovo identificatore. */
export function resetAnonId(now: number = Date.now()): string {
  cached = { id: randomHex(8), createdAt: now };
  writeStorage(cached);
  return cached.id;
}

/** UUID v4 per gli eventi. Fallback manuale se crypto.randomUUID manca. */
export function newEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const h = randomHex(16).split('');
  h[12] = '4';
  h[16] = ((parseInt(h[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}
