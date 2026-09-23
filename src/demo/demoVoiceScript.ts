/**
 * ROAD SENSE - frasi recitate dalla voce simulata in DEMO MODE.
 *
 * Servono a mostrare la catena completa senza dover parlare:
 *   voce -> parser -> evento non confermato -> conferma -> avviso.
 *
 * Sono frasi SIMULATE, e la demo lo dichiara. Non c'e' alcun microfono
 * acceso e nessun audio lascia il dispositivo.
 */

import type { ScriptedPhrase } from '../voice/DemoVoiceProvider';

export const DEMO_VOICE_SCRIPT: readonly ScriptedPhrase[] = [
  // Il conducente detta una segnalazione poco dopo la partenza: si vede la
  // conferma visiva non interattiva, senza toccare il telefono.
  { atMs: 6000, text: 'ROAD SENSE, ostacolo in corsia' },
];
