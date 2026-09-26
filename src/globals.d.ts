/**
 * ROAD SENSE - costanti iniettate al momento della build.
 *
 * `__APP_VERSION__` viene sostituita da Vite con la versione dichiarata in
 * `package.json`: e' l'UNICO punto da aggiornare per una release. La stessa
 * costante finisce nell'interfaccia e nel service worker, cosi' non possono
 * divergere.
 *
 * `__APP_COMMIT__` e' il commit breve, ricavato dal servizio di build o dal
 * repository locale. Non si scrive mai a mano: serve a sapere con certezza
 * quale build si ha in mano durante una prova su strada, cosa che la sola
 * versione non permette, perche' molte build diverse la dichiarano identica.
 * Un `+` finale segnala un albero di lavoro con modifiche non committate.
 */
declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;
