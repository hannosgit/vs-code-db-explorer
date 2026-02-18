import { Pool } from "pg";
import {
  DatabaseAdapter,
  DatabaseConnectionProfile,
  DatabaseSession,
  DatabaseSessionCredentials
} from "../contracts";
import { PostgresConnectionDriver, PostgresPoolLike } from "./postgresConnectionDriver";
import { PostgresDialect } from "./postgresDialect";
import { PostgresQueryExecutor } from "./postgresQueryExecutor";
import { PostgresSchemaProvider } from "./postgresSchemaProvider";
import { PostgresTableDataProvider } from "./postgresTableDataProvider";

export class PostgresSession implements DatabaseSession {
  readonly profileId: string;
  readonly engine = "postgres";
  readonly schemaProvider: PostgresSchemaProvider;
  readonly queryExecutor: PostgresQueryExecutor;
  readonly tableDataProvider: PostgresTableDataProvider;
  readonly sqlDialect = new PostgresDialect();

  constructor(profileId: string, private readonly driver: PostgresConnectionDriver) {
    this.profileId = profileId;
    this.schemaProvider = new PostgresSchemaProvider(driver, this.sqlDialect);
    this.queryExecutor = new PostgresQueryExecutor(driver);
    this.tableDataProvider = new PostgresTableDataProvider(driver, this.sqlDialect);
  }

  getPool(): PostgresPoolLike {
    return this.driver.getPool();
  }

  async dispose(): Promise<void> {
    await this.driver.end();
  }
}

export class PostgresAdapter implements DatabaseAdapter {
  readonly engine = "postgres";

  async createSession(
    profile: DatabaseConnectionProfile,
    credentials: DatabaseSessionCredentials
  ): Promise<DatabaseSession> {
    if (profile.engine !== this.engine) {
      throw new Error(
        `PostgresAdapter expected engine "${this.engine}" but received "${profile.engine}".`
      );
    }

    const pool = new Pool({
      host: profile.host,
      port: profile.port,
      database: profile.database,
      user: profile.user,
      password: credentials.password,
      application_name: "VS Code DB Explorer"
    });

    try {
      const client = await pool.connect();
      client.release();
    } catch (error) {
      await pool.end();
      throw error;
    }

    const driver = new PostgresConnectionDriver(pool);
    return new PostgresSession(profile.id, driver);
  }
}
