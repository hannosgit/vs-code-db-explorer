import * as assert from "assert";
import * as vscode from "vscode";
import { afterEach, describe, it } from "mocha";
import { ConnectionProfile } from "../../connections/connectionManager";
import { promptForNewConnection } from "../../connections/createConnectionProfile";

type ShowInputBoxFn = typeof vscode.window.showInputBox;

const originalShowInputBox = vscode.window.showInputBox;

function stubInputBoxes(values: Array<string | undefined>): void {
  let index = 0;
  (vscode.window as unknown as { showInputBox: ShowInputBoxFn }).showInputBox = async () => {
    if (index >= values.length) {
      throw new Error("InputBox requested more values than expected.");
    }

    const value = values[index];
    index += 1;
    return value;
  };
}

function restoreInputBox(): void {
  (vscode.window as unknown as { showInputBox: ShowInputBoxFn }).showInputBox =
    originalShowInputBox;
}

describe("promptForNewConnection", () => {
  afterEach(() => {
    restoreInputBox();
  });

  it("returns undefined when cancelled", async () => {
    stubInputBoxes([undefined]);

    const result = await promptForNewConnection([]);

    assert.strictEqual(result, undefined);
  });

  it("creates a profile with trimmed values and optional password omitted", async () => {
    stubInputBoxes([
      "  Local Postgres  ",
      "  localhost  ",
      "5432",
      "  postgres  ",
      "  postgres  ",
      ""
    ]);

    const result = await promptForNewConnection([]);

    assert.ok(result);
    assert.strictEqual(result?.profile.id, "local-postgres");
    assert.strictEqual(result?.profile.label, "Local Postgres");
    assert.strictEqual(result?.profile.host, "localhost");
    assert.strictEqual(result?.profile.port, 5432);
    assert.strictEqual(result?.profile.database, "postgres");
    assert.strictEqual(result?.profile.user, "postgres");
    assert.strictEqual(result?.password, undefined);
  });

  it("stores password when provided", async () => {
    stubInputBoxes([
      "Production",
      "db.internal",
      "5432",
      "app",
      "app_user",
      "super-secret"
    ]);

    const result = await promptForNewConnection([]);

    assert.ok(result);
    assert.strictEqual(result?.password, "super-secret");
  });

  it("generates a unique profile id when label id already exists", async () => {
    const existingProfiles: ConnectionProfile[] = [
      {
        id: "local-postgres",
        label: "Local Postgres",
        host: "localhost",
        port: 5432,
        database: "postgres",
        user: "postgres"
      }
    ];

    stubInputBoxes([
      "Local Postgres",
      "localhost",
      "5432",
      "postgres",
      "postgres",
      ""
    ]);

    const result = await promptForNewConnection(existingProfiles);

    assert.ok(result);
    assert.strictEqual(result?.profile.id, "local-postgres-2");
  });
});
