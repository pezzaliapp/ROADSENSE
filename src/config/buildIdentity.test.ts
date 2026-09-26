/**
 * ROAD SENSE - l'identita' della build deve essere vera e deve cambiare.
 *
 * IL PROBLEMA CHE QUESTI TEST PRESIDIANO
 *
 * Per quarantasette commit ROAD SENSE ha dichiarato `0.1.0`. La versione era
 * visibile in alto a sinistra, sembrava un'informazione, e non lo era: aprendo
 * il sito dal telefono non c'era modo di sapere se si stava provando la build
 * di adesso o quella di una settimana prima. Una stringa che non cambia mai non
 * identifica nulla.
 *
 * Adesso l'identita' e' `versione + commit`, e il commit lo scrive la build:
 * niente hash a mano nel sorgente, niente da ricordare prima di un rilascio.
 * Questi test verificano che resti cosi'.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP, BUILD_LABEL } from './config';

const RADICE = process.cwd();
const pkg = JSON.parse(readFileSync(join(RADICE, 'package.json'), 'utf8')) as { version: string };

/** Il commit secondo git, se qui c'e' un repository. */
function commitDiGit(): { sha: string; sporco: boolean } | null {
  try {
    const sha = execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const sporco =
      execFileSync('git', ['status', '--porcelain'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim().length > 0;
    return { sha, sporco };
  } catch {
    return null;
  }
}

describe('identita della build / la versione', () => {
  it('coincide con package.json: un solo punto di verita', () => {
    expect(APP.version).toBe(pkg.version);
  });

  it('e una versione semantica', () => {
    expect(APP.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('non e piu la versione dello scaffolding', () => {
    // `0.1.0` e' il numero assegnato al primo commit del progetto e mai piu'
    // toccato: se ricomparisse, il versioning sarebbe tornato al punto di
    // partenza, cioe' a una stringa che non dice quale build si sta usando.
    expect(APP.version).not.toBe('0.1.0');
  });
});

describe('identita della build / il commit', () => {
  it('e ricavato, non scritto a mano', () => {
    // La costante iniettata deve venire dalla build. Se qualcuno incollasse un
    // hash nel sorgente, questo confronto con git lo smaschererebbe al primo
    // commit successivo.
    const git = commitDiGit();
    if (git === null) {
      expect(APP.commit).toBe('sconosciuto');
      return;
    }
    expect(APP.commit).toBe(git.sporco ? `${git.sha}+` : git.sha);
  });

  it('ha la forma di un commit breve, o dichiara di non saperlo', () => {
    expect(APP.commit).toMatch(/^([0-9a-f]{7}\+?|sconosciuto)$/);
  });

  it('nel sorgente non esiste alcun hash costante', () => {
    // Il requisito e' esplicito: nessun hash scritto a mano. `config.ts` deve
    // limitarsi a esporre la costante della build.
    const config = readFileSync(join(RADICE, 'src', 'config', 'config.ts'), 'utf8');
    expect(config).toContain('commit: __APP_COMMIT__');
    const assegnazioniSospette = /commit:\s*'[0-9a-f]{7,}'/.exec(config);
    expect(assegnazioniSospette).toBeNull();
  });
});

describe('identita della build / cio che si legge a schermo', () => {
  it('unisce versione e commit in una sola etichetta', () => {
    expect(BUILD_LABEL).toBe(`v${APP.version} · ${APP.commit}`);
  });

  it('e leggibile: "v0.0.0 · abcdef0"', () => {
    expect(BUILD_LABEL).toMatch(/^v\d+\.\d+\.\d+ · ([0-9a-f]{7}\+?|sconosciuto)$/);
  });

  it('l interfaccia mostra l etichetta, non solo la versione', () => {
    // Senza il commit la barra tornerebbe a dire una cosa che non identifica
    // la build: e' il difetto da cui si e' partiti.
    const barra = readFileSync(join(RADICE, 'src', 'ui', 'StatusBar.tsx'), 'utf8');
    expect(barra).toContain('BUILD_LABEL');
    expect(barra).not.toContain('v{APP.version}');
  });
});

describe('identita della build / la deriva automatica non puo sparire', () => {
  const vite = readFileSync(join(RADICE, 'vite.config.ts'), 'utf8');

  it('la build ricava il commit dal servizio o dal repository', () => {
    expect(vite).toContain('CF_PAGES_COMMIT_SHA');
    expect(vite).toContain('rev-parse');
  });

  it('entrambe le costanti vengono iniettate', () => {
    expect(vite).toContain('__APP_VERSION__: JSON.stringify(APP_VERSION)');
    expect(vite).toContain('__APP_COMMIT__: JSON.stringify(APP_COMMIT)');
  });

  it('la versione continua a raggiungere il service worker', () => {
    // La logica del service worker non e' stata toccata: si verifica solo che
    // il segnaposto che la build sostituisce sia ancora al suo posto, perche'
    // e' da quello che dipendono i nomi delle cache.
    const sw = readFileSync(join(RADICE, 'public', 'sw.js'), 'utf8');
    expect(sw).toContain('__APP_VERSION__');
  });
});
