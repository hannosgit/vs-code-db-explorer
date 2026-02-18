import {
  CancelableQuery,
  QueryErrorInfo,
  QueryExecutionResult,
  QueryExecutor,
  QueryRunOptions
} from "../contracts";
import { PostgresConnectionDriver } from "./postgresConnectionDriver";

export const DEFAULT_ROW_LIMIT = 10000;
const CANCELED_ERROR_CODE = "57014";

type QueryResultLike = {
  fields?: Array<{ name: string }>;
  rows?: Record<string, unknown>[];
  rowCount?: number | null;
};

export class PostgresQueryExecutor implements QueryExecutor {
  constructor(private readonly driver: PostgresConnectionDriver) {}

  async run(sql: string, options?: QueryRunOptions): Promise<QueryExecutionResult> {
    const { promise } = this.runCancelable(sql, options);
    return promise;
  }

  runCancelable(sql: string, options?: QueryRunOptions): CancelableQuery {
    const rowLimit = this.resolveRowLimit(options?.rowLimit);
    const start = Date.now();
    let canceled = false;
    const clientPromise = this.driver.connect();

    const promise = (async (): Promise<QueryExecutionResult> => {
      let client: Awaited<typeof clientPromise> | undefined;
      try {
        client = await clientPromise;
        const result = normalizeQueryResult(await client.query(sql));
        const durationMs = Date.now() - start;
        const columns = result.fields.map((field) => field.name);
        let rows = result.rows;
        let truncated = false;

        if (rows.length > rowLimit) {
          rows = rows.slice(0, rowLimit);
          truncated = true;
        }

        return {
          sql,
          columns,
          rows,
          rowCount: typeof result.rowCount === "number" ? result.rowCount : null,
          durationMs,
          truncated,
          cancelled: false
        };
      } catch (error) {
        const durationMs = Date.now() - start;
        const normalized = normalizeError(error);
        const cancelled = canceled || normalized.code === CANCELED_ERROR_CODE;
        const message = cancelled ? "Query cancelled." : normalized.message;

        return {
          sql,
          columns: [],
          rows: [],
          rowCount: null,
          durationMs,
          truncated: false,
          cancelled,
          error: { ...normalized, message }
        };
      } finally {
        if (client) {
          client.release();
        }
      }
    })();

    const cancel = async (): Promise<boolean> => {
      canceled = true;
      try {
        const client = await clientPromise;
        const pid = client.processID;
        if (!pid) {
          return false;
        }
        await this.driver.query("SELECT pg_cancel_backend($1)", [pid]);
        return true;
      } catch {
        return false;
      }
    };

    return { promise, cancel };
  }

  private resolveRowLimit(rowLimit?: number): number {
    if (typeof rowLimit !== "number") {
      return DEFAULT_ROW_LIMIT;
    }

    if (!Number.isFinite(rowLimit) || rowLimit <= 0) {
      return DEFAULT_ROW_LIMIT;
    }

    return Math.floor(rowLimit);
  }
}

function normalizeError(error: unknown): QueryErrorInfo {
  if (error && typeof error === "object") {
    const maybeError = error as {
      message?: string;
      detail?: string;
      code?: string;
      position?: string;
    };

    return {
      message: maybeError.message ?? "Unknown error",
      detail: maybeError.detail,
      code: maybeError.code,
      position: maybeError.position
    };
  }

  return { message: "Unknown error" };
}

function normalizeQueryResult(result: unknown): {
  fields: Array<{ name: string }>;
  rows: Record<string, unknown>[];
  rowCount: number | null;
} {
  const lastResult = Array.isArray(result) ? result[result.length - 1] : result;
  if (!lastResult || typeof lastResult !== "object") {
    return {
      fields: [],
      rows: [],
      rowCount: null
    };
  }

  const maybeResult = lastResult as QueryResultLike;
  return {
    fields: Array.isArray(maybeResult.fields) ? maybeResult.fields : [],
    rows: Array.isArray(maybeResult.rows) ? maybeResult.rows : [],
    rowCount: typeof maybeResult.rowCount === "number" ? maybeResult.rowCount : null
  };
}
