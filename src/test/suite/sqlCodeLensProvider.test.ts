import * as assert from "assert";
import * as vscode from "vscode";
import { afterEach, describe, it } from "mocha";
import { SqlCodeLensProvider } from "../../query/sqlCodeLensProvider";

describe("SqlCodeLensProvider", () => {
  let editor: vscode.TextEditor | undefined;

  async function openEditor(content: string): Promise<vscode.TextEditor> {
    const document = await vscode.workspace.openTextDocument({
      language: "sql",
      content
    });
    editor = await vscode.window.showTextDocument(document, { preview: false });
    return editor;
  }

  afterEach(async () => {
    if (!editor) {
      return;
    }

    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    editor = undefined;
  });

  it("creates one runnable CodeLens per SQL statement", async () => {
    const textEditor = await openEditor("-- intro\nSELECT 1;\nSELECT 2;");
    const provider = new SqlCodeLensProvider();

    const lenses = provider.provideCodeLenses(textEditor.document);
    assert.strictEqual(lenses.length, 2);
    assert.strictEqual(lenses[0].command?.title, "Run statement");
    assert.strictEqual(lenses[0].command?.command, "dbExplorer.runQuery");
    assert.strictEqual(lenses[1].command?.title, "Run statement");
    assert.strictEqual(lenses[1].command?.command, "dbExplorer.runQuery");
  });
});
