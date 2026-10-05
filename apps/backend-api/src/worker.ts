// Worker process entrypoint. Run with `node --env-file-if-exists=.env dist/worker.js`.
import { runProcess } from './platform/run.js';
import { startWorker } from './worker-process.js';

await runProcess(() => startWorker(process.env));
