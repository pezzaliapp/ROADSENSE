/**
 * ROAD SENSE - LIVELLO 3: la grammatica nel decoder VERO.
 *
 * I test di `npm test` dimostrano che la grammatica deriva dal lessico e che
 * ogni sua parola risulta nel certificato del modello. Non dimostrano che Kaldi
 * la accetti: quello si vede solo caricando il decoder.
 *
 * Questo script lo carica davvero - stessa build, stesso modello, stesse DUE
 * CSP di produzione (header di Cloudflare e meta di index.html, che si
 * applicano in intersezione) - e verifica cio' che solo il decoder puo' dire:
 *
 *   1. il riconoscitore arriva a "pronto";
 *   2. ZERO "Ignoring word missing in vocabulary": nessuna parola scartata in
 *      silenzio, che e' il guasto invisibile per cui esiste il certificato;
 *   3. il modello di linguaggio viene costruito, con stati e archi attesi;
 *   4. nessun EvalError: la ricompilazione CSP-safe regge ancora;
 *   5. la CSP servita non contiene 'unsafe-eval'.
 *
 * Serve Chrome e una `dist/` gia' costruita:
 *
 *     npm run build && node scripts/verify-decoder-grammar.mjs
 *
 * Non fa parte di `npm test`: richiede un browser e i 49 MB del modello.
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';

const RADICE = process.cwd();
const DIST = join(RADICE, 'dist');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORTA = 4599;
const PAGINA = '_verifica-grammatica.html';
const SCRIPT = '_verifica-grammatica.js';

const attesa = (ms) => new Promise((r) => setTimeout(r, ms));

if (!existsSync(DIST)) {
  console.error('dist/ non esiste: esegui prima "npm run build"');
  process.exit(1);
}

// -- le due politiche di sicurezza, prese da dove stanno in produzione -------

const csp = (() => {
  const headers = readFileSync(join(RADICE, 'public', '_headers'), 'utf8');
  const riga = /Content-Security-Policy:\s*(.+)/.exec(headers);
  if (!riga) throw new Error('nessuna CSP in public/_headers');
  return riga[1].trim();
})();
const cspMeta = (() => {
  const html = readFileSync(join(DIST, 'index.html'), 'utf8');
  const m = /<meta[^>]+Content-Security-Policy[^>]+content="([^"]+)"/i.exec(html);
  return m ? m[1] : null;
})();

const UNSAFE_EVAL = /(?<!wasm-)'?unsafe-eval/;
if (UNSAFE_EVAL.test(csp) || (cspMeta && UNSAFE_EVAL.test(cspMeta))) {
  console.error("REGRESSIONE CSP: 'unsafe-eval' e' comparso nella politica");
  process.exit(1);
}

// -- la pagina di verifica: usa il percorso di PRODUZIONE --------------------

const chunk = readdirSync(join(DIST, 'assets')).find((f) => /^voskRecognizer-.*\.js$/.test(f));
if (!chunk) {
  console.error('in dist/assets non c\'e\' il chunk voskRecognizer-*.js');
  process.exit(1);
}

/**
 * Lo script sta in un FILE, non inline: la CSP di produzione e'
 * `script-src 'self' 'wasm-unsafe-eval'`, che gli script inline li vieta. Una
 * pagina con `<script type="module">` incorporato non eseguirebbe nulla, e la
 * verifica si limiterebbe ad andare in timeout senza dire perche'.
 */
const script = `
const out = document.getElementById('out'); const log = []; window.__log = log;
const say = (t) => { log.push(t); out.textContent = log.join('\\n'); };
try {
  const mod = await import('/assets/${chunk}');
  const G = mod.VOICE_GRAMMAR;
  window.__grammatica = G;
  say('grammatica: ' + G.length + ' voci');
  const parti = [];
  for (let i = 0; i < 4; i++) {
    const r = await fetch('/assets/model/vosk-model-small-it-0.22/part-' + String(i).padStart(2, '0'));
    parti.push(await r.arrayBuffer());
  }
  const url = URL.createObjectURL(new Blob(parti, { type: 'application/gzip' }));
  say('modello ricomposto');
  const rec = new mod.LocalRecognizer();
  await rec.load(url, 16000, {
    onResult() {}, onPartial() {},
    onError(m) { say('ERRORE DECODER: ' + m); },
  });
  say('fase: ' + rec.phase());
  window.__fase = rec.phase();
} catch (e) { say('ECCEZIONE: ' + ((e && e.stack) || e)); }
window.__done = true;
`;

const pagina = `<!doctype html>
<html><head><meta charset="utf-8">
${cspMeta ? `<meta http-equiv="Content-Security-Policy" content="${cspMeta}">` : ''}
<title>verifica grammatica</title></head>
<body><pre id="out">...</pre>
<script type="module" src="/${SCRIPT}"></script>
</body></html>`;

const percorsoPagina = join(DIST, PAGINA);
const percorsoScript = join(DIST, SCRIPT);
writeFileSync(percorsoPagina, pagina, 'utf8');
writeFileSync(percorsoScript, script, 'utf8');

// -- server statico con le intestazioni di produzione ------------------------

const TIPI = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
};
const server = createServer((req, res) => {
  const percorso = join(DIST, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!percorso.startsWith(DIST) || !existsSync(percorso)) {
    res.writeHead(404).end('no');
    return;
  }
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('Content-Type', TIPI[extname(percorso)] ?? 'application/octet-stream');
  res.end(readFileSync(percorso));
});
await new Promise((r) => server.listen(PORTA, r));

// -- Chrome headless, con l'orecchio sul worker ------------------------------

const profilo = mkdtempSync(join(tmpdir(), 'roadsense-verifica-'));
const portaCdp = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${portaCdp}`, `--user-data-dir=${profilo}`,
   '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'],
  { stdio: 'ignore' },
);

const righe = [];
let ws;
let seq = 0;
const attese = new Map();
const invia = (method, params = {}, sessionId) => {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  return new Promise((res, rej) => attese.set(id, { res, rej }));
};

async function bersaglio() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${portaCdp}/json/list`);
      const t = (await r.json()).find((x) => x.type === 'page');
      if (t?.webSocketDebuggerUrl) return t.webSocketDebuggerUrl;
    } catch { /* Chrome non e' ancora in ascolto */ }
    await attesa(250);
  }
  throw new Error('Chrome non risponde');
}

ws = new WebSocket(await bersaglio());
await new Promise((r) => ws.addEventListener('open', r));
ws.addEventListener('message', async (e) => {
  const m = JSON.parse(e.data);
  if (m.id && attese.has(m.id)) {
    const { res, rej } = attese.get(m.id);
    attese.delete(m.id);
    if (m.error) rej(new Error(m.error.message));
    else res(m.result);
    return;
  }
  if (m.method === 'Target.attachedToTarget') {
    const sid = m.params.sessionId;
    await invia('Runtime.enable', {}, sid).catch(() => {});
    await invia('Runtime.runIfWaitingForDebugger', {}, sid).catch(() => {});
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    const t = (m.params.args ?? []).map((a) => a.value ?? a.description ?? '').join(' ');
    if (t) righe.push(t);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    righe.push('ECCEZIONE ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text));
  }
});

await invia('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
await invia('Runtime.enable');
await invia('Page.enable');
await invia('Page.navigate', { url: `http://localhost:${PORTA}/${PAGINA}` });

let stato = null;
for (let i = 0; i < 240; i++) {
  await attesa(1000);
  const d = await invia('Runtime.evaluate', {
    expression: 'JSON.stringify({done:!!window.__done,fase:window.__fase??null,voci:(window.__grammatica||[]).length,log:window.__log||[]})',
    returnByValue: true,
  }).catch(() => null);
  if (d?.result?.value) {
    stato = JSON.parse(d.result.value);
    if (stato.done) break;
  }
}

ws.close();
chrome.kill();
server.close();
rmSync(percorsoPagina, { force: true });
rmSync(percorsoScript, { force: true });
// Il profilo si cancella dopo il verdetto e senza poter far fallire la
// verifica: Chrome puo' star ancora scrivendoci, e un ENOTEMPTY di pulizia
// nasconderebbe il risultato che siamo venuti a prendere.
const pulisciProfilo = () => {
  try {
    rmSync(profilo, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch { /* resta in /tmp: non e' un fallimento della verifica */ }
};

// -- verdetto ----------------------------------------------------------------

const scartate = righe.filter((r) => /Ignoring word missing in vocabulary/.test(r));
const lm = righe.find((r) => /Created language model/.test(r));
const eccezioni = righe.filter((r) => /ECCEZIONE|EvalError/.test(r));

console.log('--- pagina ---');
for (const r of stato?.log ?? []) console.log('  ' + r);
console.log('--- decoder ---');
for (const r of righe.filter((r) => /Recognizer\(\)|Estimating|Created language|Ignoring word/.test(r))) {
  console.log('  ' + r.replace(/^LOG \(VoskAPI:/, '').slice(0, 160));
}

const esiti = [
  ['CSP servita senza unsafe-eval', !UNSAFE_EVAL.test(csp)],
  ['CSP meta senza unsafe-eval', !cspMeta || !UNSAFE_EVAL.test(cspMeta)],
  ['grammatica caricata dal chunk di produzione', (stato?.voci ?? 0) > 200],
  ['riconoscitore PRONTO', stato?.fase === 'pronto'],
  ['zero parole scartate dal vocabolario', scartate.length === 0],
  ['modello di linguaggio costruito', Boolean(lm)],
  ['nessun EvalError / violazione CSP', eccezioni.length === 0],
];

console.log('--- esito ---');
let ok = true;
for (const [nome, passa] of esiti) {
  console.log(`  ${passa ? 'OK  ' : 'KO  '} ${nome}`);
  if (!passa) ok = false;
}
if (scartate.length > 0) for (const s of scartate) console.log('   scartata: ' + s);
if (eccezioni.length > 0) for (const s of eccezioni) console.log('   ' + s.slice(0, 200));

pulisciProfilo();
process.exit(ok ? 0 : 1);
