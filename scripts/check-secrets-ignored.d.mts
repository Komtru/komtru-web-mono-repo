export declare const MUST_BE_IGNORED: string[];
export declare const MUST_BE_TRACKABLE: string[];
export declare function findUnignored(paths: string[], cwd?: string): string[];
export declare function findCommittableSecrets(cwd?: string): string[];
