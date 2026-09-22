/**
 * ROAD SENSE - backend collaborativo (Cloudflare Worker + D1).
 *
 * PERCHE' ESISTE
 * Perche' l'auto B venga avvisata della buca rilevata dall'auto A serve un
 * punto di incontro. E' l'unico compito di questo Worker.
 *
 * COSA CONTIENE IL DATABASE
 * Solo eventi stradali: coordinate, istante, categoria, severita', direzione,
 * identificatore anonimo a rotazione del segnalatore. Nessun utente, nessuna
 * traccia, nessun indirizzo IP, nessuna cronologia di viaggio.
 *
 * PERCHE' RESTA A COSTO ZERO
 * - Cloudflare Workers, piano gratuito: 100.000 richieste al giorno.
 * - Cloudflare D1, piano gratuito: 5 GB, 5 milioni di righe lette al giorno,
 *   100.000 righe scritte al giorno.
 * - Nessun servizio a consumo, nessuna API di terzi, nessun binding a pagamento.
 * Il client sincronizza al massimo ogni 90 secondi e invia solo eventi, quindi
 * il traffico resta ordini di grandezza sotto le soglie gratuite.
 * IMPORTANTE: non abilitare alcun piano a pagamento. Se le quote gratuite
 * vengono esaurite Cloudflare limita il servizio, NON addebita.
 *
 * NON SI FIDA DEL CLIENT
 * Ogni campo viene rivalidato con lo stesso modulo usato dal frontend
 * (src/core/validation.ts), il payload e' limitato, il rate limiting e' attivo.
 */

import { TTL_MS } from '../../src/config/config';
import { LIMITS, validateEvent, validateQuery } from '../../src/core/validation';
import { distanceM } from '../../src/core/geo';
import type { EventType, RoadEvent } from '../../src/core/types';
import type { D1Database, Env, ExecutionContext } from './env';

// Limiti di rate, per finestra di 60 secondi.
const RATE = {
  windowMs: 60_000,
  postEvents: 30, // eventi inviati
  getQueries: 60, // interrogazioni
  votes: 40,
} as const;

/** Raggio massimo restituito da una query, in metri. */
const MAX_RESULTS = 300;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return preflight(request, env);

    try {
      if (path === '/health' && request.method === 'GET') {
        return json({ ok: true, service: 'roadsense', version: '0.1.0' }, 200, request, env);
      }

      if (path === '/events' && request.method === 'GET') {
        return await handleList(request, env, url, ctx);
      }

      if (path === '/events' && request.method === 'POST') {
        return await handlePost(request, env, ctx);
      }

      const voteMatch = /^\/events\/([0-9a-f-]{36})\/(confirm|gone)$/i.exec(path);
      if (voteMatch && request.method === 'POST') {
        return await handleVote(request, env, voteMatch[1] as string, voteMatch[2] === 'confirm' ? 1 : -1);
      }

      return json({ error: 'not found' }, 404, request, env);
    } catch {
      // Nessun dettaglio interno verso l'esterno.
      return json({ error: 'internal error' }, 500, request, env);
    }
  },
};

// ---------------------------------------------------------------------------
// GET /events?lat&lon&radius
// ---------------------------------------------------------------------------

async function handleList(
  request: Request,
  env: Env,
  url: URL,
  ctx: ExecutionContext,
): Promise<Response> {
  const parsed = validateQuery(
    url.searchParams.get('lat'),
    url.searchParams.get('lon'),
    url.searchParams.get('radius'),
  );
  if (!parsed.ok) return json({ error: parsed.error }, 400, request, env);

  const limited = await rateLimit(env, request, 'q', RATE.getQueries);
  if (!limited.allowed) return tooMany(request, env, limited.retryAfterSec);

  const { lat, lon, radiusM } = parsed.value;
  const now = Date.now();

  // Riquadro geografico: filtro grossolano su indice, poi distanza esatta.
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)));

  const rows = await env.DB.prepare(
    `SELECT id, lat, lon, ts, type, severity, source, confidence, heading, reporter_id,
            peak_accel, impulse_ms, speed_mps, baseline_rms, confirms, denials
       FROM events
      WHERE expires_at > ?
        AND lat BETWEEN ? AND ?
        AND lon BETWEEN ? AND ?
      ORDER BY ts DESC
      LIMIT ?`,
  )
    .bind(now, lat - dLat, lat + dLat, lon - dLon, lon + dLon, MAX_RESULTS)
    .all<EventRow>();

  const events: RoadEvent[] = [];
  for (const row of rows.results ?? []) {
    if (distanceM({ lat, lon }, { lat: row.lat, lon: row.lon }) > radiusM) continue;
    // Un evento smentito piu' volte di quante sia stato confermato sparisce.
    if (row.denials >= 2 && row.denials > row.confirms) continue;
    events.push(rowToEvent(row));
  }

  // La pulizia viene fatta in coda alla risposta: non rallenta il client.
  ctx.waitUntil(purge(env.DB, now));

  return json({ events }, 200, request, env);
}

// ---------------------------------------------------------------------------
// POST /events
// ---------------------------------------------------------------------------

async function handlePost(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const body = await readLimitedJson(request);
  if (!body.ok) return json({ error: body.error }, body.status, request, env);

  const payload = body.value as { events?: unknown };
  const list = Array.isArray(payload.events) ? payload.events : null;
  if (!list) return json({ error: 'campo events mancante' }, 400, request, env);
  if (list.length === 0) return json({ accepted: 0, rejected: 0 }, 200, request, env);
  if (list.length > LIMITS.maxBatchEvents) {
    return json({ error: 'troppi eventi in una sola richiesta' }, 413, request, env);
  }

  const limited = await rateLimit(env, request, 'p', RATE.postEvents);
  if (!limited.allowed) return tooMany(request, env, limited.retryAfterSec);

  const now = Date.now();
  const valid: RoadEvent[] = [];
  let rejected = 0;

  for (const raw of list) {
    const result = validateEvent(raw, now);
    if (result.ok) valid.push(result.value);
    else rejected++;
  }

  if (valid.length > 0) {
    const statements = valid.map((e) =>
      env.DB.prepare(
        `INSERT OR IGNORE INTO events
           (id, lat, lon, ts, type, severity, source, confidence, heading, reporter_id,
            peak_accel, impulse_ms, speed_mps, baseline_rms, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        e.id,
        e.lat,
        e.lon,
        e.ts,
        e.type,
        e.severity,
        e.source,
        e.confidence,
        e.heading,
        e.reporterId,
        e.sensorData?.peakVerticalAccel ?? null,
        e.sensorData?.impulseMs ?? null,
        e.sensorData?.speedMps ?? null,
        e.sensorData?.baselineRms ?? null,
        e.ts + ttlFor(e.type),
      ),
    );
    await env.DB.batch(statements);
  }

  ctx.waitUntil(purge(env.DB, now));

  return json({ accepted: valid.length, rejected }, 200, request, env);
}

// ---------------------------------------------------------------------------
// POST /events/:id/confirm | /gone
// ---------------------------------------------------------------------------

async function handleVote(request: Request, env: Env, eventId: string, vote: 1 | -1): Promise<Response> {
  const body = await readLimitedJson(request);
  if (!body.ok) return json({ error: body.error }, body.status, request, env);

  const reporterId = (body.value as { reporterId?: unknown }).reporterId;
  if (typeof reporterId !== 'string' || !/^[0-9a-f]{16}$/.test(reporterId)) {
    return json({ error: 'reporterId non valido' }, 400, request, env);
  }

  const limited = await rateLimit(env, request, 'v', RATE.votes);
  if (!limited.allowed) return tooMany(request, env, limited.retryAfterSec);

  const now = Date.now();

  // Un segnalatore, un voto: il vincolo di chiave primaria fa il lavoro.
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO event_votes (event_id, reporter_id, vote, ts) VALUES (?, ?, ?, ?)`,
  )
    .bind(eventId.toLowerCase(), reporterId.toLowerCase(), vote, now)
    .run();

  if ((inserted.meta?.changes ?? 0) === 0) {
    return json({ ok: true, counted: false }, 200, request, env);
  }

  const column = vote === 1 ? 'confirms' : 'denials';
  await env.DB.prepare(`UPDATE events SET ${column} = ${column} + 1 WHERE id = ?`)
    .bind(eventId.toLowerCase())
    .run();

  // Una conferma prolunga la vita dell'evento: qualcuno l'ha appena rivisto.
  if (vote === 1) {
    await env.DB.prepare(
      `UPDATE events SET expires_at = MAX(expires_at, ?) WHERE id = ? AND expires_at > ?`,
    )
      .bind(now + 6 * 60 * 60 * 1000, eventId.toLowerCase(), now)
      .run();
  }

  return json({ ok: true, counted: true }, 200, request, env);
}

// ---------------------------------------------------------------------------
// utilita'
// ---------------------------------------------------------------------------

interface EventRow {
  id: string;
  lat: number;
  lon: number;
  ts: number;
  type: string;
  severity: number;
  source: string;
  confidence: number;
  heading: number | null;
  reporter_id: string;
  peak_accel: number | null;
  impulse_ms: number | null;
  speed_mps: number | null;
  baseline_rms: number | null;
  confirms: number;
  denials: number;
}

function rowToEvent(row: EventRow): RoadEvent {
  const sensorData: RoadEvent['sensorData'] = {};
  if (row.peak_accel !== null) sensorData.peakVerticalAccel = row.peak_accel;
  if (row.impulse_ms !== null) sensorData.impulseMs = row.impulse_ms;
  if (row.speed_mps !== null) sensorData.speedMps = row.speed_mps;
  if (row.baseline_rms !== null) sensorData.baselineRms = row.baseline_rms;

  const event: RoadEvent = {
    id: row.id,
    lat: row.lat,
    lon: row.lon,
    ts: row.ts,
    type: row.type as EventType,
    severity: row.severity as RoadEvent['severity'],
    source: row.source as RoadEvent['source'],
    confidence: row.confidence,
    heading: row.heading,
    reporterId: row.reporter_id,
  };
  if (Object.keys(sensorData).length > 0) event.sensorData = sensorData;
  return event;
}

function ttlFor(type: EventType): number {
  return TTL_MS[type];
}

/** Legge il corpo JSON applicando il limite di dimensione. */
async function readLimitedJson(
  request: Request,
): Promise<{ ok: true; value: unknown } | { ok: false; error: string; status: number }> {
  const declared = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > LIMITS.maxPayloadBytes) {
    return { ok: false, error: 'payload troppo grande', status: 413 };
  }
  const text = await request.text();
  if (text.length > LIMITS.maxPayloadBytes) {
    return { ok: false, error: 'payload troppo grande', status: 413 };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, error: 'JSON non valido', status: 400 };
  }
}

/**
 * Rate limiting su D1.
 *
 * La chiave NON e' l'indirizzo IP: e' SHA-256(ip + sale segreto + giorno),
 * troncato a 16 caratteri. Non e' reversibile, non e' correlabile tra giorni
 * diversi e le righe vengono cancellate di continuo. Se il sale non e'
 * configurato si ricade sul solo identificatore anonimo del client, meno
 * efficace ma mai peggiore dal punto di vista della privacy.
 */
async function rateLimit(
  env: Env,
  request: Request,
  scope: string,
  limit: number,
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  const now = Date.now();
  const window = Math.floor(now / RATE.windowMs);
  const subject = await rateSubject(env, request);
  const key = `${scope}:${window}:${subject}`;
  const expiresAt = (window + 1) * RATE.windowMs;

  await env.DB.prepare(
    `INSERT INTO rate_buckets (bucket_key, count, expires_at) VALUES (?, 1, ?)
       ON CONFLICT(bucket_key) DO UPDATE SET count = count + 1`,
  )
    .bind(key, expiresAt)
    .run();

  const row = await env.DB.prepare(`SELECT count FROM rate_buckets WHERE bucket_key = ?`)
    .bind(key)
    .first<{ count: number }>();

  const count = row?.count ?? 1;
  return {
    allowed: count <= limit,
    retryAfterSec: Math.max(1, Math.ceil((expiresAt - now) / 1000)),
  };
}

async function rateSubject(env: Env, request: Request): Promise<string> {
  const ip = request.headers.get('cf-connecting-ip');
  if (ip && env.RATE_SALT) {
    const day = new Date().toISOString().slice(0, 10);
    return await sha256Hex(`${ip}|${env.RATE_SALT}|${day}`, 16);
  }
  // Fallback: nessun sale configurato, si usa una chiave comune.
  return 'anon';
}

async function sha256Hex(input: string, length: number): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, length);
}

/** Elimina eventi scaduti, voti orfani e contatori esauriti. */
async function purge(db: D1Database, now: number): Promise<void> {
  try {
    await db.batch([
      db.prepare(`DELETE FROM rate_buckets WHERE expires_at < ?`).bind(now),
      db.prepare(`DELETE FROM events WHERE expires_at < ?`).bind(now),
      db.prepare(`DELETE FROM event_votes WHERE event_id NOT IN (SELECT id FROM events)`),
    ]);
  } catch {
    // La pulizia e' opportunistica: un errore qui non deve influenzare il client.
  }
}

// -- risposte ---------------------------------------------------------------

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('origin');
  if (!origin || !env.ALLOWED_ORIGIN || origin !== env.ALLOWED_ORIGIN) return {};
  return {
    'access-control-allow-origin': env.ALLOWED_ORIGIN,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

function preflight(request: Request, env: Env): Response {
  return new Response(null, { status: 204, headers: corsHeaders(request, env) });
}

function json(body: unknown, status: number, request: Request, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...corsHeaders(request, env),
    },
  });
}

function tooMany(request: Request, env: Env, retryAfterSec: number): Response {
  const res = json({ error: 'troppe richieste' }, 429, request, env);
  res.headers.set('retry-after', String(retryAfterSec));
  return res;
}
