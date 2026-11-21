// Next's compiler resolves a side-effect CSS import; TypeScript needs telling that it is a module
// at all.
declare module '*.css';
