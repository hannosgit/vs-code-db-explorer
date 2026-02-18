export interface PostgresPoolLike {
  query(sql: string, params?: unknown[]): Promise<unknown>;
  connect(): Promise<{
    processID?: number;
    query(sql: string, params?: unknown[]): Promise<unknown>;
    release(): void;
  }>;
  end(): Promise<void>;
}

export interface PostgresPoolClient {
  readonly processID?: number;
  query<TResult = unknown>(sql: string, params?: unknown[]): Promise<TResult>;
  release(): void;
}

export class PostgresConnectionDriver {
  constructor(private readonly pool: PostgresPoolLike) {}

  getPool(): PostgresPoolLike {
    return this.pool;
  }

  async query<TResult = unknown>(sql: string, params?: unknown[]): Promise<TResult> {
    if (params) {
      return (await this.pool.query(sql, params)) as TResult;
    }
    return (await this.pool.query(sql)) as TResult;
  }

  async connect(): Promise<PostgresPoolClient> {
    const client = await this.pool.connect();

    return {
      processID: (client as { processID?: number }).processID,
      query: async <TResult = unknown>(sql: string, params?: unknown[]): Promise<TResult> => {
        if (params) {
          return (await client.query(sql, params)) as TResult;
        }
        return (await client.query(sql)) as TResult;
      },
      release: () => {
        client.release();
      }
    };
  }

  async end(): Promise<void> {
    await this.pool.end();
  }
}
