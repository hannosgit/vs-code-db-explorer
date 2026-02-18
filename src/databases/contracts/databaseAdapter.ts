import { DatabaseSession } from "./databaseSession";

export interface DatabaseConnectionProfile {
  id: string;
  label: string;
  engine: string;
  host: string;
  port: number;
  database: string;
  user: string;
  [key: string]: unknown;
}

export interface DatabaseSessionCredentials {
  password: string;
}

export interface DatabaseAdapter {
  readonly engine: string;
  createSession(
    profile: DatabaseConnectionProfile,
    credentials: DatabaseSessionCredentials
  ): Promise<DatabaseSession>;
}
