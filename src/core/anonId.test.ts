import { beforeEach, describe, expect, it } from 'vitest';
import { PRIVACY } from '../config/config';
import { getAnonId, newEventId, resetAnonId } from './anonId';
import { installMemoryStorage } from './testUtils';

const storage = installMemoryStorage();

describe('identificatore anonimo', () => {
  beforeEach(() => {
    storage.clear();
    resetAnonId();
  });

  it('ha il formato atteso (16 esadecimali)', () => {
    expect(getAnonId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('resta stabile entro il periodo di rotazione', () => {
    const t0 = Date.now();
    const a = getAnonId(t0);
    const b = getAnonId(t0 + PRIVACY.anonIdRotationMs - 1000);
    expect(b).toBe(a);
  });

  it('ruota dopo il periodo previsto', () => {
    const t0 = Date.now();
    const a = getAnonId(t0);
    const b = getAnonId(t0 + PRIVACY.anonIdRotationMs + 1000);
    expect(b).not.toBe(a);
  });

  it('resetAnonId genera un identificatore diverso', () => {
    const a = getAnonId();
    expect(resetAnonId()).not.toBe(a);
  });

  it('produce identificatori distinti su piu\' generazioni', () => {
    const ids = new Set(Array.from({ length: 200 }, () => resetAnonId()));
    expect(ids.size).toBe(200);
  });
});

describe('newEventId', () => {
  it('produce UUID v4 validi e unici', () => {
    const ids = Array.from({ length: 500 }, () => newEventId());
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    }
    expect(new Set(ids).size).toBe(500);
  });
});
