// API process entrypoint. Run with `node --env-file-if-exists=.env dist/index.js`.
import { runProcess } from './platform/run.js';
import { startApi } from './server.js';

await runProcess(() => startApi(process.env));
