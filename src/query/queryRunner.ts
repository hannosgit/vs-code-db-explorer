import { Pool } from "pg";

export interface QueryErrorInfo {
  message: string;
  detail?: string;
  code?: string;
  position?: string;
}

export interface QueryExecutionResult {
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number | null;
  durationMs: number;
  truncated: boolean;
  cancelled?: boolean;
  error?: QueryErrorInfo;
}

export interface CancelableQuery {
  promise: Promise<QueryExecutionResult>;
  cancel: () => Promise<boolean>;
}

export const DEFAULT_ROW_LIMIT = 10000;
const CANCELED_ERROR_CODE = "57014";

export async function runQuery(
  pool: Pool,
  sql: string,
  rowLimit = DEFAULT_ROW_LIMIT
): Promise<QueryExecutionResult> {
  const { promise } = runCancelableQuery(pool, sql, rowLimit);
  return promise;
}

export function runCancelableQuery(
  pool: Pool,
  sql: string,
  rowLimit = DEFAULT_ROW_LIMIT
): CancelableQuery {
  const start = Date.now();
  let canceled = false;
  const clientPromise = pool.connect();

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
      const pid = (client as { processID?: number }).processID;
      if (!pid) {
        return false;
      }
      await pool.query("SELECT pg_cancel_backend($1)", [pid]);
      return true;
    } catch {
      return false;
    }
  };

  return { promise, cancel };
}

function normalizeError(error: unknown): QueryErrorInfo {
  if (error && typeof error === "object") {
    const maybeError = error as { message?: string; detail?: string; code?: string; position?: string };
    return {
      message: maybeError.message ?? "Unknown error",
      detail: maybeError.detail,
      code: maybeError.code,
      position: maybeError.position
    };
  }

  return { message: "Unknown error" };
}

type QueryResultLike = {
  fields?: Array<{ name: string }>;
  rows?: Record<string, unknown>[];
  rowCount?: number | null;
};

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
