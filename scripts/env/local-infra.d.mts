export declare const LOCAL_PORTS: Readonly<{
  postgres: number;
  pgbouncer: number;
  redis: number;
  mailpitSmtp: number;
  mailpitUi: number;
}>;
export declare const LOCAL_DATABASE: Readonly<{ name: string; user: string; password: string }>;
export declare const LOCAL_APP_ROLE: Readonly<{ user: string; password: string }>;
export declare const LOCAL_INFRA: Readonly<{
  pooledUrl: string;
  appPooledUrl: string;
  directUrl: string;
  redisUrl: string;
  mailpitUrl: string;
}>;
