import * as assert from "assert";
import * as vscode from "vscode";
import { describe, it } from "mocha";

const extensionId = "hannos.db-explorer";

describe("DB Explorer extension", () => {
  it("is registered", () => {
    const extension = vscode.extensions.getExtension(extensionId);
    assert.ok(extension, "Extension not found");
  });

  it("can activate", async () => {
    const extension = vscode.extensions.getExtension(extensionId);
    assert.ok(extension, "Extension not found");

    await extension.activate();
    assert.ok(extension.isActive, "Extension did not activate");
  });

  it("registers core commands", async () => {
    const extension = vscode.extensions.getExtension(extensionId);
    assert.ok(extension, "Extension not found");

    await extension.activate();
    const commands = await vscode.commands.getCommands(true);

    const expected = [
      "dbExplorer.addConnection",
      "dbExplorer.connect",
      "dbExplorer.disconnect",
      "dbExplorer.refreshSchema",
      "dbExplorer.runQuery",
      "dbExplorer.runAllStatements",
      "dbExplorer.openTable",
      "dbExplorer.dropSchema",
      "dbExplorer.dropTable",
      "dbExplorer.truncateTable",
      "dbExplorer.clearPassword"
    ];

    for (const command of expected) {
      assert.ok(commands.includes(command), `Missing command: ${command}`);
    }
  });
});
