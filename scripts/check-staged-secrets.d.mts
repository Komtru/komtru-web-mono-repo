export interface SecretFinding {
  file: string;
  kind: 'KNOWN_VALUE' | 'PATTERN';
}
export declare function loadSecretValues(envPath: string): string[];
export declare function findSecretsInStaged(options: {
  cwd: string;
  secretValues: string[];
}): SecretFinding[];
export declare function formatFindings(findings: SecretFinding[]): string;
