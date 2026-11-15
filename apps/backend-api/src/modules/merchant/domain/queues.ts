// The merchant module's queue names, in `domain/` rather than beside the job: the `jobs/` folder is
// reachable from `module.ts` only (the T-028 boundary scan), and the producer in `infrastructure/` needs the name.
export const COLLECT_EVIDENCE_QUEUE = 'merchant.collect-evidence';
