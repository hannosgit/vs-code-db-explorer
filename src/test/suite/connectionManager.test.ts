import * as assert from "assert";
import * as vscode from "vscode";
import { describe, it } from "mocha";
import { ConnectionManager } from "../../connections/connectionManager";

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
});
