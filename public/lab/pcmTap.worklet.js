/* ROAD SENSE / LABORATORIO FASE 0 - presa dei campioni dal microfono.
 *
 * NON FA PARTE DELL'APPLICAZIONE. Caricato soltanto da voice-lab.html.
 *
 * File statico e in JavaScript puro di proposito: un modulo di AudioWorklet
 * viene caricato per URL dal contesto audio, non passa dal bundler, e deve
 * essere servito dalla nostra stessa origine per rispettare `script-src 'self'`
 * senza toccare un solo header.
 *
 * Fa una cosa sola: copia il canale di ingresso e lo manda al thread
 * principale. Nessuna soglia, nessuna decisione, nessuna registrazione, nessun
 * accumulo oltre il blocco corrente.
 *
 * PERCHE' AudioWorklet E NON ScriptProcessorNode
 * Gira sul thread audio in tempo reale, che non viene rallentato dal
 * throttling dei timer quando la pagina perde il primo piano. E' anche il
 * punto che va MISURATO su Safari: esistono segnalazioni di catture che si
 * interrompono dopo pochi secondi su iOS. Se il difetto ricompare, il piano B
 * dichiarato e' ScriptProcessorNode - deprecato ma funzionante.
 *
 * PERCHE' ACCUMULA PRIMA DI SPEDIRE
 * `process` viene chiamato ogni 128 campioni: a 48 kHz sono 375 messaggi al
 * secondo. Raggruppare in blocchi da 1024 riduce i messaggi a una
 * quarantina al secondo senza aggiungere latenza percepibile (21 ms).
 */

const BLOCK = 1024;

class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.acc = new Float32Array(BLOCK);
    this.filled = 0;
    this.running = true;
    this.port.onmessage = (event) => {
      // Unico comando accettato: smettere. Nessun canale di ritorno.
      if (event.data === 'stop') this.running = false;
    };
  }

  process(inputs) {
    if (!this.running) return false;

    const channel = inputs[0] && inputs[0][0];
    // Ingresso assente: succede quando una telefonata sottrae il microfono.
    // Non si inventa silenzio, semplicemente non si consegna nulla: il
    // cancello a valle non avanza e l'interfaccia lo mostra.
    if (!channel || channel.length === 0) return true;

    for (let i = 0; i < channel.length; i++) {
      this.acc[this.filled++] = channel[i];
      if (this.filled === BLOCK) {
        // Copia: il buffer viene riusato al giro successivo.
        this.port.postMessage(this.acc.slice(0));
        this.filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-tap', PcmTap);
