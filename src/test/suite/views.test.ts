import * as assert from "assert";
import * as vscode from "vscode";
import { afterEach, beforeEach, describe, it } from "mocha";
import { ConnectionManager, ConnectionProfile } from "../../connections/connectionManager";
import { ConnectionsTreeDataProvider } from "../../views/connectionsTree";
import { SchemaTreeDataProvider } from "../../views/schemaTree";

const target = vscode.workspace.workspaceFolders
  ? vscode.ConfigurationTarget.Workspace
  : vscode.ConfigurationTarget.Global;

function createSecretStorage(): vscode.SecretStorage {
  const emitter = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();
  return {
    onDidChange: emitter.event,
    get: async () => undefined,
    store: async () => { },
    delete: async () => { }
  } as unknown as vscode.SecretStorage;
}

async function setProfiles(profiles?: ConnectionProfile[]): Promise<void> {
  const config = vscode.workspace.getConfiguration("dbExplorer");
  await config.update("profiles", profiles, target);
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

describe("ConnectionsTreeDataProvider", () => {
  const secrets = createSecretStorage();
  let previousProfiles: ConnectionProfile[] | undefined;

  beforeEach(async () => {
    const config = vscode.workspace.getConfiguration("dbExplorer");
    previousProfiles = config.get<ConnectionProfile[]>("profiles");
    await setProfiles([]);
  });

  afterEach(async () => {
    await setProfiles(previousProfiles);
  });

  it("shows placeholder items when no profiles exist", async () => {
    const manager = new ConnectionManager(secrets);
    const provider = new ConnectionsTreeDataProvider(manager);

    const children = await provider.getChildren();
    assert.ok(children);
    if (!children) {
      throw new Error("Expected tree items.");
    }
    assert.strictEqual(children.length, 2);
    assert.strictEqual(readLabel(children[0]), "No profiles configured");
    assert.strictEqual(readLabel(children[1]), "Create a connection profile");
  });

  it("lists configured connection profiles", async () => {
    const profiles: ConnectionProfile[] = [
      {
        id: "local",
        label: "Local Postgres",
        host: "localhost",
        port: 5432,
        database: "postgres",
        user: "postgres"
      },
      {
        id: "staging",
        label: "Staging",
        host: "db.example",
        port: 5432,
        database: "app",
        user: "app_user"
      }
    ];

    await setProfiles(profiles);

    const manager = new ConnectionManager(secrets);
    const provider = new ConnectionsTreeDataProvider(manager);

    const children = await provider.getChildren();
    assert.ok(children);
    if (!children) {
      throw new Error("Expected tree items.");
    }
    assert.strictEqual(children.length, profiles.length);
    assert.strictEqual(readLabel(children[0]), "Local Postgres");
    assert.strictEqual(
      children[0].description,
      "postgres@localhost:5432/postgres"
    );
  });

  it("marks the active connection with a plug icon", async () => {
    const profiles: ConnectionProfile[] = [
      {
        id: "local",
        label: "Local Postgres",
        host: "localhost",
        port: 5432,
        database: "postgres",
        user: "postgres"
      },
      {
        id: "staging",
        label: "Staging",
        host: "db.example",
        port: 5432,
        database: "app",
        user: "app_user"
      }
    ];

    await setProfiles(profiles);

    const manager = new ConnectionManager(secrets);
    (manager as unknown as { activeProfileId?: string }).activeProfileId = "local";
    const provider = new ConnectionsTreeDataProvider(manager);

    const children = await provider.getChildren();
    assert.ok(children);
    if (!children) {
      throw new Error("Expected tree items.");
    }

    assert.strictEqual((children[0].iconPath as vscode.ThemeIcon).id, "plug");
    assert.strictEqual((children[1].iconPath as vscode.ThemeIcon).id, "circle-outline");
  });
});

describe("SchemaTreeDataProvider", () => {
  const secrets = createSecretStorage();

  function createProviderWithPool(pool?: FakePool): SchemaTreeDataProvider {
    const manager = new ConnectionManager(secrets);
    (manager as unknown as { getPool: () => unknown }).getPool = () => pool;
    return new SchemaTreeDataProvider(manager);
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
});
