import { describe, expect, it } from 'vitest';

import { DEFAULT_GATE, msToSamples, rms, SpeechGate, type SpeechGateConfig } from './speechGate';

const SR = 16_000;
const FRAME = 1024; // 64 ms a 16 kHz
const config: SpeechGateConfig = { ...DEFAULT_GATE, sampleRate: SR };

/** Frame a livello costante: il livello RMS di un valore costante e' quel valore. */
const frame = (level: number, length = FRAME): Float32Array =>
  new Float32Array(length).fill(level);

type Event = ReturnType<SpeechGate['push']>;

function pushMany(gate: SpeechGate, level: number, frames: number): Event[] {
  const out: Event[] = [];
  for (let i = 0; i < frames; i++) out.push(gate.push(frame(level)));
  return out;
}

/** Frame necessari a superare la calibrazione, con margine. */
const CALIBRAZIONE = Math.ceil(msToSamples(config.calibrationMs, SR) / FRAME) + 2;

/** Cancello gia' calibrato su un dato rumore di fondo. */
function calibrato(rumore: number, frames = 60): SpeechGate {
  const gate = new SpeechGate(config);
  pushMany(gate, rumore, Math.max(frames, CALIBRAZIONE));
  return gate;
}

describe('SpeechGate / misure di base', () => {
  it('rms di un frame costante e il valore stesso', () => {
    expect(rms(frame(0.5, 16))).toBeCloseTo(0.5, 6);
    expect(rms(new Float32Array(0))).toBe(0);
  });

  it('un frame vuoto non fa avanzare nulla', () => {
    const gate = new SpeechGate(config);
    expect(gate.push(new Float32Array(0))).toBeNull();
    expect(gate.position()).toBe(0);
  });
});

describe('SpeechGate / calibrazione iniziale', () => {
  it('durante la calibrazione non apre, qualunque sia il livello', () => {
    const gate = new SpeechGate(config);
    const frames = Math.floor(msToSamples(config.calibrationMs, SR) / FRAME);
    // Voce forte dal primo istante: non deve produrre alcun enunciato.
    expect(pushMany(gate, 0.8, frames).every((e) => e === null)).toBe(true);
    expect(gate.isCalibrating()).toBe(true);
  });

  it('partire in un abitacolo GIA rumoroso non blocca il cancello', () => {
    // E' la regressione che conta. Senza calibrazione il rumore superava subito
    // il fondo di partenza, il cancello si apriva e - non aggiornando il fondo
    // mentre e' aperto - non si richiudeva mai piu': un enunciato infinito.
    const gate = new SpeechGate(config);
    const eventi = pushMany(gate, 0.05, Math.round((30 * SR) / FRAME));
    expect(eventi.every((e) => e === null)).toBe(true);
    expect(gate.state()).toBe('silence');
    expect(gate.forcedCloses()).toBe(0);
    // E la voce si sente ancora, perche' la soglia si e' alzata col rumore.
    expect(pushMany(gate, 0.6, 6).some((e) => e?.type === 'open')).toBe(true);
  });

  it('dopo la calibrazione il cancello e operativo', () => {
    const gate = calibrato(0.004);
    expect(gate.isCalibrating()).toBe(false);
  });
});

describe('SpeechGate / confini dell enunciato', () => {
  it('resta in silenzio col solo rumore di fondo, per quanto a lungo', () => {
    const gate = calibrato(0.004);
    const eventi = pushMany(gate, 0.004, Math.round((40 * SR) / FRAME));
    expect(eventi.every((e) => e === null)).toBe(true);
    expect(gate.state()).toBe('silence');
  });

  it('apre solo dopo il sustain, non al primo frame', () => {
    const gate = calibrato(0.004);
    const serviti = Math.ceil(msToSamples(config.sustainMs, SR) / FRAME);
    for (let i = 1; i < serviti; i++) {
      expect(gate.push(frame(0.4))).toBeNull();
    }
    expect(gate.push(frame(0.4))?.type).toBe('open');
    expect(gate.state()).toBe('speech');
  });

  it('data l apertura all inizio della salita, non all istante della conferma', () => {
    const gate = calibrato(0.004);
    const inizioSalita = gate.position();

    let apertura: number | null = null;
    for (let i = 0; i < 10 && apertura === null; i++) {
      const evento = gate.push(frame(0.4));
      if (evento?.type === 'open') apertura = evento.startSample;
    }
    // Se fosse datata alla conferma, questo valore sarebbe maggiore: sarebbero
    // i millisecondi di voce che il decoder non riceverebbe mai.
    expect(apertura).toBe(inizioSalita);
    expect(gate.position() - (apertura as number)).toBeGreaterThanOrEqual(
      msToSamples(config.sustainMs, SR),
    );
  });

  it('un impulso isolato non apre nulla', () => {
    const gate = calibrato(0.004);
    // Un solo frame forte: una buca, un colpo di tosse, una portiera.
    expect(gate.push(frame(0.9))).toBeNull();
    expect(gate.push(frame(0.004))).toBeNull();
    expect(gate.state()).toBe('silence');
  });

  it('non chiude sulla pausa interna di una parola', () => {
    const gate = calibrato(0.004);
    pushMany(gate, 0.4, 6);
    expect(gate.state()).toBe('speech');

    // "in-ci-den-te": una pausa piu' breve dell'hangover non e' la fine.
    const breve = Math.floor(msToSamples(config.hangoverMs, SR) / FRAME) - 1;
    expect(pushMany(gate, 0.004, Math.max(1, breve)).every((e) => e === null)).toBe(true);
    expect(gate.state()).toBe('speech');
  });

  it('chiude dopo l hangover e data la fine all ultima voce sentita', () => {
    const gate = calibrato(0.004);
    pushMany(gate, 0.4, 6);
    const ultimaVoce = gate.position();

    let chiusura: Extract<NonNullable<Event>, { type: 'close' }> | null = null;
    for (let i = 0; i < 40 && chiusura === null; i++) {
      const evento = gate.push(frame(0.004));
      if (evento?.type === 'close') chiusura = evento;
    }
    expect(chiusura?.endSample).toBe(ultimaVoce);
    expect(chiusura?.forced).toBe(false);
    expect(gate.state()).toBe('silence');
  });

  it('enunciati consecutivi senza alcun intervento fra uno e l altro', () => {
    const gate = calibrato(0.004);
    let aperture = 0;
    let chiusure = 0;
    for (let parola = 0; parola < 4; parola++) {
      for (const e of pushMany(gate, 0.4, 8)) if (e?.type === 'open') aperture++;
      for (const e of pushMany(gate, 0.004, 20)) if (e?.type === 'close') chiusure++;
    }
    expect(aperture).toBe(4);
    expect(chiusure).toBe(4);
    expect(gate.forcedCloses()).toBe(0);
  });
});

describe('SpeechGate / soglia relativa al rumore', () => {
  it('il fondo si adatta al rumore SOLO nel silenzio', () => {
    // Rumore sotto la soglia iniziale: il cancello resta in silenzio e misura.
    const gate = calibrato(0.02, 400);
    const fondoRumoroso = gate.floor();
    expect(gate.state()).toBe('silence');
    expect(fondoRumoroso).toBeGreaterThan(config.initialFloor);

    // Aperto l'enunciato, il fondo non deve muoversi: se si muovesse, una frase
    // lunga alzerebbe la propria soglia fino a zittirsi da sola.
    pushMany(gate, 0.5, 6);
    expect(gate.state()).toBe('speech');
    const fondoAllApertura = gate.floor();
    pushMany(gate, 0.5, 20);
    expect(gate.floor()).toBe(fondoAllApertura);
  });

  it('con rumore alto serve una voce piu forte', () => {
    const gate = calibrato(0.02, 600);
    // Un livello che nel silenzio avrebbe aperto, in autostrada non basta.
    expect(0.04).toBeGreaterThan(config.initialFloor * config.triggerRatio);
    expect(pushMany(gate, 0.04, 20).every((e) => e === null)).toBe(true);
    // Alzando la voce, invece, si apre.
    expect(pushMany(gate, 0.6, 6).some((e) => e?.type === 'open')).toBe(true);
  });

  it('il fondo scende piu in fretta di quanto salga', () => {
    const salita = calibrato(0.004);
    const partenza = salita.floor();
    pushMany(salita, 0.02, 10);
    const dopoSalita = salita.floor() - partenza;

    const discesa = calibrato(0.02, 400);
    const alto = discesa.floor();
    pushMany(discesa, 0.001, 10);
    const dopoDiscesa = alto - discesa.floor();

    // Un silenzio va seguito subito; un aumento di rumore e' quasi sempre voce.
    expect(dopoDiscesa).toBeGreaterThan(dopoSalita);
  });

  it('il pavimento assoluto evita che il silenzio totale renda tutto voce', () => {
    const gate = calibrato(0, 2000);
    expect(gate.threshold()).toBeGreaterThanOrEqual(config.minLevel);
    // Un livello sotto il pavimento non apre, anche se e' infinite volte il fondo.
    expect(pushMany(gate, config.minLevel * 0.5, 20).every((e) => e === null)).toBe(true);
  });
});

describe('SpeechGate / uscita di sicurezza', () => {
  it('chiude d autorita un enunciato troppo lungo', () => {
    const gate = calibrato(0.004);
    const frames = Math.ceil(msToSamples(config.maxUtteranceMs, SR) / FRAME) + 2;
    const eventi = pushMany(gate, 0.4, frames);
    const chiusura = eventi.find((e) => e?.type === 'close');
    expect(chiusura).toBeDefined();
    expect(chiusura?.type === 'close' && chiusura.forced).toBe(true);
    expect(gate.forcedCloses()).toBe(1);
  });

  it('un rumore sostenuto che arriva DOPO la calibrazione non blocca il cancello', () => {
    // Caso che la calibrazione non puo' prevedere: si parte in citta' e si
    // entra in autostrada. Il fondo non si aggiorna mentre e' aperto, quindi
    // senza l'uscita di sicurezza l'enunciato non finirebbe mai.
    const gate = calibrato(0.004);
    pushMany(gate, 0.1, Math.round((60 * SR) / FRAME));

    expect(gate.state()).toBe('silence');
    // Si assesta in poche chiusure forzate, non a ogni enunciato massimo.
    expect(gate.forcedCloses()).toBeGreaterThan(0);
    expect(gate.forcedCloses()).toBeLessThanOrEqual(5);
    // E da qui in poi tace davvero.
    expect(pushMany(gate, 0.1, Math.round((20 * SR) / FRAME)).every((e) => e === null)).toBe(true);
    // Restando sensibile a una voce che superi il nuovo rumore.
    expect(pushMany(gate, 0.8, 6).some((e) => e?.type === 'open')).toBe(true);
  });

  it('reset riporta stato, fondo, riferimento e contatori', () => {
    const gate = calibrato(0.004);
    pushMany(gate, 0.4, 20);
    gate.reset();
    expect(gate.state()).toBe('silence');
    expect(gate.position()).toBe(0);
    expect(gate.floor()).toBe(config.initialFloor);
    expect(gate.forcedCloses()).toBe(0);
    expect(gate.isCalibrating()).toBe(true);
  });
});
