/**
 * ROAD SENSE - utilita' condivise dai test.
 * Un localStorage minimale in memoria: i test girano in ambiente Node, dove
 * l'API del browser non esiste.
 */

export function installMemoryStorage(): { clear: () => void; fail: (on: boolean) => void } {
  const data = new Map<string, string>();
  let shouldFail = false;

  const storage = {
    getItem(key: string): string | null {
      if (shouldFail) throw new Error('storage non disponibile');
      return data.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      if (shouldFail) throw new Error('quota superata');
      data.set(key, value);
    },
    removeItem(key: string): void {
      data.delete(key);
    },
    clear(): void {
      data.clear();
    },
    key(index: number): string | null {
      return Array.from(data.keys())[index] ?? null;
    },
    get length(): number {
      return data.size;
    },
  };

  (globalThis as unknown as { localStorage: unknown }).localStorage = storage;

  return {
    clear: () => data.clear(),
    fail: (on: boolean) => {
      shouldFail = on;
    },
  };
}
