/**
 * ROAD SENSE - tipi minimi dell'ambiente Cloudflare.
 *
 * Dichiarati a mano invece di installare `@cloudflare/workers-types`:
 * servono cinque interfacce, non un pacchetto di dipendenze.
 */

export interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta?: { changes?: number; duration?: number };
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

export interface Env {
  /** Database D1 degli eventi (binding definito in wrangler.toml). */
  DB: D1Database;
  /**
   * Origine autorizzata a chiamare le API (es. https://roadsense.pezzalihub.app).
   * Se assente, le richieste cross-origin non ricevono header CORS.
   */
  ALLOWED_ORIGIN?: string;
  /**
   * Sale per il rate limiting (secret, MAI committato).
   * Se assente il rate limiting ricade sul solo identificatore anonimo.
   */
  RATE_SALT?: string;
}
