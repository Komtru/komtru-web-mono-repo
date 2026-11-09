export declare const NEW_DATABASE: string;
export declare const RUNTIME_ROLE: string;
export declare const RDS_CA_BUNDLE: string;
export declare const LOCAL_TOPOLOGY: {
  readonly apiPort: string;
  readonly consumerApp: string;
  readonly staffApp: string;
  readonly origins: string;
};
export declare function parseEnv(text: string): Record<string, string>;
export declare function buildBackendEnv(
  sourceText: string,
  options: { target: 'local' | 'rds' },
): { text: string; names: string[] };
export declare function defaultSecretsSource(cwd?: string): string;
