/**
 * ROAD SENSE - TRACCIA TTS, PANNELLO TEMPORANEO.
 *
 * Serve a rispondere a una domanda sola, sull'iPhone e senza un Mac collegato:
 * quando compare l'avviso e non si sente nulla, l'enunciato E' PARTITO o NO?
 *
 *   TTS REQUEST  "Buca tra 50 metri"  speaking=false pending=false
 *   TTS START    +34 ms
 *   TTS END      +1420 ms              -> e' partito: il guasto e' nell'audio
 *
 *   TTS REQUEST  "Buca tra 50 metri"  speaking=false pending=false
 *   TTS WATCHDOG +2500 ms  NESSUN START -> non e' mai partito: WebKit lo rifiuta
 *
 * Sono due guasti diversi e due riparazioni diverse. Il pannello esiste per
 * distinguerli, e va rimosso insieme a `ttsTrace.ts` quando la risposta c'e'.
 *
 * Non invia niente da nessuna parte: legge un registro in memoria.
 */

import { useSyncExternalStore } from 'react';

import { clearTtsTrace, subscribeTtsTrace, ttsTrace, type TtsTraceKind } from '../speech/ttsTrace';

interface Props {
  onClose: () => void;
}

/** Colore per riconoscere l'esito senza leggere: rosso = non ha parlato. */
const TONO: Record<TtsTraceKind, string> = {
  request: '',
  start: 'ok',
  end: 'ok',
  error: 'bad',
  watchdog: 'warn',
};

export function TtsTracePanel({ onClose }: Props) {
  const eventi = useSyncExternalStore(subscribeTtsTrace, ttsTrace, ttsTrace);

  return (
    <div className="voice-debug tts-trace">
      <div className="vd-title">
        TRACCIA TTS
        <button className="tt-btn" onClick={clearTtsTrace}>
          PULISCI
        </button>
        <button className="tt-btn" onClick={onClose}>
          CHIUDI
        </button>
      </div>

      {eventi.length === 0 ? (
        <div className="vd-note">
          Nessun evento. La traccia si riempie quando ROAD SENSE prova a
          pronunciare un avviso di prossimita&apos;.
        </div>
      ) : (
        eventi.map((e, i) => (
          <div className="vd-row" key={`${i}-${e.kind}-${e.sinceRequestMs}`}>
            <span className="vd-label">
              TTS {e.kind.toUpperCase()}
              {e.kind !== 'request' && ` +${e.sinceRequestMs} ms`}
            </span>
            <span className={`vd-value${TONO[e.kind] ? ` ${TONO[e.kind]}` : ''}`}>
              {e.text !== undefined ? `"${e.text}"` : (e.detail ?? '')}
            </span>
          </div>
        ))
      )}

      {eventi.some((e) => e.kind === 'request') && (
        <div className="vd-note">
          {eventi.some((e) => e.kind === 'start')
            ? 'START ricevuto: la sintesi parte. Se non si sente, il problema e\' nell\'uscita audio.'
            : 'Nessuno START: WebKit non avvia l\'enunciato.'}
        </div>
      )}
    </div>
  );
}
