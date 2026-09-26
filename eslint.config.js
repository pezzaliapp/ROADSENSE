import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    // `vendor/` contiene codice di terze parti ricompilato da noi ma non
    // scritto da noi: si versiona l'uscita del compilatore, non la si corregge.
    ignores: ['dist', 'node_modules', 'coverage', 'vendor'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['worker/src/**/*.ts', 'scripts/**/*.mjs', 'vite.config.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node, ...globals.worker },
    },
  },
  {
    files: ['public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
  {
    // Modulo di AudioWorklet del prototipo Fase 0: gira sul thread audio, dove
    // esistono `AudioWorkletProcessor` e `registerProcessor` e non esiste
    // `window`. Non passa dal bundler perche' viene caricato per URL dal
    // contesto audio.
    // Il pacchetto `globals` non ha un insieme per l'AudioWorklet: si
    // dichiarano i soli nomi realmente usati, invece di allargare a `worker`
    // globali che in quel contesto non esistono.
    files: ['public/lab/*.js'],
    languageOptions: {
      globals: {
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
        sampleRate: 'readonly',
        currentTime: 'readonly',
        currentFrame: 'readonly',
      },
    },
  },
);
