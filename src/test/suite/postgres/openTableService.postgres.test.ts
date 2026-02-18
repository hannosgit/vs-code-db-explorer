import * as assert from "assert";
import * as vscode from "vscode";
import { describe, it } from "mocha";
import { ConnectionManager } from "../../../connections/connectionManager";
import { OpenTableService } from "../../../query/openTableService";
import { DataEditorPanel, DataEditorState } from "../../../webviews/dataEditorPanel";
import { ResultsPanel } from "../../../webviews/resultsPanel";

type FakeQueryResult = {
  fields?: Array<{ name: string }>;
  rows: Record<string, unknown>[];
  rowCount?: number | null;
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

function patchWindowMessages(stubs: {
  showWarningMessage?: (...args: unknown[]) => Thenable<string | undefined>;
}): () => void {
  const windowApi = vscode.window as unknown as {
    showWarningMessage: (...args: unknown[]) => Thenable<string | undefined>;
  };
  const originalWarning = windowApi.showWarningMessage;

  if (stubs.showWarningMessage) {
    windowApi.showWarningMessage = stubs.showWarningMessage;
  }

  return () => {
    windowApi.showWarningMessage = originalWarning;
  };
}

function patchDataEditorPanel(states: DataEditorState[]): () => void {
  const dataEditorPanelClass = DataEditorPanel as unknown as {
    createOrShow: (extensionUri: vscode.Uri, viewColumn?: vscode.ViewColumn) => {
      setSaveHandler: (handler?: (changes: unknown[]) => void | Promise<void>) => void;
      setRefreshHandler: (handler?: () => void | Promise<void>) => void;
      setPageHandler: (handler?: (direction: "previous" | "next") => void | Promise<void>) => void;
      setSortHandler: (handler?: (columnIndex: number) => void | Promise<void>) => void;
      showState: (state: DataEditorState) => void;
    };
  };
  const resultsPanelClass = ResultsPanel as unknown as {
    getViewColumn: () => vscode.ViewColumn | undefined;
    disposeCurrentPanel: () => void;
  };

  const originalCreateOrShow = dataEditorPanelClass.createOrShow;
  const originalGetViewColumn = resultsPanelClass.getViewColumn;
  const originalDisposeCurrentPanel = resultsPanelClass.disposeCurrentPanel;

  dataEditorPanelClass.createOrShow = () => ({
    setSaveHandler: () => {},
    setRefreshHandler: () => {},
    setPageHandler: () => {},
    setSortHandler: () => {},
    showState: (state: DataEditorState) => {
      states.push(state);
    }
  });
  resultsPanelClass.getViewColumn = () => undefined;
  resultsPanelClass.disposeCurrentPanel = () => {};

  return () => {
    dataEditorPanelClass.createOrShow = originalCreateOrShow;
    resultsPanelClass.getViewColumn = originalGetViewColumn;
    resultsPanelClass.disposeCurrentPanel = originalDisposeCurrentPanel;
  };
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
      buildOpenTableSql: (
        schemaName: string,
        tableName: string,
        limit: number,
        offset: number,
        sortBy?: { columnName: string; direction: "asc" | "desc" }
      ) => string;
    }).buildOpenTableSql.bind(service);

    assert.strictEqual(quoteIdentifier('user"name'), '"user""name"');
    assert.strictEqual(
      buildOpenTableSql("public", 'user"name', 101, 0),
      'SELECT ctid::text AS "__postgres_explorer_row_token__", * FROM "public"."user""name" ORDER BY ctid LIMIT 101 OFFSET 0;'
    );
    assert.strictEqual(
      buildOpenTableSql("public", "users", 101, 0, {
        columnName: 'display"name',
        direction: "desc"
      }),
      'SELECT ctid::text AS "__postgres_explorer_row_token__", * FROM "public"."users" ORDER BY "display""name" DESC, ctid LIMIT 101 OFFSET 0;'
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

  it("builds delete statements and skips empty row locators", () => {
    const service = createService();
    const buildDeleteStatement = (service as unknown as {
      buildDeleteStatement: (
        table: { schemaName: string; tableName: string },
        change: {
          kind: "delete";
          rowIndex: number;
        },
        rowToken: string
      ) => { sql: string; values: unknown[] } | undefined;
    }).buildDeleteStatement.bind(service);

    const statement = buildDeleteStatement(
      { schemaName: "public", tableName: "users" },
      { kind: "delete", rowIndex: 0 },
      "(0,7)"
    );
    assert.deepStrictEqual(statement, {
      sql: 'DELETE FROM "public"."users" WHERE ctid = $1::tid;',
      values: ["(0,7)"]
    });

    const skipped = buildDeleteStatement(
      { schemaName: "public", tableName: "users" },
      { kind: "delete", rowIndex: 0 },
      ""
    );
    assert.strictEqual(skipped, undefined);
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

  it("loads enum values from postgres metadata", async () => {
    let calledSql = "";
    let calledParams: unknown[] | undefined;
    const pool: FakePool = {
      query: async (sql: string, params?: unknown[]) => {
        calledSql = sql;
        calledParams = params;
        return {
          rows: [
            { column_name: "status", enum_value: "draft" },
            { column_name: "status", enum_value: "published" },
            { column_name: "priority", enum_value: "low" },
            { column_name: "priority", enum_value: "high" }
          ]
        };
      }
    };

    const service = createService(() => pool);
    const loadColumnEnumValues = (service as unknown as {
      loadColumnEnumValues: (
        table: { schemaName: string; tableName: string },
        columns: string[]
      ) => Promise<string[][]>;
    }).loadColumnEnumValues.bind(service);

    const enumValues = await loadColumnEnumValues(
      { schemaName: "public", tableName: "posts" },
      ["id", "status", "priority", "missing"]
    );

    assert.ok(calledSql.includes("FROM pg_catalog.pg_attribute"));
    assert.ok(calledSql.includes("JOIN pg_catalog.pg_enum"));
    assert.deepStrictEqual(calledParams, ["public", "posts"]);
    assert.deepStrictEqual(enumValues, [[], ["draft", "published"], ["low", "high"], []]);
  });

  it("returns empty enum values when pool is unavailable or query fails", async () => {
    const serviceNoPool = createService(() => undefined);
    const loadColumnEnumValuesNoPool = (serviceNoPool as unknown as {
      loadColumnEnumValues: (
        table: { schemaName: string; tableName: string },
        columns: string[]
      ) => Promise<string[][]>;
    }).loadColumnEnumValues.bind(serviceNoPool);

    const noPoolValues = await loadColumnEnumValuesNoPool(
      { schemaName: "public", tableName: "users" },
      ["id"]
    );
    assert.deepStrictEqual(noPoolValues, []);

    const serviceWithFailingPool = createService(() => ({
      query: async () => {
        throw new Error("failed");
      }
    }));
    const loadColumnEnumValuesFailing = (serviceWithFailingPool as unknown as {
      loadColumnEnumValues: (
        table: { schemaName: string; tableName: string },
        columns: string[]
      ) => Promise<string[][]>;
    }).loadColumnEnumValues.bind(serviceWithFailingPool);

    const failingValues = await loadColumnEnumValuesFailing(
      { schemaName: "public", tableName: "users" },
      ["id", "status"]
    );
    assert.deepStrictEqual(failingValues, [[], []]);
  });
});

describe("OpenTableService open contract", () => {
  it("warns when opening a table without an active connection", async () => {
    let warningMessage = "";
    const restoreWindow = patchWindowMessages({
      showWarningMessage: async (message: unknown) => {
        warningMessage = String(message);
        return undefined;
      }
    });

    try {
      const service = createService(() => undefined);
      await service.open({ schemaName: "public", tableName: "users" });
    } finally {
      restoreWindow();
    }

    assert.strictEqual(warningMessage, "Connect to a DB profile first.");
  });

  it("shows loading state before rendering loaded rows", async () => {
    const states: DataEditorState[] = [];
    const issuedQueries: Array<{ sql: string; params?: unknown[] }> = [];
    const restorePanel = patchDataEditorPanel(states);

    const pool: FakePool = {
      query: async (sql: string, params?: unknown[]) => {
        issuedQueries.push({ sql, params });
        if (sql.startsWith("SELECT ctid::text AS")) {
          return {
            fields: [
              { name: "__postgres_explorer_row_token__" },
              { name: "id" },
              { name: "name" }
            ],
            rows: [{ __postgres_explorer_row_token__: "(0,1)", id: 1, name: "Ada" }]
          };
        }

        if (sql.includes("format_type")) {
          return {
            rows: [
              { column_name: "id", column_type: "integer" },
              { column_name: "name", column_type: "text" }
            ]
          };
        }

        if (sql.includes("enumlabel")) {
          return { rows: [] };
        }

        throw new Error(`Unexpected SQL: ${sql}`);
      }
    };

    try {
      const service = createService(() => pool);
      await service.open({ schemaName: "public", tableName: "users" });
    } finally {
      restorePanel();
    }

    assert.strictEqual(states.length, 2);
    assert.strictEqual(states[0].loading, true);
    assert.deepStrictEqual(states[1].columns, ["id", "name"]);
    assert.deepStrictEqual(states[1].columnTypes, ["integer", "text"]);
    assert.deepStrictEqual(states[1].columnEnumValues, [[], []]);
    assert.deepStrictEqual(states[1].rows, [{ values: ["1", "Ada"], nulls: [false, false] }]);
    assert.strictEqual(states[1].hasNextPage, false);
    assert.ok(issuedQueries[0].sql.includes('FROM "public"."users"'));
    assert.ok(issuedQueries[0].sql.includes("LIMIT 101 OFFSET 0"));
  });
});
