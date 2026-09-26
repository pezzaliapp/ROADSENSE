/**
 * ROAD SENSE - COSA POSSO DIRE?
 *
 * ROAD SENSE capisce 39 pericoli diversi. Fino a ieri chi apriva
 * l'applicazione poteva intuire "buca" e nient'altro: tutto il resto era una
 * capacita' reale e invisibile.
 *
 * LA GERARCHIA, CHE E' LA COSA IMPORTANTE
 *
 * Aprendo il pannello si deve capire una cosa sola, in tre secondi: SI PUO'
 * PARLARE, e si puo' dire "buca". Dieci parole, niente altro. Il catalogo
 * completo esiste, ma sta dietro una riga che va toccata apposta: chi vuole
 * approfondire lo trova, chi non vuole non lo incontra.
 *
 * I RIQUADRI NON SONO PULSANTI
 *
 * Le parole di "PROVA A DIRE" sono `span`, non `button`, e non hanno alcun
 * gestore: mostrano cosa si puo' DIRE, non segnalano nulla. Durante la guida
 * ROAD SENSE resta ZERO TOUCH, e una guida che invitasse a toccare lo
 * schermo contraddirebbe l'unica regola che conta.
 *
 * Ogni frase mostrata qui e' verificata contro il parser reale da
 * `voiceGuide.test.ts`: non si promette nulla che il sistema non capisca.
 */

import { useState } from 'react';

import { FAVOURITES, PRECISE_EXAMPLES, VOICE_GUIDE } from './voiceGuide';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function VoiceGuidePanel({ open, onClose }: Props) {
  const [tutto, setTutto] = useState(false);
  if (!open) return null;

  return (
    <div
      className="sheet-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Cosa posso dire"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet guide">
        <h2>COSA POSSO DIRE?</h2>

        <p className="guide-intro">
          Con VOCE attiva e dopo START, parla normalmente. Non devi imparare dei
          comandi.
        </p>

        <div className="guide-label">PROVA A DIRE</div>
        <div className="guide-chips">
          {/* `span`, non `button`: sono esempi, non scorciatoie. */}
          {FAVOURITES.map((parola) => (
            <span className="guide-chip" key={parola}>
              {parola}
            </span>
          ))}
        </div>

        {!tutto && (
          <button className="guide-more" onClick={() => setTutto(true)}>
            Vedi tutto quello che puoi segnalare
          </button>
        )}

        {tutto && (
          <div className="guide-all">
            {VOICE_GUIDE.map((categoria) => (
              <section key={categoria.id}>
                <div className="guide-label">{categoria.title}</div>
                {categoria.items.map((item) => (
                  <div className="guide-item" key={item.say}>
                    <span className="guide-say">“{item.say}”</span>
                    {item.also !== undefined && (
                      <span className="guide-also">
                        oppure {item.also.map((a) => `“${a}”`).join(', ')}
                      </span>
                    )}
                  </div>
                ))}
              </section>
            ))}

            <section>
              <div className="guide-label">PUOI ESSERE PIÙ PRECISO</div>
              <p className="guide-intro">
                Se dici la corsia, viene registrata. Se non la dici, ROAD SENSE non
                la inventa.
              </p>
              {PRECISE_EXAMPLES.map((esempio) => (
                <div className="guide-item" key={esempio.say}>
                  <span className="guide-say">“{esempio.say}”</span>
                </div>
              ))}
            </section>

            <section>
              <div className="guide-label">COME SI USA</div>
              <ol className="guide-steps">
                <li>Attiva VOCE</li>
                <li>Attendi che sia pronta</li>
                <li>Premi START</li>
                <li>Parti</li>
                <li>Da quel momento segnala parlando</li>
              </ol>
            </section>
          </div>
        )}

        <p className="guide-warn">
          Consulta questa guida prima di partire o a veicolo fermo.
        </p>

        <button className="sheet-close" onClick={onClose}>
          CHIUDI
        </button>
      </div>
    </div>
  );
}
