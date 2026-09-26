# vosk-browser ricompilato, senza generazione di codice

Questa cartella contiene `vosk-browser` **ricompilato da sorgente**, non il
pacchetto pubblicato su npm. Il file `dist/vosk.js` non è stato modificato a
mano: è l'uscita della compilazione descritta qui sotto.

## Perché

La CSP di ROAD SENSE è:

```
script-src 'self' 'wasm-unsafe-eval'
```

Nessun `'unsafe-eval'`, e non lo vogliamo: concederlo significherebbe permettere
a tutta l'origine — applicazione compresa — di trasformare stringhe in codice.

Il pacchetto pubblicato su npm non può funzionare sotto questa policy. Il
runtime **embind** di Emscripten costruisce i ponti fra JavaScript e C++
scrivendo il corpo della funzione come testo e istanziandolo:

```js
args1.push(invokerFnBody);
var invokerFunction = new_(Function, args1).apply(null, args2);
```

`new_(Function, …)` è una `new Function` indiretta: il costruttore viene passato
come valore. Per questo nel sorgente non compare né `new Function`, né
`Function(`, né `eval` — ed è il motivo per cui la ricerca testuale non l'aveva
trovata. È emersa solo fermando l'eccezione nel worker con il debugger:

```
EvalError: Evaluating a string as JavaScript violates the following
Content Security Policy directive because 'unsafe-eval' is not an
allowed source of script: script-src 'self' 'wasm-unsafe-eval'
   at new_
   at craftInvokerFunction
   at __embind_register_void
```

Emscripten prevede già l'alternativa: con `-s DYNAMIC_EXECUTION=0` embind usa un
invoker costruito con closure invece che con stringhe. **Non è una patch: è un
flag del compilatore.**

## Come rifarla

Serve un runtime di container. Su macOS, **Colima** (non Docker Desktop):

```sh
brew install colima docker
colima start --vm-type=vz --vz-rosetta --cpu 8 --memory 16 --disk 80
```

Su Apple Silicon l'immagine builder è solo amd64: Rosetta la esegue. Aggiungere
`--platform linux/amd64` a ogni comando `docker`.

```sh
git clone --recursive https://github.com/ccoreilly/vosk-browser
cd vosk-browser
```

### Modifica 1 — il flag, in `src/Makefile`

In `LINK_FLAGS`, accanto a `--bind`:

```make
-s DYNAMIC_EXECUTION=0 \
```

È l'unica modifica che riguarda il risultato. Tutto il resto sono riparazioni.

### Modifica 2 — il commit di Kaldi, in `builder/Dockerfile`

Il commit fissato (`6417ac1`, 17-08-2022) **esiste ancora ma è orfano**: la
storia del ramo `vosk` di `alphacep/kaldi` è stata riscritta nel 2024 e nessun
ramo lo raggiunge più. Né `git clone -b vosk --single-branch` né un clone
completo lo trovano: `fatal: reference is not a tree`.

Si recupera chiedendolo per SHA, che GitHub consente:

```dockerfile
RUN git init . && \
    git remote add origin https://github.com/alphacep/kaldi && \
    git fetch --depth 1 origin 6417ac1dece94783e80dfbac0148604685d27579 && \
    git checkout FETCH_HEAD
```

### Costruzione

```sh
docker build --platform linux/amd64 -f builder/Dockerfile -t vosk-wasm-builder:csp-safe builder
docker run --rm --platform linux/amd64 -v "$PWD":/io -w /io vosk-wasm-builder:csp-safe make -C src
cd lib && npm install && npm run build      # produce lib/dist/
```

Il contenuto di `lib/dist/` è ciò che sta in `dist/` qui accanto.

## Tempi, e come non sprecarli

L'immagine builder ha richiesto **ore**, quasi tutte in un punto solo. Nel
`Dockerfile` upstream ogni `make` è parallelo tranne uno:

| | |
|---|---|
| OpenFST | `emmake make -j $(nproc)` |
| **CLAPACK-wasm** | **`make`** — seriale |
| Kaldi | `emmake make -j $(nproc)` |
| zlib, libarchive | `emmake make -j $(nproc)` |

Misurato durante la build: un solo `clang` attivo alla volta, container al 98%
di **un** core su otto. CLAPACK ha occupato quasi tutto il tempo; i sedici step
successivi, Kaldi compreso, sono passati in una decina di minuti.

Aggiungere `-j $(nproc)` a quella riga ridurrebbe le ore a minuti. Non è stato
fatto qui perché avrebbe richiesto di ricostruire l'immagine da zero proprio
mentre la build in corso stava per concludersi.

Su portatile, `caffeinate -dimsu` in un terminale: se il Mac dorme, la VM si
ferma e il tempo si allunga senza che nulla stia effettivamente compilando.

## Verifica del risultato

Sul worker decodificato dal `dist/vosk.js` di questa cartella:

```
new Function      0
eval(             0
eval              0
new_(Function     0     <- la causa, eliminata
SharedArrayBuffer 0     <- niente COOP/COEP, la cartografia non corre rischi
```

E la verifica che conta davvero è a runtime, non testuale: Chrome headless con
la CSP reale di ROAD SENSE deve portare il riconoscitore a `pronto`.

## Licenza

Apache-2.0, come il progetto originale. `vosk-browser` è fermo alla 0.0.8 del
25 dicembre 2022. La versione qui è marcata `0.0.8-csp-safe.1` per distinguerla
dal pacchetto pubblicato, da cui differisce solo per quel flag.
