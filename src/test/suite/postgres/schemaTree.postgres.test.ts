import * as assert from "assert";
import * as vscode from "vscode";
import { describe, it } from "mocha";
import { ConnectionManager } from "../../../connections/connectionManager";
import { SchemaTreeDataProvider } from "../../../views/schemaTree";

function createSecretStorage(): vscode.SecretStorage {
  const emitter = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();
  return {
    onDidChange: emitter.event,
    get: async () => undefined,
    store: async () => {},
    delete: async () => {}
  } as unknown as vscode.SecretStorage;
}

function readLabel(item: vscode.TreeItem): string {
  if (typeof item.label === "string") {
    return item.label;
  }
  return item.label?.label ?? "";
}

type FakeQueryResult = {
  rows: Record<string, unknown>[];
};

type FakePool = {
  query: (sql: string, params?: unknown[]) => Promise<FakeQueryResult>;
};

describe("SchemaTreeDataProvider", () => {
  const secrets = createSecretStorage();

  function createProviderWithPool(pool?: FakePool): SchemaTreeDataProvider {
    const manager = new ConnectionManager(secrets);
    (manager as unknown as { getPool: () => unknown }).getPool = () => pool;
    return new SchemaTreeDataProvider(manager);
  }

  function patchWindowMessages(stubs: {
    showWarningMessage?: (...args: unknown[]) => Thenable<string | undefined>;
    showInformationMessage?: (...args: unknown[]) => Thenable<string | undefined>;
    showErrorMessage?: (...args: unknown[]) => Thenable<string | undefined>;
  }): () => void {
    const windowApi = vscode.window as unknown as {
      showWarningMessage: (...args: unknown[]) => Thenable<string | undefined>;
      showInformationMessage: (...args: unknown[]) => Thenable<string | undefined>;
      showErrorMessage: (...args: unknown[]) => Thenable<string | undefined>;
    };

    const originalWarning = windowApi.showWarningMessage;
    const originalInfo = windowApi.showInformationMessage;
    const originalError = windowApi.showErrorMessage;

    if (stubs.showWarningMessage) {
      windowApi.showWarningMessage = stubs.showWarningMessage;
    }
    if (stubs.showInformationMessage) {
      windowApi.showInformationMessage = stubs.showInformationMessage;
    }
    if (stubs.showErrorMessage) {
      windowApi.showErrorMessage = stubs.showErrorMessage;
    }

    return () => {
      windowApi.showWarningMessage = originalWarning;
      windowApi.showInformationMessage = originalInfo;
      windowApi.showErrorMessage = originalError;
    };
  }

  it("shows placeholders when no active connection exists", async () => {
    const manager = new ConnectionManager(secrets);
    const provider = new SchemaTreeDataProvider(manager);

    const children = await provider.getChildren();
    assert.ok(children);
    if (!children) {
      throw new Error("Expected tree items.");
    }
    assert.strictEqual(children.length, 2);
    assert.strictEqual(readLabel(children[0]), "No active connection");
    assert.strictEqual(readLabel(children[1]), "Connect to load schema");
  });

  it("loads schema, table, and column nodes", async () => {
    const pool: FakePool = {
      query: async (sql: string, params?: unknown[]) => {
        if (sql.includes("FROM pg_namespace")) {
          return { rows: [{ nspname: "public" }] };
        }

        if (sql.includes("information_schema.tables")) {
          assert.deepStrictEqual(params, ["public"]);
          return { rows: [{ table_name: "users" }] };
        }

        assert.ok(sql.includes("information_schema.columns"));
        assert.deepStrictEqual(params, ["public", "users"]);
        return {
          rows: [
            { column_name: "id", data_type: "integer", is_nullable: "NO" },
            { column_name: "nickname", data_type: "text", is_nullable: "YES" }
          ]
        };
      }
    };

    const provider = createProviderWithPool(pool);

    const schemas = await provider.getChildren();
    assert.ok(schemas);
    if (!schemas) {
      throw new Error("Expected schema nodes.");
    }
    assert.strictEqual(readLabel(schemas[0]), "public");
    assert.strictEqual(schemas[0].contextValue, "dbSchema");

    const tables = await provider.getChildren(schemas[0]);
    assert.ok(tables);
    if (!tables) {
      throw new Error("Expected table nodes.");
    }
    assert.strictEqual(readLabel(tables[0]), "users");
    assert.strictEqual(tables[0].contextValue, "dbTable");

    const columns = await provider.getChildren(tables[0]);
    assert.ok(columns);
    if (!columns) {
      throw new Error("Expected column nodes.");
    }
    assert.strictEqual(readLabel(columns[0]), "id");
    assert.strictEqual(columns[0].description, "integer not null");
    assert.strictEqual(readLabel(columns[1]), "nickname");
    assert.strictEqual(columns[1].description, "text");
    assert.strictEqual(columns[1].contextValue, "dbColumn");
  });

  it("shows empty placeholders for schemas, tables, and columns", async () => {
    const pool: FakePool = {
      query: async (sql: string) => {
        if (sql.includes("FROM pg_namespace")) {
          return { rows: [] };
        }

        if (sql.includes("information_schema.tables")) {
          return { rows: [] };
        }

        return { rows: [] };
      }
    };

    const provider = createProviderWithPool(pool);
    const schemas = await provider.getChildren();
    assert.ok(schemas);
    if (!schemas) {
      throw new Error("Expected schema nodes.");
    }
    assert.strictEqual(readLabel(schemas[0]), "No schemas found");
  });

  it("shows empty table placeholders when schema has no tables", async () => {
    const pool: FakePool = {
      query: async (sql: string) => {
        if (sql.includes("FROM pg_namespace")) {
          return { rows: [{ nspname: "empty_schema" }] };
        }

        if (sql.includes("information_schema.tables")) {
          return { rows: [] };
        }

        return { rows: [] };
      }
    };

    const provider = createProviderWithPool(pool);
    const schemas = await provider.getChildren();
    assert.ok(schemas);
    if (!schemas) {
      throw new Error("Expected schema nodes.");
    }

    const tables = await provider.getChildren(schemas[0]);
    assert.ok(tables);
    if (!tables) {
      throw new Error("Expected table nodes.");
    }
    assert.strictEqual(readLabel(tables[0]), "No tables found");
  });

  it("shows empty column placeholders when table has no columns", async () => {
    const pool: FakePool = {
      query: async (sql: string) => {
        if (sql.includes("FROM pg_namespace")) {
          return { rows: [{ nspname: "public" }] };
        }

        if (sql.includes("information_schema.tables")) {
          return { rows: [{ table_name: "logs" }] };
        }

        return { rows: [] };
      }
    };

    const provider = createProviderWithPool(pool);
    const schemas = await provider.getChildren();
    assert.ok(schemas);
    if (!schemas) {
      throw new Error("Expected schema nodes.");
    }

    const tables = await provider.getChildren(schemas[0]);
    assert.ok(tables);
    if (!tables) {
      throw new Error("Expected table nodes.");
    }

    const columns = await provider.getChildren(tables[0]);
    assert.ok(columns);
    if (!columns) {
      throw new Error("Expected column nodes.");
    }
    assert.strictEqual(readLabel(columns[0]), "No columns found");
  });

  it("renders schema query errors", async () => {
    const provider = createProviderWithPool({
      query: async () => {
        throw new Error("schema failed");
      }
    });

    const children = await provider.getChildren();
    assert.ok(children);
    if (!children) {
      throw new Error("Expected schema nodes.");
    }
    assert.strictEqual(readLabel(children[0]), "Failed to load schemas");
    assert.strictEqual(children[0].description, "schema failed");
    assert.strictEqual(children[0].contextValue, "dbSchemaError");
  });

  it("renders table query errors", async () => {
    const pool: FakePool = {
      query: async (sql: string) => {
        if (sql.includes("FROM pg_namespace")) {
          return { rows: [{ nspname: "public" }] };
        }

        throw new Error("table failed");
      }
    };
    const provider = createProviderWithPool(pool);

    const schemas = await provider.getChildren();
    assert.ok(schemas);
    if (!schemas) {
      throw new Error("Expected schema nodes.");
    }

    const tables = await provider.getChildren(schemas[0]);
    assert.ok(tables);
    if (!tables) {
      throw new Error("Expected table nodes.");
    }
    assert.strictEqual(readLabel(tables[0]), "Failed to load tables for public");
    assert.strictEqual(tables[0].description, "table failed");
  });

  it("renders unknown column query errors", async () => {
    const pool: FakePool = {
      query: async (sql: string) => {
        if (sql.includes("FROM pg_namespace")) {
          return { rows: [{ nspname: "public" }] };
        }

        if (sql.includes("information_schema.tables")) {
          return { rows: [{ table_name: "users" }] };
        }

        throw "column failed";
      }
    };
    const provider = createProviderWithPool(pool);

    const schemas = await provider.getChildren();
    assert.ok(schemas);
    if (!schemas) {
      throw new Error("Expected schema nodes.");
    }
    const tables = await provider.getChildren(schemas[0]);
    assert.ok(tables);
    if (!tables) {
      throw new Error("Expected table nodes.");
    }

    const columns = await provider.getChildren(tables[0]);
    assert.ok(columns);
    if (!columns) {
      throw new Error("Expected column nodes.");
    }
    assert.strictEqual(readLabel(columns[0]), "Failed to load columns for users");
    assert.strictEqual(columns[0].description, "Unknown error");
  });

  it("drops confirmed tables using quoted identifiers", async () => {
    let executedSql = "";
    let infoMessage = "";
    const provider = createProviderWithPool({
      query: async (sql: string) => {
        executedSql = sql;
        return { rows: [] };
      }
    });

    let refreshCount = 0;
    (provider as unknown as { refresh: () => void }).refresh = () => {
      refreshCount += 1;
    };

    const restore = patchWindowMessages({
      showWarningMessage: async (message: unknown) => {
        if (typeof message === "string" && message.startsWith("Drop table ")) {
          return "Drop Table";
        }
        return undefined;
      },
      showInformationMessage: async (message: unknown) => {
        infoMessage = String(message);
        return undefined;
      }
    });

    try {
      await provider.dropTable({ schemaName: 'pub"lic', tableName: 'user"name' });
    } finally {
      restore();
    }

    assert.strictEqual(executedSql, 'DROP TABLE "pub""lic"."user""name"');
    assert.strictEqual(infoMessage, 'Dropped table pub"lic.user"name.');
    assert.strictEqual(refreshCount, 1);
  });

  it("truncates confirmed tables using quoted identifiers", async () => {
    let executedSql = "";
    let infoMessage = "";
    const provider = createProviderWithPool({
      query: async (sql: string) => {
        executedSql = sql;
        return { rows: [] };
      }
    });

    let refreshCount = 0;
    (provider as unknown as { refresh: () => void }).refresh = () => {
      refreshCount += 1;
    };

    const restore = patchWindowMessages({
      showWarningMessage: async (message: unknown) => {
        if (typeof message === "string" && message.startsWith("Truncate table ")) {
          return "Truncate Table";
        }
        return undefined;
      },
      showInformationMessage: async (message: unknown) => {
        infoMessage = String(message);
        return undefined;
      }
    });

    try {
      await provider.truncateTable({ schemaName: 'pub"lic', tableName: 'user"name' });
    } finally {
      restore();
    }

    assert.strictEqual(executedSql, 'TRUNCATE TABLE "pub""lic"."user""name"');
    assert.strictEqual(infoMessage, 'Truncated table pub"lic.user"name.');
    assert.strictEqual(refreshCount, 1);
  });
});
