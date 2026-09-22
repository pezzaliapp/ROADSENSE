import { describe, expect, it } from 'vitest';
import { LIMITS, validateEvent, validateQuery } from './validation';

const NOW = 1_700_000_000_000;

function raw(overrides: Record<string, unknown> = {}) {
  return {
    id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
    lat: 45.4642,
    lon: 9.19,
    ts: NOW - 1000,
    type: 'pothole',
    severity: 2,
    source: 'auto',
    confidence: 0.45,
    heading: 90,
    reporterId: 'a1b2c3d4e5f60718',
    ...overrides,
  };
}

describe('validateEvent', () => {
  it('accetta un evento ben formato', () => {
    const r = validateEvent(raw(), NOW);
    expect(r.ok).toBe(true);
  });

  it('rifiuta coordinate fuori range', () => {
    expect(validateEvent(raw({ lat: 91 }), NOW).ok).toBe(false);
    expect(validateEvent(raw({ lon: -181 }), NOW).ok).toBe(false);
  });

  it('rifiuta coordinate non numeriche', () => {
    expect(validateEvent(raw({ lat: '45.4' }), NOW).ok).toBe(false);
    expect(validateEvent(raw({ lat: NaN }), NOW).ok).toBe(false);
  });

  it('rifiuta un tipo sconosciuto', () => {
    expect(validateEvent(raw({ type: 'alieni' }), NOW).ok).toBe(false);
  });

  it('rifiuta severita\' e confidenza fuori range', () => {
    expect(validateEvent(raw({ severity: 0 }), NOW).ok).toBe(false);
    expect(validateEvent(raw({ severity: 4 }), NOW).ok).toBe(false);
    expect(validateEvent(raw({ confidence: 1.5 }), NOW).ok).toBe(false);
  });

  it('rifiuta un timestamp nel futuro', () => {
    expect(validateEvent(raw({ ts: NOW + 60 * 60 * 1000 }), NOW).ok).toBe(false);
  });

  it('rifiuta un timestamp troppo vecchio per un invio dal client', () => {
    expect(validateEvent(raw({ ts: NOW - LIMITS.maxPastMs - 1000 }), NOW).ok).toBe(false);
  });

  it('accetta un timestamp vecchio quando arriva dal backend', () => {
    const r = validateEvent(raw({ ts: NOW - 30 * 24 * 3600 * 1000 }), NOW, {
      maxPastMs: Number.POSITIVE_INFINITY,
    });
    expect(r.ok).toBe(true);
  });

  it('rifiuta un reporterId malformato', () => {
    expect(validateEvent(raw({ reporterId: 'pippo' }), NOW).ok).toBe(false);
    expect(validateEvent(raw({ reporterId: 'A1B2C3D4E5F6071' }), NOW).ok).toBe(false);
  });

  it('rifiuta gli eventi di DEMO MODE', () => {
    expect(validateEvent(raw({ demo: true }), NOW).ok).toBe(false);
  });

  it('scarta i campi non previsti', () => {
    const r = validateEvent(raw({ email: 'x@y.z', plate: 'AB123CD', track: [1, 2, 3] }), NOW);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).not.toHaveProperty('email');
      expect(r.value).not.toHaveProperty('plate');
      expect(r.value).not.toHaveProperty('track');
    }
  });

  it('arrotonda le coordinate a 5 decimali', () => {
    const r = validateEvent(raw({ lat: 45.123456789 }), NOW);
    expect(r.ok && r.value.lat).toBe(45.12346);
  });

  it('accetta heading nullo e rifiuta heading fuori range', () => {
    expect(validateEvent(raw({ heading: null }), NOW).ok).toBe(true);
    expect(validateEvent(raw({ heading: 360 }), NOW).ok).toBe(false);
    expect(validateEvent(raw({ heading: -1 }), NOW).ok).toBe(false);
  });

  it('limita i valori dei dati sensore', () => {
    const r = validateEvent(
      raw({ sensorData: { peakVerticalAccel: 99999, speedMps: -5, nonEsiste: 'x' } }),
      NOW,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.sensorData?.peakVerticalAccel).toBe(200);
      expect(r.value.sensorData?.speedMps).toBe(0);
      expect(r.value.sensorData).not.toHaveProperty('nonEsiste');
    }
  });

  it('rifiuta payload non oggetto', () => {
    expect(validateEvent(null, NOW).ok).toBe(false);
    expect(validateEvent('stringa', NOW).ok).toBe(false);
    expect(validateEvent(42, NOW).ok).toBe(false);
  });
});

describe('validateQuery', () => {
  it('accetta parametri validi come stringhe', () => {
    const r = validateQuery('45.46', '9.19', '3000');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.radiusM).toBe(3000);
  });

  it('limita il raggio massimo', () => {
    const r = validateQuery(45, 9, 999_999);
    expect(r.ok && r.value.radiusM).toBe(LIMITS.maxQueryRadiusM);
  });

  it('usa un raggio predefinito se assente', () => {
    const r = validateQuery(45, 9, null);
    expect(r.ok && r.value.radiusM).toBe(5000);
  });

  it('rifiuta coordinate non valide', () => {
    expect(validateQuery('abc', 9, 1000).ok).toBe(false);
    expect(validateQuery(95, 9, 1000).ok).toBe(false);
  });
});
