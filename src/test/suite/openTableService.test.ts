import * as assert from "assert";
import * as vscode from "vscode";
import { describe, it } from "mocha";
import { ConnectionManager } from "../../connections/connectionManager";
import { OpenTableService } from "../../query/openTableService";

type FakeQueryResult = {
  rows: Record<string, unknown>[];
};

type FakePool = {
  query: (sql: string, params?: unknown[]) => Promise<FakeQueryResult>;
};

function createService(getPool: () => FakePool | undefined = () => undefined): OpenTableService {
  const manager = {
    getPool
  } as unknown as ConnectionManager;
  return new OpenTableService(manager, vscode.Uri.parse("test:/db-explorer"));
}

describe("OpenTableService helpers", () => {
  it("validates table context values", () => {
    const service = createService();
    const toTableContext = (service as unknown as {
      toTableContext: (value: unknown) => { schemaName: string; tableName: string } | undefined;
    }).toTableContext.bind(service);

    assert.strictEqual(toTableContext(undefined), undefined);
    assert.strictEqual(toTableContext("public.users"), undefined);
    assert.strictEqual(toTableContext({ schemaName: "public" }), undefined);
    assert.deepStrictEqual(toTableContext({ schemaName: "public", tableName: "users" }), {
      schemaName: "public",
      tableName: "users"
    });
  });

  it("quotes identifiers and builds open table SQL", () => {
    const service = createService();
    const quoteIdentifier = (service as unknown as {
      quoteIdentifier: (identifier: string) => string;
    }).quoteIdentifier.bind(service);
    const buildOpenTableSql = (service as unknown as {
      buildOpenTableSql: (schemaName: string, tableName: string, limit: number, offset: number) => string;
    }).buildOpenTableSql.bind(service);

    assert.strictEqual(quoteIdentifier('user"name'), '"user""name"');
    assert.strictEqual(
      buildOpenTableSql("public", 'user"name', 101, 0),
      'SELECT ctid::text AS "__postgres_explorer_row_token__", * FROM "public"."user""name" ORDER BY ctid LIMIT 101 OFFSET 0;'
    );
  });

  it("builds update statements and skips invalid updates", () => {
    const service = createService();
    const buildUpdateStatement = (service as unknown as {
      buildUpdateStatement: (
        table: { schemaName: string; tableName: string },
        columns: string[],
        change: {
          kind: "update";
          rowIndex: number;
          updates: { columnIndex: number; value: string; isNull: boolean }[];
        },
        rowToken: string
      ) => { sql: string; values: unknown[] } | undefined;
    }).buildUpdateStatement.bind(service);

    const statement = buildUpdateStatement(
      { schemaName: "public", tableName: "users" },
      ["id", 'display"name'],
      {
        kind: "update",
        rowIndex: 0,
        updates: [
          { columnIndex: 1, value: "Ada", isNull: false },
          { columnIndex: 0, value: "", isNull: true }
        ]
      },
      "(0,1)"
    );

    assert.deepStrictEqual(statement, {
      sql: 'UPDATE "public"."users" SET "display""name" = $1, "id" = $2 WHERE ctid = $3::tid;',
      values: ["Ada", null, "(0,1)"]
    });

    const skipped = buildUpdateStatement(
      { schemaName: "public", tableName: "users" },
      ["id"],
      {
        kind: "update",
        rowIndex: 0,
        updates: [{ columnIndex: 99, value: "x", isNull: false }]
      },
      "(0,2)"
    );
    assert.strictEqual(skipped, undefined);
  });

  it("builds insert statements and deduplicates repeated columns", () => {
    const service = createService();
    const buildInsertStatement = (service as unknown as {
      buildInsertStatement: (
        table: { schemaName: string; tableName: string },
        columns: string[],
        change: {
          kind: "insert";
          values: { columnIndex: number; value: string; isNull: boolean }[];
        }
      ) => { sql: string; values: unknown[] } | undefined;
    }).buildInsertStatement.bind(service);

    const statement = buildInsertStatement(
      { schemaName: "public", tableName: "users" },
      ["id", 'display"name'],
      {
        kind: "insert",
        values: [
          { columnIndex: 1, value: "Ada", isNull: false },
          { columnIndex: 1, value: "Ignored duplicate", isNull: false },
          { columnIndex: 0, value: "", isNull: true },
          { columnIndex: 9, value: "invalid", isNull: false }
        ]
      }
    );

    assert.deepStrictEqual(statement, {
      sql: 'INSERT INTO "public"."users" ("display""name", "id") VALUES ($1, $2);',
      values: ["Ada", null]
    });
  });

  it("formats row values for editor display", () => {
    const service = createService();
    const toEditorRow = (service as unknown as {
      toEditorRow: (row: Record<string, unknown>, columns: string[]) => { values: string[]; nulls: boolean[] };
    }).toEditorRow.bind(service);

    const date = new Date("2024-01-01T00:00:00.000Z");
    const row = toEditorRow(
      {
        empty: null,
        created_at: date,
        payload: Buffer.from("beef", "hex"),
        metadata: { a: 1 },
        count: 7
      },
      ["empty", "created_at", "payload", "metadata", "count"]
    );

    assert.deepStrictEqual(row, {
      values: ["", date.toISOString(), "\\xbeef", "{\"a\":1}", "7"],
      nulls: [true, false, false, false, false]
    });
  });

  it("normalizes page sizes", () => {
    const service = createService();
    const normalizePageSize = (service as unknown as {
      normalizePageSize: (limit: number) => number;
    }).normalizePageSize.bind(service);

    assert.strictEqual(normalizePageSize(200.9), 200);
    assert.strictEqual(normalizePageSize(0), 100);
    assert.strictEqual(normalizePageSize(Number.POSITIVE_INFINITY), 100);
  });

  it("loads column types from postgres metadata", async () => {
    let calledSql = "";
    let calledParams: unknown[] | undefined;
    const pool: FakePool = {
      query: async (sql: string, params?: unknown[]) => {
        calledSql = sql;
        calledParams = params;
        return {
          rows: [
            { column_name: "id", column_type: "integer" },
            { column_name: "name", column_type: "text" }
          ]
        };
      }
    };

    const service = createService(() => pool);
    const loadColumnTypes = (service as unknown as {
      loadColumnTypes: (
        table: { schemaName: string; tableName: string },
        columns: string[]
      ) => Promise<string[]>;
    }).loadColumnTypes.bind(service);

    const types = await loadColumnTypes(
      { schemaName: "public", tableName: "users" },
      ["id", "name", "missing"]
    );

    assert.ok(calledSql.includes("FROM pg_catalog.pg_attribute"));
    assert.deepStrictEqual(calledParams, ["public", "users"]);
    assert.deepStrictEqual(types, ["integer", "text", ""]);
  });

  it("returns empty column types when pool is unavailable or query fails", async () => {
    const serviceNoPool = createService(() => undefined);
    const loadColumnTypesNoPool = (serviceNoPool as unknown as {
      loadColumnTypes: (
        table: { schemaName: string; tableName: string },
        columns: string[]
      ) => Promise<string[]>;
    }).loadColumnTypes.bind(serviceNoPool);

    const noPoolTypes = await loadColumnTypesNoPool(
      { schemaName: "public", tableName: "users" },
      ["id"]
    );
    assert.deepStrictEqual(noPoolTypes, []);

    const serviceWithFailingPool = createService(() => ({
      query: async () => {
        throw new Error("failed");
      }
    }));
    const loadColumnTypesFailing = (serviceWithFailingPool as unknown as {
      loadColumnTypes: (
        table: { schemaName: string; tableName: string },
        columns: string[]
      ) => Promise<string[]>;
    }).loadColumnTypes.bind(serviceWithFailingPool);

    const failingTypes = await loadColumnTypesFailing(
      { schemaName: "public", tableName: "users" },
      ["id", "name"]
    );
    assert.deepStrictEqual(failingTypes, ["", ""]);
  });
});
