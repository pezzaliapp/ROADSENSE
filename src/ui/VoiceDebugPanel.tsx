/**
 * ROAD SENSE - DEBUG VOCE.
 *
 * Pannello di diagnosi della catena vocale. Esiste per una ragione precisa:
 * quando la voce non parte, "non funziona" non e' una diagnosi. Serve sapere
 * QUALE anello si e' rotto, e sul telefono di chi guida non c'e' una console.
 *
 * REGOLE
 * - Si apre SOLO con ?debugVoice=1. Nell'interfaccia normale non esiste.
 * - Non invia niente da nessuna parte: legge stato gia' presente in memoria.
 * - L'ultima frase resta in memoria e sparisce chiudendo la pagina. Non viene
 *   salvata, non viene trasmessa, non finisce in nessun registro.
 */

import type { VoiceDiagnostics } from '../voice/VoiceProvider';

interface Props {
  diagnostics: VoiceDiagnostics;
}

/** Una riga = un anello della catena. Etichette fisse, per confronto rapido. */
function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="vd-row">
      <span className="vd-label">{label}</span>
      <span className={`vd-value${tone ? ` ${tone}` : ''}`}>{value}</span>
    </div>
  );
}

export function VoiceDebugPanel({ diagnostics }: Props) {
  const { api, mic, phase, local, remote, lastError, lastPhrase } = diagnostics;

  const apiTone = api === 'assente' ? 'bad' : 'ok';
  const micTone = mic === 'permesso' ? 'ok' : mic === 'negato' ? 'bad' : 'warn';
  const phaseTone =
    phase === 'listening' || phase === 'speech' || phase === 'result'
      ? 'ok'
      : phase === 'error'
        ? 'bad'
        : 'warn';
  const localTone = local === 'si' ? 'ok' : 'warn';

  return (
    <section className="voice-debug" role="status" aria-label="Debug voce">
      <div className="vd-title">DEBUG VOCE</div>
      <Row label="API" value={api} tone={apiTone} />
      <Row label="MICROFONO" value={mic} tone={micTone} />
      <Row label="VOCE" value={phase} tone={phaseTone} />
      <Row label="LOCALE" value={local} tone={localTone} />
      <Row label="REMOTO" value={`consenso ${remote ? 'si' : 'no'}`} />
      <Row label="ULTIMO ERRORE" value={lastError ?? '--'} tone={lastError ? 'bad' : ''} />
      <Row label="ULTIMA FRASE" value={lastPhrase ?? '--'} />
      <div className="vd-note">Solo su questo dispositivo. Nessun dato inviato.</div>
    </section>
  );
}
