import * as assert from "assert";
import { describe, it } from "mocha";
import { runCancelableQuery, runQuery } from "../../query/queryRunner";

type FakeQueryResult = {
  fields: { name: string }[];
  rows: Record<string, unknown>[];
  rowCount?: number | null;
};

type FakeClient = {
  processID?: number;
  query: (sql: string) => Promise<FakeQueryResult>;
  release: () => void;
};

type FakePool = {
  connect: () => Promise<FakeClient>;
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
};

function createPool(options: {
  result?: FakeQueryResult;
  error?: unknown;
  processId?: number;
  onCancel?: (sql: string, params?: unknown[]) => void;
}): FakePool {
  const client: FakeClient = {
    processID: options.processId,
    query: async () => {
      if (options.error) {
        throw options.error;
      }
      return options.result ?? { fields: [], rows: [], rowCount: 0 };
    },
    release: () => {}
  };

  return {
    connect: async () => client,
    query: async (sql: string, params?: unknown[]) => {
      if (options.onCancel) {
        options.onCancel(sql, params);
      }
      return {};
    }
  };
}

describe("runCancelableQuery", () => {
  it("returns columns, rows, and truncation info", async () => {
    const pool = createPool({
      result: {
        fields: [{ name: "id" }, { name: "name" }],
        rows: [
          { id: 1, name: "Ada" },
          { id: 2, name: "Linus" },
          { id: 3, name: "Grace" }
        ],
        rowCount: 3
      }
    });

    const { promise } = runCancelableQuery(pool as unknown as import("pg").Pool, "SELECT *", 2);
    const result = await promise;

    assert.deepStrictEqual(result.columns, ["id", "name"]);
    assert.strictEqual(result.rows.length, 2);
    assert.strictEqual(result.rowCount, 3);
    assert.strictEqual(result.truncated, true);
    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.error, undefined);
  });

  it("runQuery resolves with query results", async () => {
    const pool = createPool({
      result: {
        fields: [{ name: "value" }],
        rows: [{ value: "ok" }],
        rowCount: 1
      }
    });

    const result = await runQuery(pool as unknown as import("pg").Pool, "SELECT 1");

    assert.deepStrictEqual(result.columns, ["value"]);
    assert.deepStrictEqual(result.rows, [{ value: "ok" }]);
    assert.strictEqual(result.truncated, false);
    assert.strictEqual(result.cancelled, false);
  });

  it("normalizes errors without cancelling", async () => {
    const pool = createPool({
      error: {
        message: "Bad query",
        code: "42P01",
        detail: "missing relation"
      }
    });

    const { promise } = runCancelableQuery(pool as unknown as import("pg").Pool, "SELECT *");
    const result = await promise;

    assert.strictEqual(result.cancelled, false);
    assert.ok(result.error);
    assert.strictEqual(result.error?.message, "Bad query");
    assert.strictEqual(result.error?.code, "42P01");
    assert.strictEqual(result.error?.detail, "missing relation");
  });

  it("flags server-cancelled queries", async () => {
    const pool = createPool({
      error: {
        message: "canceling statement due to user request",
        code: "57014"
      }
    });

    const { promise } = runCancelableQuery(pool as unknown as import("pg").Pool, "SELECT *");
    const result = await promise;

    assert.strictEqual(result.cancelled, true);
    assert.ok(result.error);
    assert.strictEqual(result.error?.message, "Query cancelled.");
  });

  it("sends cancellation to the pool when requested", async () => {
    let cancelSql: string | undefined;
    let cancelParams: unknown[] | undefined;
    let resolveQuery: (value: FakeQueryResult) => void;

    const queryPromise = new Promise<FakeQueryResult>((resolve) => {
      resolveQuery = resolve;
    });

    const pool: FakePool = {
      connect: async () => ({
        processID: 123,
        query: async () => queryPromise,
        release: () => {}
      }),
      query: async (sql: string, params?: unknown[]) => {
        cancelSql = sql;
        cancelParams = params as unknown[] | undefined;
        return {};
      }
    };

    const { promise, cancel } = runCancelableQuery(pool as unknown as import("pg").Pool, "SELECT *");
    const cancelled = await cancel();

    resolveQuery!({ fields: [], rows: [], rowCount: 0 });
    await promise;

    assert.strictEqual(cancelled, true);
    assert.strictEqual(cancelSql, "SELECT pg_cancel_backend($1)");
    assert.deepStrictEqual(cancelParams, [123]);
  });

  it("returns false when cancellation pid is unavailable", async () => {
    let resolveQuery: (value: FakeQueryResult) => void;
    const queryPromise = new Promise<FakeQueryResult>((resolve) => {
      resolveQuery = resolve;
    });

    const pool: FakePool = {
      connect: async () => ({
        query: async () => queryPromise,
        release: () => {}
      }),
      query: async () => ({})
    };

    const { promise, cancel } = runCancelableQuery(pool as unknown as import("pg").Pool, "SELECT *");
    const cancelled = await cancel();
    resolveQuery!({ fields: [], rows: [], rowCount: 0 });
    await promise;

    assert.strictEqual(cancelled, false);
  });

  it("returns false when cancellation query fails", async () => {
    let resolveQuery: (value: FakeQueryResult) => void;
    const queryPromise = new Promise<FakeQueryResult>((resolve) => {
      resolveQuery = resolve;
    });

    const pool: FakePool = {
      connect: async () => ({
        processID: 456,
        query: async () => queryPromise,
        release: () => {}
      }),
      query: async () => {
        throw new Error("cancel failed");
      }
    };

    const { promise, cancel } = runCancelableQuery(pool as unknown as import("pg").Pool, "SELECT *");
    const cancelled = await cancel();
    resolveQuery!({ fields: [], rows: [], rowCount: 0 });
    await promise;

    assert.strictEqual(cancelled, false);
  });

  it("normalizes unknown thrown values", async () => {
    const pool = createPool({
      error: "boom"
    });

    const { promise } = runCancelableQuery(pool as unknown as import("pg").Pool, "SELECT *");
    const result = await promise;

    assert.strictEqual(result.cancelled, false);
    assert.strictEqual(result.error?.message, "Unknown error");
    assert.strictEqual(result.error?.code, undefined);
  });
});
