// Vite resolves a side-effect CSS import; TypeScript needs telling that it is a module at all. Only
// `tsconfig.json` sees this file — `tsconfig.build.json` builds `src` alone, so `dist` is unaffected.
declare module '*.css';
