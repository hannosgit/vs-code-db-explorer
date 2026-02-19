import * as assert from "assert";
import * as vscode from "vscode";
import { afterEach, beforeEach, describe, it } from "mocha";
import { ConnectionManager, ConnectionProfile } from "../../connections/connectionManager";
import { SchemaProvider, TableReference } from "../../databases/contracts";
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
    store: async () => {},
    delete: async () => {}
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

function patchWindowInputBox(
  showInputBox: (...args: unknown[]) => Thenable<string | undefined>
): () => void {
  const windowApi = vscode.window as unknown as {
    showInputBox: (...args: unknown[]) => Thenable<string | undefined>;
  };

  const originalInputBox = windowApi.showInputBox;
  windowApi.showInputBox = showInputBox;

  return () => {
    windowApi.showInputBox = originalInputBox;
  };
}

function createProviderWithSession(schemaProvider?: SchemaProvider): SchemaTreeDataProvider {
  const manager = {
    onDidChangeActive: () => ({ dispose: () => {} }),
    getSession: () => (schemaProvider ? { schemaProvider } : undefined),
    getPool: () => undefined
  } as unknown as ConnectionManager;

  return new SchemaTreeDataProvider(manager);
}

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
    assert.strictEqual(children[0].description, "postgres@localhost:5432/postgres");
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

  it("deletes selected connection profiles", async () => {
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

    let deletedSecretKey: string | undefined;
    const emitter = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();
    const trackedSecrets = {
      onDidChange: emitter.event,
      get: async () => undefined,
      store: async () => {},
      delete: async (key: string) => {
        deletedSecretKey = key;
      }
    } as unknown as vscode.SecretStorage;

    const manager = new ConnectionManager(trackedSecrets);
    const provider = new ConnectionsTreeDataProvider(manager);

    let infoMessage = "";
    const restore = patchWindowMessages({
      showWarningMessage: async (message: unknown) => {
        if (typeof message === "string" && message.startsWith("Delete connection ")) {
          return "Delete Connection";
        }
        return undefined;
      },
      showInformationMessage: async (message: unknown) => {
        infoMessage = String(message);
        return undefined;
      }
    });

    try {
      await provider.deleteConnection({ id: "staging" });
    } finally {
      restore();
    }

    const config = vscode.workspace.getConfiguration("dbExplorer");
    const remainingProfiles = config.get<ConnectionProfile[]>("profiles", []);

    assert.strictEqual(remainingProfiles.length, 1);
    assert.strictEqual(remainingProfiles[0].id, "local");
    assert.strictEqual(deletedSecretKey, "dbExplorer.password.staging");
    assert.strictEqual(infoMessage, "Deleted connection Staging.");
  });

  it("disconnects before deleting the active connection", async () => {
    const profiles: ConnectionProfile[] = [
      {
        id: "local",
        label: "Local Postgres",
        host: "localhost",
        port: 5432,
        database: "postgres",
        user: "postgres"
      }
    ];

    await setProfiles(profiles);

    const manager = new ConnectionManager(secrets);
    (manager as unknown as { activeProfileId?: string }).activeProfileId = "local";

    let disconnectCalls = 0;
    const originalDisconnect = manager.disconnect.bind(manager);
    (manager as unknown as { disconnect: () => Promise<void> }).disconnect = async () => {
      disconnectCalls += 1;
      await originalDisconnect();
    };

    const provider = new ConnectionsTreeDataProvider(manager);

    const restore = patchWindowMessages({
      showWarningMessage: async (message: unknown) => {
        if (typeof message === "string" && message.startsWith("Delete connection ")) {
          return "Delete Connection";
        }
        return undefined;
      },
      showInformationMessage: async () => undefined
    });

    try {
      await provider.deleteConnection({ id: "local" });
    } finally {
      restore();
    }

    const config = vscode.workspace.getConfiguration("dbExplorer");
    const remainingProfiles = config.get<ConnectionProfile[]>("profiles", []);

    assert.strictEqual(disconnectCalls, 1);
    assert.strictEqual(remainingProfiles.length, 0);
    assert.strictEqual(manager.getActiveProfileId(), undefined);
  });

  it("updates stored password for selected connection profiles", async () => {
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

    let storedSecretKey: string | undefined;
    let storedSecretValue: string | undefined;
    const emitter = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();
    const trackedSecrets = {
      onDidChange: emitter.event,
      get: async () => undefined,
      store: async (key: string, value: string) => {
        storedSecretKey = key;
        storedSecretValue = value;
      },
      delete: async () => {}
    } as unknown as vscode.SecretStorage;

    const manager = new ConnectionManager(trackedSecrets);
    const provider = new ConnectionsTreeDataProvider(manager);

    let infoMessage = "";
    const restoreMessages = patchWindowMessages({
      showInformationMessage: async (message: unknown) => {
        infoMessage = String(message);
        return undefined;
      }
    });
    const restoreInputBox = patchWindowInputBox(async () => "new-secret");

    try {
      await provider.updateConnectionPassword({ id: "staging" });
    } finally {
      restoreInputBox();
      restoreMessages();
    }

    assert.strictEqual(storedSecretKey, "dbExplorer.password.staging");
    assert.strictEqual(storedSecretValue, "new-secret");
    assert.strictEqual(infoMessage, "Updated stored password for Staging.");
  });
});

describe("SchemaTreeDataProvider contracts", () => {
  function createSchemaProvider(overrides: {
    listSchemas?: () => Promise<{ name: string }[]>;
    listTables?: (schemaName: string) => Promise<{ schemaName: string; name: string }[]>;
    listViews?: (schemaName: string) => Promise<{ schemaName: string; name: string }[]>;
    listColumns?: (table: TableReference) => Promise<{
      schemaName: string;
      tableName: string;
      name: string;
      dataType: string;
      isNullable: boolean;
    }[]>;
    dropSchema?: (schemaName: string) => Promise<void>;
    dropTable?: (table: TableReference) => Promise<void>;
    truncateTable?: (table: TableReference) => Promise<void>;
  } = {}): SchemaProvider {
    return {
      listSchemas: overrides.listSchemas ?? (async () => []),
      listTables: overrides.listTables ?? (async () => []),
      listViews: overrides.listViews ?? (async () => []),
      listColumns: overrides.listColumns ?? (async () => []),
      dropSchema: overrides.dropSchema ?? (async () => {}),
      dropTable: overrides.dropTable ?? (async () => {}),
      truncateTable: overrides.truncateTable ?? (async () => {})
    };
  }

  it("shows placeholders when no active session exists", async () => {
    const provider = createProviderWithSession(undefined);

    const children = await provider.getChildren();
    assert.ok(children);
    if (!children) {
      throw new Error("Expected schema nodes.");
    }

    assert.strictEqual(children.length, 2);
    assert.strictEqual(readLabel(children[0]), "No active connection");
    assert.strictEqual(readLabel(children[1]), "Connect to load schema");
  });

  it("loads schema, tables, views, and column nodes from SchemaProvider", async () => {
    const provider = createProviderWithSession(
      createSchemaProvider({
        listSchemas: async () => [{ name: "public" }],
        listTables: async () => [{ schemaName: "public", name: "users" }],
        listViews: async () => [{ schemaName: "public", name: "active_users" }],
        listColumns: async () => [
          {
            schemaName: "public",
            tableName: "users",
            name: "id",
            dataType: "integer",
            isNullable: false
          },
          {
            schemaName: "public",
            tableName: "users",
            name: "nickname",
            dataType: "text",
            isNullable: true
          }
        ]
      })
    );

    const schemas = await provider.getChildren();
    assert.ok(schemas);
    if (!schemas) {
      throw new Error("Expected schema nodes.");
    }
    assert.strictEqual(readLabel(schemas[0]), "public");

    const collections = await provider.getChildren(schemas[0]);
    assert.ok(collections);
    if (!collections) {
      throw new Error("Expected schema collection nodes.");
    }
    assert.strictEqual(readLabel(collections[0]), "tables");
    assert.strictEqual(readLabel(collections[1]), "views");

    const tables = await provider.getChildren(collections[0]);
    assert.ok(tables);
    if (!tables) {
      throw new Error("Expected table nodes.");
    }
    assert.strictEqual(readLabel(tables[0]), "users");

    const views = await provider.getChildren(collections[1]);
    assert.ok(views);
    if (!views) {
      throw new Error("Expected view nodes.");
    }
    assert.strictEqual(readLabel(views[0]), "active_users");
    assert.strictEqual(views[0].contextValue, "dbView");

    const columns = await provider.getChildren(tables[0]);
    assert.ok(columns);
    if (!columns) {
      throw new Error("Expected column nodes.");
    }
    assert.strictEqual(readLabel(columns[0]), "id");
    assert.strictEqual(columns[0].description, "integer not null");
    assert.strictEqual(readLabel(columns[1]), "nickname");
    assert.strictEqual(columns[1].description, "text");
  });

  it("renders schema provider errors", async () => {
    const provider = createProviderWithSession(
      createSchemaProvider({
        listSchemas: async () => {
          throw new Error("schema failed");
        }
      })
    );

    const children = await provider.getChildren();
    assert.ok(children);
    if (!children) {
      throw new Error("Expected schema nodes.");
    }

    assert.strictEqual(readLabel(children[0]), "Failed to load schemas");
    assert.strictEqual(children[0].description, "schema failed");
    assert.strictEqual(children[0].contextValue, "dbSchemaError");
  });

  it("drops confirmed schemas via SchemaProvider", async () => {
    let droppedSchema: string | undefined;
    const provider = createProviderWithSession(
      createSchemaProvider({
        dropSchema: async (schemaName) => {
          droppedSchema = schemaName;
        }
      })
    );

    let refreshCount = 0;
    (provider as unknown as { refresh: () => void }).refresh = () => {
      refreshCount += 1;
    };

    let infoMessage = "";
    const restore = patchWindowMessages({
      showWarningMessage: async (message: unknown) => {
        if (typeof message === "string" && message.startsWith("Drop schema ")) {
          return "Drop Schema";
        }
        return undefined;
      },
      showInformationMessage: async (message: unknown) => {
        infoMessage = String(message);
        return undefined;
      }
    });

    try {
      await provider.dropSchema({ schemaName: "public" });
    } finally {
      restore();
    }

    assert.strictEqual(droppedSchema, "public");
    assert.strictEqual(infoMessage, "Dropped schema public.");
    assert.strictEqual(refreshCount, 1);
  });

  it("drops confirmed tables via SchemaProvider", async () => {
    let droppedTable: TableReference | undefined;
    const provider = createProviderWithSession(
      createSchemaProvider({
        dropTable: async (table) => {
          droppedTable = table;
        }
      })
    );

    let refreshCount = 0;
    (provider as unknown as { refresh: () => void }).refresh = () => {
      refreshCount += 1;
    };

    let infoMessage = "";
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
      await provider.dropTable({ schemaName: "public", tableName: "users" });
    } finally {
      restore();
    }

    assert.deepStrictEqual(droppedTable, { schemaName: "public", tableName: "users" });
    assert.strictEqual(infoMessage, "Dropped table public.users.");
    assert.strictEqual(refreshCount, 1);
  });

  it("truncates confirmed tables via SchemaProvider", async () => {
    let truncatedTable: TableReference | undefined;
    const provider = createProviderWithSession(
      createSchemaProvider({
        truncateTable: async (table) => {
          truncatedTable = table;
        }
      })
    );

    let refreshCount = 0;
    (provider as unknown as { refresh: () => void }).refresh = () => {
      refreshCount += 1;
    };

    let infoMessage = "";
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
      await provider.truncateTable({ schemaName: "public", tableName: "users" });
    } finally {
      restore();
    }

    assert.deepStrictEqual(truncatedTable, { schemaName: "public", tableName: "users" });
    assert.strictEqual(infoMessage, "Truncated table public.users.");
    assert.strictEqual(refreshCount, 1);
  });
});
