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

import { MicSession, type OutputMode } from '../voice/local/micSession';
import { RingBuffer } from '../voice/local/ringBuffer';
import { DEFAULT_GATE, SpeechGate, type SpeechGateConfig } from '../voice/local/speechGate';
import { UtteranceCapture } from '../voice/local/utteranceCapture';
import { VOICE_GRAMMAR } from '../voice/local/grammar';
import { LocalRecognizer, type LabResult } from '../voice/local/voskRecognizer';

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

/**
 * TELEMETRIA
 *
 * Conta eventi che accadono comunque. Nessun timer nuovo, nessuna
 * interrogazione periodica dei dispositivi, nessun tentativo aggiuntivo: il
 * disegno riusa il ciclo di interfaccia che esiste gia'.
 *
 * Serve a una domanda sola: il bip periodico coincide con qualche operazione
 * che si ripete? Se tutti questi numeri restano fermi mentre il bip continua,
 * i nostri componenti sono scagionati - ed e' un risultato, non un fallimento.
 */
const tele = {
  /** Tentativi di apertura del microfono: `mic.open()` invocata. */
  gumCalls: 0,
  /** Aperture riuscite. Coincide con contesti e worklet creati: uno per apertura. */
  streamStarts: 0,
  /** La traccia audio e' terminata dal sistema. */
  streamEnds: 0,
  trackMutes: 0,
  trackUnmutes: 0,
  ctxStateChanges: 0,
  ctxState: '—',
  /** Blocchi consegnati dall'AudioWorklet: e' la prova che la presa e' viva. */
  workletBlocks: 0,
  samples: 0,
  /** Modalita' di uscita realmente ottenuta. */
  output: '—',
};

const mic = new MicSession();
const recognizer = new LocalRecognizer();
/** Istante di START, per i tempi relativi nel diario. */
let startedAt: number | null = null;
let gate: SpeechGate | null = null;
let capture: UtteranceCapture | null = null;
let uiTimer: number | null = null;
let objectUrl: string | null = null;
let sampleRate = DEFAULT_GATE.sampleRate;
let commands = 0;
let rejected = 0;
let utteranceEndedAt: number | null = null;
let lastLatencyMs: number | null = null;

// Campo URL VUOTO di proposito.
//
// Era precompilato con `/lab/model/vosk-model-small-it-0.22.tar.gz`, un file
// che non e' mai stato pubblicato. Chi premeva START senza scegliere nulla
// imboccava quindi un 404 - e, per il difetto corretto in `voskRecognizer`,
// restava a guardare "CARICAMENTO..." per sempre. Un valore predefinito che
// punta al nulla e' peggio di nessun valore.
// ---------------------------------------------------------------------------
// PANNELLO DI TELEMETRIA E SCELTA DELL'USCITA, costruiti qui
// ---------------------------------------------------------------------------

/** Crea una riga etichetta/valore dentro un pannello e ne restituisce il valore. */
function addRow(parent: HTMLElement, label: string, nota?: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'row';
  const left = document.createElement('span');
  left.innerHTML = nota ? `${label}<br /><small>${nota}</small>` : label;
  const right = document.createElement('span');
  right.textContent = '—';
  row.append(left, right);
  parent.appendChild(row);
  return right;
}

function addPanel(title: string, before: HTMLElement): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'panel';
  const h = document.createElement('h2');
  h.textContent = title;
  panel.appendChild(h);
  before.parentNode?.insertBefore(panel, before);
  return panel;
}

const logPanel = ui.log.closest('.panel') as HTMLElement;

// Scelta dell'uscita: serve a DIMOSTRARE sul telefono da dove viene il bip,
// invece di dedurlo. Si sceglie prima di START e non cambia nient'altro.
const outPanel = addPanel('Uscita audio (prova comparativa)', logPanel);
const outSelect = document.createElement('select');
for (const [value, testo] of [
  ['silent', 'SILENT — nessun dispositivo di uscita (setSinkId none)'],
  ['speaker', 'SPEAKER — guadagno 0 verso la destinazione (comportamento precedente)'],
  ['detached', 'DETACHED — nessun collegamento alla destinazione'],
] as const) {
  const opt = document.createElement('option');
  opt.value = value;
  opt.textContent = testo;
  outSelect.appendChild(opt);
}
outSelect.style.cssText =
  'font:inherit;width:100%;padding:9px 10px;border-radius:8px;border:1px solid var(--line);background:#0d1116;color:var(--text);margin-top:4px';
outPanel.appendChild(outSelect);
const outNote = document.createElement('p');
outNote.className = 'note';
outNote.textContent =
  'Del microfono non serve sentire niente: SILENT elabora senza aprire alcuno stream di riproduzione. ' +
  'Se il bip sparisce solo in una di queste modalita, la causa e dimostrata.';
outPanel.appendChild(outNote);

const telePanel = addPanel('Telemetria', logPanel);
const t = {
  output: addRow(telePanel, 'USCITA OTTENUTA'),
  gum: addRow(telePanel, 'GET USER MEDIA CALLS'),
  starts: addRow(telePanel, 'MEDIA STREAM STARTS'),
  ends: addRow(telePanel, 'MEDIA STREAM ENDS'),
  mutes: addRow(telePanel, 'TRACK MUTE / UNMUTE'),
  ctxCreates: addRow(telePanel, 'AUDIO CONTEXT CREATES'),
  ctxState: addRow(telePanel, 'AUDIO CONTEXT STATE'),
  ctxChanges: addRow(telePanel, 'AUDIO CONTEXT STATE CHANGES'),
  worklet: addRow(telePanel, 'AUDIO WORKLET CREATES'),
  blocks: addRow(telePanel, 'AUDIOWORKLET BLOCKS', 'se si ferma, la presa e morta'),
  samples: addRow(telePanel, 'CAMPIONI RICEVUTI'),
  vWorker: addRow(telePanel, 'VOSK WORKER CREATES'),
  vLoads: addRow(telePanel, 'VOSK MODEL LOADS'),
  vRec: addRow(telePanel, 'VOSK RECOGNIZER CREATES'),
  vFlush: addRow(telePanel, 'VOSK RESETS / FLUSH'),
  vFeeds: addRow(telePanel, 'VOSK FEEDS / CAMPIONI'),
  vErr: addRow(telePanel, 'VOSK ERRORS'),
  vRetry: addRow(telePanel, 'VOSK RETRIES', 'deve restare 0'),
  vTerm: addRow(telePanel, 'VOSK WORKER TERMINATIONS'),
};

ui.modelUrl.value = '';
ui.modelHint.textContent =
  'Scegli il file del modello dal dispositivo: e’ il percorso normale. ' +
  'Serve vosk-model-small-it-0.22 (Apache-2.0, ~48 MB) nel formato .tar.gz. ' +
  'Il file resta sul telefono: non viene caricato da nessuna parte, e nessun audio lascia il dispositivo. ' +
  'Il campo URL e’ un’alternativa diagnostica e puo’ restare vuoto.';

log('Pagina pronta. Nessun microfono aperto.');
// La grammatica non e' piu' un pugno di parole da stampare per intero: e'
// derivata dal lessico del parser e conta centinaia di voci. Qui serve la
// misura, non l'elenco.
const terminiGrammatica = VOICE_GRAMMAR.filter((v) => !v.includes(' ') && v !== '[unk]');
const semiGrammatica = VOICE_GRAMMAR.filter((v) => v.includes(' '));
log(
  `Grammatica: ${terminiGrammatica.length} termini + ${semiGrammatica.length} frasi-seme + [unk]` +
    ` (es. ${terminiGrammatica.slice(0, 6).join(', ')}...)`,
);

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
  startedAt = performance.now();
  Object.assign(tele, {
    gumCalls: 0, streamStarts: 0, streamEnds: 0, trackMutes: 0, trackUnmutes: 0,
    ctxStateChanges: 0, ctxState: '—', workletBlocks: 0, samples: 0, output: '—',
  });
  commands = 0;
  rejected = 0;
  lastLatencyMs = null;
  utteranceEndedAt = null;
  setText(ui.lastText, '—');
  setText(ui.lastConf, '—');
  ui.words.hidden = true;

  // Il controllo precede l'apertura del microfono: senza modello non si apre
  // niente e non si avvia alcun caricamento.
  const source = modelSource();
  if (!source) {
    setText(ui.model, 'SELEZIONA MODELLO', 'warn');
    log('Nessun modello selezionato. Scegli il file .tar.gz dal dispositivo.', 'bad');
    ui.start.disabled = false;
    return;
  }

  let info;
  try {
    tele.gumCalls++;
    info = await mic.open(
      {
        onFrame: (frame) => {
          // Un messaggio dalla presa = un blocco elaborato. E' l'unico modo di
          // sapere se l'AudioWorklet e' ancora vivo, e non richiede di
          // modificarlo.
          tele.workletBlocks++;
          tele.samples += frame.length;
          capture?.push(frame);
        },
        onContextState: (state) => {
          tele.ctxStateChanges++;
          tele.ctxState = state;
          setText(ui.ctx, state.toUpperCase());
          log(`AudioContext: ${state}`, state === 'running' ? 'ok' : 'warn');
        },
        onTrackMuted: (muted) => {
          if (muted) tele.trackMutes++;
          else tele.trackUnmutes++;
          log(
            muted
              ? 'Microfono sottratto dal sistema (telefonata?). Nessun campione in arrivo.'
              : 'Microfono restituito dal sistema.',
            muted ? 'warn' : 'ok',
          );
        },
        onEnded: () => {
          tele.streamEnds++;
          log('La traccia audio e’ terminata dal sistema.', 'bad');
        },
      },
      outSelect.value as OutputMode,
    );
  } catch (error) {
    log(`Microfono negato o non disponibile: ${message(error)}`, 'bad');
    ui.start.disabled = false;
    return;
  }

  tele.streamStarts++;
  tele.ctxState = info.contextState;
  tele.output = info.output;
  sampleRate = info.sampleRate;
  setText(ui.mic, 'ON', 'ok');
  setText(ui.ctx, info.contextState.toUpperCase());
  setText(ui.rate, `${info.sampleRate} Hz`);
  log(`Microfono aperto: ${info.trackLabel}`, 'ok');
  log(`Frequenza reale del contesto: ${info.sampleRate} Hz`);
  log(`Vincoli concessi: ${JSON.stringify(info.settings)}`);
  log(
    `Uscita audio: ${info.output.toUpperCase()}` +
      (info.outputNote ? ` (richiesta ${outSelect.value}, ripiego: ${info.outputNote})` : ''),
    info.output === outSelect.value ? 'ok' : 'warn',
  );

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
  // Cambiare uscita a microfono aperto non avrebbe senso: si sceglie prima.
  outSelect.disabled = true;
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
    // L'errore REALE, non un'attesa muta: e' il punto della correzione.
    setText(ui.model, 'ERRORE', 'bad');
    log(`Modello non caricato: ${recognizer.lastError() ?? message(error)}`, 'bad');
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
  startedAt = null;
  outSelect.disabled = false;
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

  // La riga MODELLO segue la fase REALE del decoder, invece di restare ferma
  // sull'etichetta scritta a START.
  switch (recognizer.phase()) {
    case 'caricamento':
      setText(ui.model, 'CARICAMENTO…', 'warn');
      break;
    case 'pronto':
      setText(ui.model, 'PRONTO', 'ok');
      break;
    case 'errore':
      setText(ui.model, `ERRORE: ${recognizer.lastError() ?? 'causa sconosciuta'}`, 'bad');
      break;
    default:
      break;
  }

  // Telemetria: stesso ciclo di prima, nessun timer aggiunto.
  const v = recognizer.stats();
  setText(t.output, tele.output.toUpperCase(), tele.output === 'silent' ? 'ok' : 'warn');
  setText(t.gum, String(tele.gumCalls), tele.gumCalls <= 1 ? 'ok' : 'bad');
  setText(t.starts, String(tele.streamStarts), tele.streamStarts <= 1 ? 'ok' : 'bad');
  setText(t.ends, String(tele.streamEnds), tele.streamEnds === 0 ? 'ok' : 'bad');
  setText(t.mutes, `${tele.trackMutes} / ${tele.trackUnmutes}`);
  // Contesto e worklet si creano una volta per apertura riuscita: lo stesso numero.
  setText(t.ctxCreates, String(tele.streamStarts), tele.streamStarts <= 1 ? 'ok' : 'bad');
  setText(t.ctxState, tele.ctxState.toUpperCase(), tele.ctxState === 'running' ? 'ok' : 'warn');
  setText(t.ctxChanges, String(tele.ctxStateChanges), tele.ctxStateChanges > 2 ? 'warn' : undefined);
  setText(t.worklet, String(tele.streamStarts), tele.streamStarts <= 1 ? 'ok' : 'bad');
  setText(t.blocks, String(tele.workletBlocks), tele.workletBlocks > 0 ? 'ok' : 'warn');
  setText(t.samples, tele.samples.toLocaleString('it-IT'));
  setText(t.vWorker, String(v.workerCreates), v.workerCreates <= 1 ? 'ok' : 'bad');
  setText(t.vLoads, String(v.modelLoads));
  setText(t.vRec, String(v.recognizerCreates), v.recognizerCreates <= 1 ? 'ok' : 'bad');
  setText(t.vFlush, String(v.flushes));
  setText(t.vFeeds, `${v.feeds} / ${v.samplesFed.toLocaleString('it-IT')}`);
  setText(t.vErr, String(v.errors), v.errors === 0 ? 'ok' : 'bad');
  setText(t.vRetry, String(v.retries), v.retries === 0 ? 'ok' : 'bad');
  setText(t.vTerm, String(v.terminations));

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
  // Tempo RELATIVO dall'avvio: e' cio' che si confronta con l'istante del bip.
  const time =
    startedAt === null
      ? new Date().toLocaleTimeString('it-IT', { hour12: false })
      : `+${((performance.now() - startedAt) / 1000).toFixed(1)}s`;
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
