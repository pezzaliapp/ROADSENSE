/**
 * ROAD SENSE / LABORATORIO FASE 0 - controller della pagina diagnostica.
 *
 * NON FA PARTE DELL'APPLICAZIONE, e non la conosce. Nessun import da
 * `src/core`, `src/hazard`, `src/net`, `src/ui`, `src/voice`, `src/sensors`,
 * `src/map`. Non esiste alcun percorso da questo file a `report()`, a
 * EventStore, a DetectionEngine, ConfidenceEngine, AlertEngine,
 * ForwardCorridor, mapRoads, NOWCAST, GPS, sensori, mappa o backend.
 *
 * Fa una cosa: apre il microfono una volta, tiene in memoria gli ultimi
 * secondi, riconosce localmente quattro parole, e mostra i numeri che servono a
 * decidere se questa strada regge su un telefono reale.
 *
 * COSA GUARDARE, IN ORDINE DI IMPORTANZA
 *
 *   1. APERTURE MICROFONO deve restare 1 per tutto il test. Se cresce, esiste
 *      da qualche parte un ciclo e l'esperimento non vale niente.
 *   2. Zero toni di sistema. Non c'e' codice che possa emetterne, ma l'orecchio
 *      e' il giudice.
 *   3. PRIMA SILLABA deve essere un numero di millisecondi maggiore di zero:
 *      e' l'audio che il decoder ha ricevuto PRIMA che si sapesse che qualcuno
 *      stava parlando.
 *   4. Dire "Buca", poi "Ostacolo", poi "Acqua", poi "Incidente" senza toccare
 *      piu' niente.
 *   5. Venti minuti senza che il microfono cada.
 */

import { MicSession } from './micSession';
import { RingBuffer } from './ringBuffer';
import { DEFAULT_GATE, SpeechGate, type SpeechGateConfig } from './speechGate';
import { UtteranceCapture } from './utteranceCapture';
import { LAB_GRAMMAR, LocalRecognizer, type LabResult } from './voskRecognizer';

/** Secondi di audio conservati. Tre bastano: un enunciato dura meno di due. */
const RING_SECONDS = 3;
/**
 * Audio consegnato prima dell'istante in cui la voce e' salita, ms.
 *
 * 400 ms sono generosi di proposito: la consonante iniziale di "Buca" dura
 * qualche decina di millisecondi, ma si paga solo in silenzio consegnato al
 * decoder, che e' gratis. Consegnarne troppo poco costerebbe la sillaba.
 */
const PRE_ROLL_MS = 400;
/** Cadenza di aggiornamento dei numeri sullo schermo, ms. */
const UI_MS = 120;

const el = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`elemento mancante: ${id}`);
  return node as T;
};

const ui = {
  modelFile: el<HTMLInputElement>('modelFile'),
  modelUrl: el<HTMLInputElement>('modelUrl'),
  modelHint: el('modelHint'),
  start: el<HTMLButtonElement>('start'),
  stop: el<HTMLButtonElement>('stop'),
  lastText: el('lastText'),
  lastConf: el('lastConf'),
  partial: el('partial'),
  latency: el('latency'),
  words: el<HTMLTableElement>('words'),
  mic: el('mic'),
  ctx: el('ctx'),
  rate: el('rate'),
  model: el('model'),
  gate: el('gate'),
  level: el('level'),
  floor: el('floor'),
  bar: el('bar'),
  mark: el('mark'),
  commands: el('commands'),
  rejected: el('rejected'),
  utterances: el('utterances'),
  forced: el('forced'),
  openings: el('openings'),
  lead: el('lead'),
  missing: el('missing'),
  uptime: el('uptime'),
  memory: el('memory'),
  log: el<HTMLUListElement>('log'),
};

const mic = new MicSession();
const recognizer = new LocalRecognizer();
let gate: SpeechGate | null = null;
let capture: UtteranceCapture | null = null;
let uiTimer: number | null = null;
let objectUrl: string | null = null;
let sampleRate = DEFAULT_GATE.sampleRate;
let commands = 0;
let rejected = 0;
let utteranceEndedAt: number | null = null;
let lastLatencyMs: number | null = null;

ui.modelUrl.value = '/lab/model/vosk-model-small-it-0.22.tar.gz';
ui.modelHint.textContent =
  'Modello: vosk-model-small-it-0.22 (Apache-2.0, ~48 MB). Il file non e’ nel repository: ' +
  'scaricalo una volta sul telefono e scegli il file, oppure indica un URL della stessa origine. ' +
  'Il download riguarda il modello, non la voce: nessun audio lascia il dispositivo.';

log('Pagina pronta. Nessun microfono aperto.');
log(`Grammatica: ${LAB_GRAMMAR.join(' / ')}`);

// ---------------------------------------------------------------------------
// START / STOP
// ---------------------------------------------------------------------------

ui.start.addEventListener('click', () => {
  // Nessun `await` prima di `getUserMedia`: su Android il permesso viene
  // concesso solo dentro l'attivazione del tocco, e un'attesa interposta la
  // farebbe decadere. E' l'unica lezione della vecchia implementazione che
  // vale ancora, ed e' costata diversi test sul campo.
  void startTest();
});

ui.stop.addEventListener('click', () => {
  void stopTest();
});

async function startTest(): Promise<void> {
  if (mic.isOpen()) return;
  ui.start.disabled = true;
  commands = 0;
  rejected = 0;
  lastLatencyMs = null;
  utteranceEndedAt = null;
  setText(ui.lastText, '—');
  setText(ui.lastConf, '—');
  ui.words.hidden = true;

  const source = modelSource();
  if (!source) {
    log('Nessun modello indicato: scegli il file o inserisci un URL.', 'bad');
    ui.start.disabled = false;
    return;
  }

  let info;
  try {
    info = await mic.open({
      onFrame: (frame) => capture?.push(frame),
      onContextState: (state) => {
        setText(ui.ctx, state.toUpperCase());
        log(`AudioContext: ${state}`, state === 'running' ? 'ok' : 'warn');
      },
      onTrackMuted: (muted) => {
        log(
          muted
            ? 'Microfono sottratto dal sistema (telefonata?). Nessun campione in arrivo.'
            : 'Microfono restituito dal sistema.',
          muted ? 'warn' : 'ok',
        );
      },
      onEnded: () => log('La traccia audio e’ terminata dal sistema.', 'bad'),
    });
  } catch (error) {
    log(`Microfono negato o non disponibile: ${message(error)}`, 'bad');
    ui.start.disabled = false;
    return;
  }

  sampleRate = info.sampleRate;
  setText(ui.mic, 'ON', 'ok');
  setText(ui.ctx, info.contextState.toUpperCase());
  setText(ui.rate, `${info.sampleRate} Hz`);
  log(`Microfono aperto: ${info.trackLabel}`, 'ok');
  log(`Frequenza reale del contesto: ${info.sampleRate} Hz`);
  log(`Vincoli concessi: ${JSON.stringify(info.settings)}`);

  const config: SpeechGateConfig = { ...DEFAULT_GATE, sampleRate: info.sampleRate };
  gate = new SpeechGate(config);
  const ring = new RingBuffer(Math.round(info.sampleRate * RING_SECONDS));
  capture = new UtteranceCapture(
    ring,
    gate,
    {
      feed: (samples) => recognizer.feed(samples, sampleRate),
      flush: () => {
        utteranceEndedAt = performance.now();
        recognizer.flush();
      },
    },
    info.sampleRate,
    PRE_ROLL_MS,
  );

  ui.stop.disabled = false;
  startUiLoop();

  // Il modello si carica DOPO l'apertura del microfono, perche' il microfono
  // deve stare nel gesto e il caricamento dura secondi. Nel frattempo il
  // cancello gia' lavora: si vede il livello muoversi anche a modello assente.
  setText(ui.model, 'CARICAMENTO…', 'warn');
  log('Caricamento del modello in corso. Puo’ richiedere un minuto.');
  try {
    await recognizer.load(source, info.sampleRate, {
      onResult: handleResult,
      onPartial: (text) => setText(ui.partial, text || '—'),
      onError: (error) => log(`Decoder: ${error}`, 'bad'),
    });
    setText(ui.model, 'PRONTO', 'ok');
    log(`Modello pronto in ${(recognizer.loadMs() / 1000).toFixed(1)} s. Parla.`, 'ok');
  } catch (error) {
    setText(ui.model, 'ERRORE', 'bad');
    log(`Modello non caricato: ${message(error)}`, 'bad');
    log(
      'Se il messaggio parla di CSP o di rete: in produzione `connect-src` consente solo la ' +
        'stessa origine. Vedi la relazione: e’ una decisione, non un difetto.',
      'warn',
    );
  }
}

async function stopTest(): Promise<void> {
  ui.stop.disabled = true;
  stopUiLoop();
  await mic.close();
  recognizer.release();
  capture?.reset();
  gate?.reset();
  capture = null;
  gate = null;
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  setText(ui.mic, 'OFF', 'bad');
  setText(ui.ctx, 'CHIUSO');
  setText(ui.gate, '—');
  setText(ui.model, 'ASSENTE');
  setText(ui.level, '—');
  setText(ui.floor, '—');
  ui.bar.style.width = '0';
  ui.start.disabled = false;
  log('STOP: microfono, contesto, worker, timer e buffer rilasciati.', 'ok');
  log("Controlla l'indicatore microfono del sistema: deve essere spento.", 'warn');
}

function modelSource(): string | null {
  const file = ui.modelFile.files?.[0];
  if (file) {
    objectUrl = URL.createObjectURL(file);
    log(`Modello dal dispositivo: ${file.name} (${(file.size / 1048576).toFixed(1)} MB)`);
    return objectUrl;
  }
  const url = ui.modelUrl.value.trim();
  if (url.length === 0) return null;
  log(`Modello da URL: ${url}`);
  return url;
}

// ---------------------------------------------------------------------------
// RISULTATI
// ---------------------------------------------------------------------------

function handleResult(result: LabResult): void {
  if (utteranceEndedAt !== null) {
    lastLatencyMs = Math.round(performance.now() - utteranceEndedAt);
    utteranceEndedAt = null;
  }
  setText(ui.partial, '—');

  const pulito = result.text.replace(/\[unk\]/g, '').replace(/\s+/g, ' ').trim();
  const riconosciuto = pulito.length > 0;

  if (riconosciuto) {
    commands++;
    setText(ui.lastText, pulito, 'ok');
  } else {
    rejected++;
    setText(ui.lastText, 'SCARTATO', 'warn');
  }

  setText(
    ui.lastConf,
    result.confidence === null ? '—' : result.confidence.toFixed(2),
    result.confidence !== null && result.confidence < 0.6 ? 'warn' : undefined,
  );
  setText(ui.latency, lastLatencyMs === null ? '—' : `${lastLatencyMs} ms`);

  const body = ui.words.querySelector('tbody');
  if (body) {
    body.innerHTML = '';
    for (const w of result.words) {
      const tr = document.createElement('tr');
      for (const value of [w.word, w.conf.toFixed(2), w.start.toFixed(2), w.end.toFixed(2)]) {
        const td = document.createElement('td');
        td.textContent = value;
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    ui.words.hidden = result.words.length === 0;
  }

  const stats = capture?.stats();
  log(
    `${riconosciuto ? `RICONOSCIUTO "${pulito}"` : 'SCARTATO'}` +
      (result.confidence === null ? '' : ` conf ${result.confidence.toFixed(2)}`) +
      (lastLatencyMs === null ? '' : ` · ${lastLatencyMs} ms`) +
      (stats ? ` · prima sillaba ${stats.leadMs} ms` : ''),
    riconosciuto ? 'ok' : 'warn',
  );
}

// ---------------------------------------------------------------------------
// NUMERI SULLO SCHERMO
// ---------------------------------------------------------------------------

function startUiLoop(): void {
  stopUiLoop();
  uiTimer = window.setInterval(refresh, UI_MS);
  refresh();
}

function stopUiLoop(): void {
  if (uiTimer !== null) window.clearInterval(uiTimer);
  uiTimer = null;
}

function refresh(): void {
  const g = gate;
  if (g) {
    const parlato = g.state() === 'speech';
    // Durante la calibrazione il cancello non puo' aprire: dirlo evita di
    // credere che sia sordo nei primi istanti dopo START.
    if (g.isCalibrating()) setText(ui.gate, 'CALIBRAZIONE…', 'warn');
    else setText(ui.gate, parlato ? 'SPEECH' : 'SILENCE', parlato ? 'ok' : undefined);
    setText(ui.forced, String(g.forcedCloses()), g.forcedCloses() > 3 ? 'warn' : undefined);
    setText(ui.level, g.level().toFixed(4));
    setText(ui.floor, `${g.threshold().toFixed(4)} / ${g.floor().toFixed(4)}`);
    // Scala logaritmica: in abitacolo i livelli utili stanno tutti in basso, e
    // su scala lineare la barra resterebbe sempre schiacciata a sinistra.
    ui.bar.style.width = `${percent(g.level())}%`;
    ui.mark.style.left = `${percent(g.threshold())}%`;
  }

  const stats = capture?.stats();
  if (stats) {
    setText(ui.utterances, String(stats.utterances));
    setText(ui.lead, `${stats.leadMs} ms`, stats.leadMs > 150 ? 'ok' : 'warn');
    setText(ui.missing, `${stats.missingLeadMs} ms`, stats.missingLeadMs > 0 ? 'bad' : 'ok');
  }

  setText(ui.commands, String(commands), commands > 0 ? 'ok' : undefined);
  setText(ui.rejected, String(rejected));
  // Una sola apertura per tutto il test: e' il numero che conta piu' di tutti.
  setText(ui.openings, String(mic.openings()), mic.openings() <= 1 ? 'ok' : 'bad');
  setText(ui.uptime, formatDuration(mic.activeMs()));
  setText(ui.memory, memoryNow());
}

function percent(level: number): number {
  if (level <= 0) return 0;
  // -60 dBFS .. 0 dBFS mappati su 0..100.
  const db = 20 * Math.log10(level);
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '—';
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m} min ${String(s).padStart(2, '0')} s`;
}

/**
 * `performance.memory` esiste solo nei browser basati su Chromium.
 * Su Safari non e' misurabile, e va detto invece di mostrare uno zero che
 * sembrerebbe un dato.
 */
function memoryNow(): string {
  const perf = performance as unknown as { memory?: { usedJSHeapSize?: number } };
  const used = perf.memory?.usedJSHeapSize;
  if (typeof used !== 'number') return 'non misurabile';
  return `${(used / 1048576).toFixed(0)} MB`;
}

// ---------------------------------------------------------------------------
// UTILITA'
// ---------------------------------------------------------------------------

function setText(node: HTMLElement, text: string, cls?: 'ok' | 'warn' | 'bad'): void {
  node.textContent = text;
  node.classList.remove('ok', 'warn', 'bad');
  if (cls) node.classList.add(cls);
}

function log(text: string, cls?: 'ok' | 'warn' | 'bad'): void {
  const li = document.createElement('li');
  const time = new Date().toLocaleTimeString('it-IT', { hour12: false });
  const b = document.createElement('b');
  b.textContent = text;
  li.append(`${time} `, b);
  if (cls) li.classList.add(cls);
  ui.log.prepend(li);
  while (ui.log.childElementCount > 120) ui.log.lastElementChild?.remove();
}

function message(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

// Rilascio anche se la pagina viene chiusa senza passare da STOP: un microfono
// lasciato aperto e' esattamente il difetto che questo prototipo deve smentire.
window.addEventListener('pagehide', () => {
  void mic.close();
  recognizer.release();
  stopUiLoop();
});
