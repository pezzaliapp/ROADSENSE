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
 * LA DISTINZIONE CHE CONTA
 * "non autorizzato adesso" e "bloccato dalle impostazioni" sono due situazioni
 * diverse per chi usa l'app: dalla prima si esce toccando di nuovo VOCE, dalla
 * seconda no. L'unica cosa che le distingue e' cio' che la Permissions API
 * dichiarava PRIMA del tocco. Solo un `denied` gia' noto rimanda alle
 * impostazioni del sito.
 *
 * Cio' che NON si fa: dedurre dal tempo di risposta se la finestra sia
 * comparsa. Sarebbe un'euristica legata a browser e dispositivo, e uno stato
 * semantico dell'app non puo' dipendere da un cronometro.
 */

/** Cio' che il browser dichiara sul permesso, prima di chiederlo. */
export type MicPermission = 'permesso' | 'negato' | 'sconosciuto';

/**
 * Esito di una richiesta.
 *
 *   permesso     concesso: si puo' procedere
 *   rifiutato    autorizzazione non concessa: si puo' richiedere
 *   bloccato     il permesso risultava gia' negato PRIMA del tocco: servono
 *                le impostazioni del sito, ed e' l'UNICO caso in cui dirlo
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
  /** Stato del permesso dopo il tentativo. */
  permission: MicPermission;
  /**
   * `getUserMedia` e' stata effettivamente chiamata.
   * E' un fatto su cio' che ha fatto ROAD SENSE, non una deduzione su cio'
   * che ha mostrato il browser: quello non e' osservabile.
   */
  requested: boolean;
}

interface TrackLike {
  stop(): void;
}
interface StreamLike {
  getTracks(): TrackLike[];
}

export interface MicEnvironment {
  /** Lettura passiva del permesso: non apre nulla e non chiede nulla. */
  queryPermission: (() => Promise<MicPermission>) | null;
  /** La chiamata che provoca la finestra nativa. */
  requestStream: (() => Promise<StreamLike>) | null;
}

/** Legge il permesso senza chiederlo. Non provoca nessuna finestra. */
export async function readMicPermission(env: MicEnvironment): Promise<MicPermission> {
  if (!env.queryPermission) return 'sconosciuto';
  try {
    return await env.queryPermission();
  } catch {
    return 'sconosciuto';
  }
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
export function requestMicrophone(
  env: MicEnvironment,
  known: MicPermission,
): Promise<MicRequestResult> {
  // Gia' concesso: richiederlo aprirebbe il microfono per nulla.
  if (known === 'permesso') {
    return Promise.resolve({ outcome: 'permesso', permission: 'permesso', requested: false });
  }
  // Gia' negato PRIMA del tocco: il browser non mostrerebbe piu' nulla.
  // E' il solo caso in cui le impostazioni del sito sono davvero l'unica via.
  if (known === 'negato') {
    return Promise.resolve({ outcome: 'bloccato', permission: 'negato', requested: false });
  }
  if (!env.requestStream) {
    return Promise.resolve({ outcome: 'sconosciuto', permission: known, requested: false });
  }

  // >>> Nessun await sopra questa riga. E' la riga che apre la finestra. <<<
  const pending = env.requestStream();
  return settle(pending, known);
}

async function settle(
  pending: Promise<StreamLike>,
  known: MicPermission,
): Promise<MicRequestResult> {
  try {
    const stream = await pending;
    // Serviva il permesso, non l'audio: il flusso si chiude subito. Niente
    // viene registrato, trattenuto o inviato.
    for (const track of stream.getTracks()) track.stop();
    return { outcome: 'permesso', permission: 'permesso', requested: true };
  } catch (error) {
    const name =
      typeof error === 'object' && error !== null && 'name' in error
        ? String((error as { name: unknown }).name)
        : '';

    // Nessun microfono: non e' una questione di permessi.
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return { outcome: 'assente', permission: known, requested: true };
    }
    // Il microfono c'e' ma lo sta usando qualcun altro.
    if (name === 'NotReadableError' || name === 'AbortError') {
      return { outcome: 'occupato', permission: known, requested: true };
    }
    if (name === 'NotAllowedError' || name === 'SecurityError' || name === '') {
      // Autorizzazione non concessa. Se sia stata rifiutata a mano o negata
      // dal browser non e' osservabile, e non serve saperlo: da qui si esce
      // toccando di nuovo VOCE. Le impostazioni del sito restano riservate
      // al caso in cui il permesso risultasse gia' negato prima del tocco.
      return { outcome: 'rifiutato', permission: 'negato', requested: true };
    }
    return { outcome: 'sconosciuto', permission: known, requested: true };
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
    queryPermission:
      typeof query === 'function'
        ? async () => {
            const result = await query({ name: 'microphone' });
            // "prompt" NON e' un rifiuto: e' una domanda ancora da fare.
            return result.state === 'granted'
              ? 'permesso'
              : result.state === 'denied'
                ? 'negato'
                : 'sconosciuto';
          }
        : null,
    requestStream:
      typeof getUserMedia === 'function' ? () => getUserMedia({ audio: true }) : null,
  };
}
