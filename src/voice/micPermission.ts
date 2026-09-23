/**
 * ROAD SENSE - permesso del microfono.
 *
 * Separato dal resto perche' la sua correttezza dipende da due cose che il
 * codice dentro React nasconde: l'ORDINE delle chiamate e la DISTINZIONE fra
 * esiti che si somigliano. Qui sono entrambe esplicite e verificabili senza
 * browser.
 *
 * LA REGOLA CHE CONTA
 * `getUserMedia()` deve partire nella stessa attivazione del tocco, senza
 * nessun `await` prima. Un `await` che precede la chiamata restituisce il
 * controllo al browser, l'attivazione del gesto decade e Android puo'
 * rifiutare senza mostrare alcuna finestra: l'utente vede un rifiuto che non
 * ha mai dato. Per questo `requestMicrophone` NON e' async e riceve dal
 * chiamante cio' che gia' sa, invece di andarselo a cercare.
 *
 * CHI DECIDE, E CHI INFORMA
 *
 *   permissions.query()  informazione. Serve a scegliere il messaggio piu'
 *                        utile e a popolare la diagnosi. NON decide nulla.
 *   getUserMedia()       verifica. E' l'unica cosa che stabilisce davvero se
 *                        il microfono si puo' usare.
 *
 * Il motivo e' un difetto osservato sul campo: un `NotAllowedError` capitato
 * una volta lasciava l'app convinta che il permesso fosse negato, e da li' in
 * poi non chiedeva piu' nulla - nemmeno dopo che il permesso era stato
 * concesso davvero. Uno stato dichiarato non puo' impedire una verifica.
 *
 * Di conseguenza l'UNICA scorciatoia ammessa e' quella positiva: se in questa
 * sessione il microfono si e' gia' aperto, non lo si riapre per nulla. Un
 * fallimento non e' mai definitivo: il tocco successivo riprova.
 *
 * Cio' che NON si fa: dedurre dal tempo di risposta se la finestra sia
 * comparsa. Sarebbe un'euristica legata a browser e dispositivo, e uno stato
 * semantico dell'app non puo' dipendere da un cronometro.
 */

/** Cio' che il browser dichiara sul permesso, prima di chiederlo. */
export type MicPermission = 'permesso' | 'negato' | 'sconosciuto';

/**
 * Valore LETTERALE della Permissions API, senza interpretazione.
 * Serve alla diagnosi: 'errore' e 'non disponibile' sono cose diverse fra
 * loro e diverse da 'denied', e confonderle e' esattamente cio' che rende
 * incomprensibile un guasto su un telefono che non si ha in mano.
 */
export type MicPermissionRaw =
  | 'granted'
  | 'prompt'
  | 'denied'
  | 'errore'
  | 'non disponibile';

/** Esito LETTERALE del tentativo di `getUserMedia`. */
export type MicAttempt =
  | 'non tentato'
  | 'successo'
  | 'NotAllowedError'
  | 'NotFoundError'
  | 'NotReadableError'
  | 'altro errore';

/**
 * Esito di una richiesta.
 *
 *   permesso     il microfono si e' aperto: e' un fatto, non una dichiarazione
 *   rifiutato    non autorizzato adesso; si riprova toccando di nuovo VOCE
 *   bloccato     non autorizzato E la Permissions API dichiara 'denied':
 *                solo qui ha senso parlare di impostazioni del sito
 *   assente      nessun microfono sul dispositivo
 *   occupato     microfono in uso da un'altra applicazione
 *   sconosciuto  il browser non offre l'API: si prova lo stesso piu' avanti
 */
export type MicOutcome =
  | 'permesso'
  | 'rifiutato'
  | 'bloccato'
  | 'assente'
  | 'occupato'
  | 'sconosciuto';

export interface MicRequestResult {
  outcome: MicOutcome;
  /**
   * Il microfono e' utilizzabile: verificato aprendolo, non dichiarato.
   * E' l'unico stato che vale la pena ricordare per la sessione.
   */
  usable: boolean;
  /** Stato del permesso dopo il tentativo, per la sola diagnosi. */
  permission: MicPermission;
  /** Valore grezzo consultato per scegliere il messaggio. */
  permissionRaw: MicPermissionRaw | null;
  /**
   * `getUserMedia` e' stata effettivamente chiamata.
   * E' un fatto su cio' che ha fatto ROAD SENSE, non una deduzione su cio'
   * che ha mostrato il browser: quello non e' osservabile.
   */
  requested: boolean;
  /** Nome dell'errore restituito, testuale e non interpretato. */
  errorName: string | null;
}

interface TrackLike {
  stop(): void;
}
interface StreamLike {
  getTracks(): TrackLike[];
}

export interface MicEnvironment {
  /**
   * Lettura passiva del permesso: non apre nulla e non chiede nulla.
   * Restituisce il valore LETTERALE della Permissions API. L'interpretazione
   * avviene qui sopra, non nell'ambiente.
   */
  queryPermission: (() => Promise<string>) | null;
  /** La chiamata che provoca la finestra nativa. */
  requestStream: (() => Promise<StreamLike>) | null;
}

/**
 * Legge il valore grezzo della Permissions API. Non provoca nessuna finestra.
 * Non deduce niente: riporta cio' che l'API ha risposto, o perche' non ha
 * risposto.
 */
export async function readMicPermissionRaw(env: MicEnvironment): Promise<MicPermissionRaw> {
  if (!env.queryPermission) return 'non disponibile';
  try {
    const state = await env.queryPermission();
    if (state === 'granted' || state === 'prompt' || state === 'denied') return state;
    // Un valore fuori dai tre previsti non e' un rifiuto: e' un'anomalia.
    return 'errore';
  } catch {
    // Chrome per Android ha rifiutato a lungo il nome 'microphone' in
    // `permissions.query`, sollevando invece di rispondere. Un'eccezione NON
    // significa permesso negato.
    return 'errore';
  }
}

/** Interpretazione del valore grezzo. Solo 'denied' e' un no. */
export function interpretPermission(raw: MicPermissionRaw): MicPermission {
  if (raw === 'granted') return 'permesso';
  if (raw === 'denied') return 'negato';
  // 'prompt', 'errore' e 'non disponibile' sono tutti "non si sa ancora".
  return 'sconosciuto';
}

/** Legge il permesso senza chiederlo. Non provoca nessuna finestra. */
export async function readMicPermission(env: MicEnvironment): Promise<MicPermission> {
  return interpretPermission(await readMicPermissionRaw(env));
}

/** Traduce un esito in cio' che ha realmente fatto `getUserMedia`. */
export function attemptOf(result: MicRequestResult): MicAttempt {
  if (!result.requested) return 'non tentato';
  if (result.outcome === 'permesso') return 'successo';
  const name = result.errorName ?? '';
  if (name === 'NotAllowedError' || name === 'NotFoundError' || name === 'NotReadableError') {
    return name;
  }
  return 'altro errore';
}

/**
 * Chiede il microfono all'utente.
 *
 * NON e' async di proposito: il corpo deve arrivare a `requestStream()` senza
 * mai cedere il controllo, altrimenti l'attivazione del tocco decade.
 *
 * @param known cio' che si sapeva del permesso PRIMA del tocco. Serve a
 * distinguere un rifiuto appena dato da un blocco preesistente.
 */
/** Opzioni del tentativo. */
export interface MicRequestOptions {
  /**
   * In questa sessione il microfono si e' gia' aperto con successo.
   * E' la SOLA scorciatoia ammessa, ed e' positiva: evita di riaprire il
   * microfono per nulla. Nessuno stato negativo salta mai la verifica.
   */
  verified?: boolean;
  /**
   * Diagnosi (?debugVoice=1): chiama `getUserMedia` comunque, anche quando
   * sarebbe superfluo, per poter osservare i due canali separatamente.
   */
  force?: boolean;
}

/**
 * Chiede il microfono all'utente.
 *
 * NON e' async di proposito: il corpo deve arrivare a `requestStream()` senza
 * mai cedere il controllo, altrimenti l'attivazione del tocco decade.
 *
 * Non riceve piu' lo stato dichiarato dal browser: quello non puo' impedire
 * un tentativo. Viene consultato semmai DOPO un fallimento, solo per scegliere
 * il messaggio.
 */
export function requestMicrophone(
  env: MicEnvironment,
  options: MicRequestOptions = {},
): Promise<MicRequestResult> {
  const force = options.force === true;

  // Gia' verificato in questa sessione: riaprirlo non aggiungerebbe nulla.
  if (options.verified === true && !force) {
    return Promise.resolve({
      outcome: 'permesso',
      usable: true,
      permission: 'permesso',
      permissionRaw: null,
      requested: false,
      errorName: null,
    });
  }
  if (!env.requestStream) {
    return Promise.resolve({
      outcome: 'sconosciuto',
      usable: false,
      permission: 'sconosciuto',
      permissionRaw: null,
      requested: false,
      errorName: null,
    });
  }

  // >>> Nessun await sopra questa riga. E' la riga che apre la finestra. <<<
  const pending = env.requestStream();
  return settle(pending, env);
}

async function settle(
  pending: Promise<StreamLike>,
  env: MicEnvironment,
): Promise<MicRequestResult> {
  try {
    const stream = await pending;
    // Serviva il permesso, non l'audio: il flusso si chiude subito. Niente
    // viene registrato, trattenuto o inviato.
    for (const track of stream.getTracks()) track.stop();
    return {
      outcome: 'permesso',
      usable: true,
      permission: 'permesso',
      permissionRaw: null,
      requested: true,
      errorName: null,
    };
  } catch (error) {
    const name =
      typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name: unknown }).name)
        : '';

    // Nessun microfono: non e' una questione di permessi.
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return {
        outcome: 'assente',
        usable: false,
        permission: 'sconosciuto',
        permissionRaw: null,
        requested: true,
        errorName: name,
      };
    }
    // Il microfono c'e' ma lo sta usando qualcun altro.
    if (name === 'NotReadableError' || name === 'AbortError') {
      return {
        outcome: 'occupato',
        usable: false,
        permission: 'sconosciuto',
        permissionRaw: null,
        requested: true,
        errorName: name,
      };
    }
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === '') {
      // Ora, e SOLO ora, la Permissions API serve a qualcosa: scegliere il
      // messaggio. Si consulta dopo il fallimento, cosi' non puo' avere
      // impedito il tentativo.
      const raw = await readMicPermissionRaw(env);
      return {
        outcome: raw === 'denied' ? 'bloccato' : 'rifiutato',
        usable: false,
        permission: 'negato',
        permissionRaw: raw,
        requested: true,
        errorName: name,
      };
    }
    return {
      outcome: 'sconosciuto',
      usable: false,
      permission: 'sconosciuto',
      permissionRaw: null,
      requested: true,
      errorName: name,
    };
  }
}

/** Messaggio da mostrare. `null` quando non c'e' niente da spiegare. */
export function micMessage(outcome: MicOutcome): string | null {
  switch (outcome) {
    case 'rifiutato':
      // Messaggio neutro: non si afferma cosa abbia fatto l'utente, si dice
      // com'e' adesso e come riprovare.
      return 'Microfono non autorizzato. Tocca VOCE per riprovare.';
    case 'bloccato':
      return 'Microfono bloccato. Riattivalo nelle impostazioni del sito.';
    case 'assente':
      return 'Nessun microfono disponibile su questo dispositivo.';
    case 'occupato':
      return "Microfono occupato da un'altra app. Chiudila e riprova.";
    default:
      return null;
  }
}

/** Ambiente reale del browser. */
export function browserMicEnvironment(): MicEnvironment {
  const media =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator.mediaDevices as
          | { getUserMedia?: (c: { audio: boolean }) => Promise<StreamLike> }
          | undefined);
  const permissions =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator.permissions as
          | { query?: (d: { name: string }) => Promise<{ state: string }> }
          | undefined);

  const query = permissions?.query?.bind(permissions);
  const getUserMedia = media?.getUserMedia?.bind(media);

  return {
    // Nessuna interpretazione qui: si riporta la stringa dell'API cosi' com'e'.
    queryPermission:
      typeof query === 'function'
        ? async () => {
            const result = await query({ name: 'microphone' });
            return String(result.state);
          }
        : null,
    requestStream:
      typeof getUserMedia === 'function' ? () => getUserMedia({ audio: true }) : null,
  };
}
