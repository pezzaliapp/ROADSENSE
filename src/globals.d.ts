/**
 * ROAD SENSE - costanti iniettate al momento della build.
 *
 * `__APP_VERSION__` viene sostituita da Vite con la versione dichiarata in
 * `package.json`: e' l'UNICO punto da aggiornare per una release. La stessa
 * costante finisce nell'interfaccia e nel service worker, cosi' non possono
 * divergere.
 */
declare const __APP_VERSION__: string;
