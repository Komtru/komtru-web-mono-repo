/**
 * PM2 process definitions for the backend.
 *
 * Two processes, not one: `src/index.ts` serves HTTP and Socket.IO, `src/worker.ts` drains the
 * BullMQ queues and runs the scheduler. They share a database and a Redis, and nothing else —
 * running them in one process would put a long notification retry on the same event loop as a
 * trade request.
 *
 * Both read /srv/komtru/.env.backend. That path is the deployment's, not the repository's: the
 * checkout is replaced on every deploy and must never contain secrets. `node --env-file` is
 * used rather than dotenv so the file is read by the runtime before any application code runs.
 *
 * Started by scripts/deploy/deploy.sh; `pm2 reload` on an already-running pair restarts them
 * one at a time, so the API keeps answering through a deploy.
 */
const path = require('node:path');

// APP_HOME is exported by deploy.sh. The fallback only matters if someone runs pm2 by hand.
const appHome = process.env.KOMTRU_APP_HOME || '/srv/komtru';
const envFile = path.join(appHome, '.env.backend');
const cwd = __dirname;

/** Both processes are started the same way; only the entrypoint and the instance count differ. */
const base = {
  cwd,
  interpreter: 'node',
  // --env-file, not --env-file-if-exists: in production a missing environment file is a fault,
  // and failing loudly here beats booting with every secret undefined.
  node_args: [`--env-file=${envFile}`],
  exec_mode: 'fork',
  autorestart: true,
  max_restarts: 10,
  min_uptime: '20s',
  // A process that is still crash-looping after this long is not going to recover on its own.
  restart_delay: 2000,
  kill_timeout: 15000,
  listen_timeout: 20000,
  max_memory_restart: '900M',
  time: true,
  merge_logs: true,
  // Deliberately no `env` block. Node's --env-file does NOT override a variable that is already
  // in the inherited environment, so anything named here silently beats the same key in
  // .env.backend — and the file is meant to be the single source of truth. A `NODE_ENV:
  // 'production'` here cost an afternoon: the env file said development, the process booted
  // production, and the only symptom was `invalid: TRUST_KYC_PROVIDER` in a crash loop.
};

module.exports = {
  apps: [
    {
      ...base,
      name: 'komtru-api',
      script: 'dist/index.js',
      out_file: path.join(appHome, 'logs/api.out.log'),
      error_file: path.join(appHome, 'logs/api.err.log'),
      // The API does not call process.send('ready'), so PM2 treats it as up once the process
      // starts. deploy.sh polls /health/ready afterwards; that, not PM2, is what decides
      // whether a release is good.
      wait_ready: false,
    },
    {
      ...base,
      name: 'komtru-worker',
      script: 'dist/worker.js',
      out_file: path.join(appHome, 'logs/worker.out.log'),
      error_file: path.join(appHome, 'logs/worker.err.log'),
      // Exactly one. The scheduler registers repeatable jobs, and a second copy would register
      // them twice; BullMQ dedupes by key, but the sweep timing stops being predictable.
      instances: 1,
    },
  ],
};
