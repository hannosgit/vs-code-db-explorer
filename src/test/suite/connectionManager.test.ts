import * as assert from "assert";
import * as vscode from "vscode";
import { describe, it } from "mocha";
import {
  ConnectionManager,
  ConnectionProfile
} from "../../connections/connectionManager";
import {
  DatabaseAdapter,
  DatabaseConnectionProfile,
  DatabaseSession,
  DatabaseSessionCredentials
} from "../../databases/contracts";
import { PostgresPoolLike } from "../../databases/postgres/postgresConnectionDriver";

type SpySecretStorage = vscode.SecretStorage & {
  stored?: { key: string; value: string };
  deleted?: string;
};

function createSpySecretStorage(): SpySecretStorage {
  const emitter = new vscode.EventEmitter<vscode.SecretStorageChangeEvent>();

  const storage: SpySecretStorage = {
    onDidChange: emitter.event,
    get: async () => undefined,
    keys: async () => [],
    store: async (key: string, value: string) => {
      storage.stored = { key, value };
    },
    delete: async (key: string) => {
      storage.deleted = key;
    }
  } as SpySecretStorage;

  return storage;
}

describe("ConnectionManager", () => {
  it("stores password using prefixed secret key", async () => {
    const secrets = createSpySecretStorage();
    const manager = new ConnectionManager(secrets);

    await manager.storePassword("local", "pw");

    assert.deepStrictEqual(secrets.stored, {
      key: "dbExplorer.password.local",
      value: "pw"
    });
  });

  it("clears password using prefixed secret key", async () => {
    const secrets = createSpySecretStorage();
    const manager = new ConnectionManager(secrets);

    await manager.clearStoredPassword("local");

    assert.strictEqual(secrets.deleted, "dbExplorer.password.local");
  });

  it("defaults missing profile engine to postgres when listing profiles", () => {
    const workspaceApi = vscode.workspace as unknown as {
      getConfiguration: typeof vscode.workspace.getConfiguration;
    };
    const originalGetConfiguration = workspaceApi.getConfiguration;
    workspaceApi.getConfiguration = (() =>
      ({
        get: () => [
          {
            id: "legacy",
            label: "Legacy",
            host: "localhost",
            port: 5432,
            database: "postgres",
            user: "postgres"
          }
        ]
      }) as unknown as vscode.WorkspaceConfiguration) as typeof vscode.workspace.getConfiguration;

    try {
      const manager = new ConnectionManager(createSpySecretStorage());
      const profiles = manager.listProfiles();
      assert.strictEqual(profiles.length, 1);
      assert.strictEqual(profiles[0].engine, "postgres");
    } finally {
      workspaceApi.getConfiguration = originalGetConfiguration;
    }
  });

  it("defaults missing profile engine to postgres when resolving adapters", async () => {
    let calledProfile: DatabaseConnectionProfile | undefined;
    let calledCredentials: DatabaseSessionCredentials | undefined;
    const fakeSession = createFakeSession();
    const fakeAdapter: DatabaseAdapter = {
      engine: "postgres",
      createSession: async (profile, credentials) => {
        calledProfile = profile;
        calledCredentials = credentials;
        return fakeSession;
      }
    };

    const secrets = createSpySecretStorage();
    secrets.get = async () => "stored-password";
    const manager = new ConnectionManager(secrets, { adapters: [fakeAdapter] });
    setProfilesOnManager(manager, [createProfile({ id: "local" })]);

    await manager.connect("local");

    assert.strictEqual(manager.getActiveProfileId(), "local");
    assert.strictEqual(manager.getSession(), fakeSession);
    assert.strictEqual(calledProfile?.engine, "postgres");
    assert.strictEqual(calledCredentials?.password, "stored-password");
  });

  it("disposes active sessions when disconnecting", async () => {
    let disposed = false;
    const fakeSession = createFakeSession({
      dispose: async () => {
        disposed = true;
      }
    });
    const fakeAdapter: DatabaseAdapter = {
      engine: "postgres",
      createSession: async () => fakeSession
    };

    const secrets = createSpySecretStorage();
    secrets.get = async () => "stored-password";
    const manager = new ConnectionManager(secrets, { adapters: [fakeAdapter] });
    setProfilesOnManager(manager, [createProfile({ id: "local" })]);

    await manager.connect("local");
    await manager.disconnect();

    assert.strictEqual(disposed, true);
    assert.strictEqual(manager.getActiveProfileId(), undefined);
    assert.strictEqual(manager.getSession(), undefined);
  });

  it("returns a compatible pool from sessions that expose getPool", async () => {
    const fakePool: PostgresPoolLike = {
      query: async () => ({}),
      connect: async () => ({
        query: async () => ({}),
        release: () => {}
      }),
      end: async () => {}
    };
    const fakeSession = createFakeSession({
      getPool: () => fakePool
    });
    const fakeAdapter: DatabaseAdapter = {
      engine: "postgres",
      createSession: async () => fakeSession
    };

    const secrets = createSpySecretStorage();
    secrets.get = async () => "stored-password";
    const manager = new ConnectionManager(secrets, { adapters: [fakeAdapter] });
    setProfilesOnManager(manager, [createProfile({ id: "local" })]);

    await manager.connect("local");

    assert.strictEqual(manager.getPool(), fakePool);
  });

  it("throws when no adapter is registered for the profile engine", async () => {
    const secrets = createSpySecretStorage();
    secrets.get = async () => "stored-password";
    const manager = new ConnectionManager(secrets, { adapters: [] });
    setProfilesOnManager(manager, [createProfile({ id: "sqlite", engine: "sqlite" })]);

    await assert.rejects(
      () => manager.connect("sqlite"),
      /No database adapter registered for engine "sqlite"/
    );
  });
});

function setProfilesOnManager(manager: ConnectionManager, profiles: ConnectionProfile[]): void {
  (manager as unknown as { listProfiles: () => ConnectionProfile[] }).listProfiles = () => profiles;
}

function createProfile(overrides: Partial<ConnectionProfile> = {}): ConnectionProfile {
  return {
    id: "profile",
    label: "Profile",
    host: "localhost",
    port: 5432,
    database: "postgres",
    user: "postgres",
    ...overrides
  };
}

function createFakeSession(options: {
  dispose?: () => Promise<void>;
  getPool?: () => PostgresPoolLike;
} = {}): DatabaseSession {
  const dispose = options.dispose ?? (async () => {});
  const session: DatabaseSession = {
    profileId: "profile",
    engine: "postgres",
    schemaProvider: {
      listSchemas: async () => [],
      listTables: async () => [],
      listColumns: async () => [],
      dropTable: async () => {},
      truncateTable: async () => {}
    },
    queryExecutor: {
      run: async () => ({
        sql: "",
        columns: [],
        rows: [],
        rowCount: 0,
        durationMs: 0,
        truncated: false
      }),
      runCancelable: () => ({
        promise: Promise.resolve({
          sql: "",
          columns: [],
          rows: [],
          rowCount: 0,
          durationMs: 0,
          truncated: false
        }),
        cancel: async () => true
      })
    },
    tableDataProvider: {
      loadPage: async () => ({
        table: { schemaName: "public", tableName: "items" },
        columns: [],
        rows: [],
        pageSize: 100,
        pageIndex: 0,
        hasNextPage: false
      }),
      saveChanges: async () => ({ updatedRows: 0, insertedRows: 0 })
    },
    sqlDialect: {
      quoteIdentifier: (identifier: string) => identifier,
      parameterPlaceholder: (position: number) => `$${position}`,
      supportsRowLocator: () => true
    },
    dispose
  };

  if (options.getPool) {
    (session as DatabaseSession & { getPool: () => PostgresPoolLike }).getPool = options.getPool;
  }

  return session;
}
