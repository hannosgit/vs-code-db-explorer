import * as assert from "assert";
import * as vscode from "vscode";
import { describe, it, afterEach } from "mocha";
import { getAllSqlToRun, getSqlFromRange, getSqlStatements, getSqlToRun } from "../../query/sqlText";

describe("getSqlToRun", () => {
  let editor: vscode.TextEditor | undefined;

  async function openEditor(content: string): Promise<vscode.TextEditor> {
    const document = await vscode.workspace.openTextDocument({
      language: "sql",
      content
    });
    editor = await vscode.window.showTextDocument(document, { preview: false });
    return editor;
  }

  async function closeEditor(): Promise<void> {
    if (!editor) {
      return;
    }

    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
    editor = undefined;
  }

  afterEach(async () => {
    await closeEditor();
  });

  it("returns trimmed selection when text is selected", async () => {
    const content = "  SELECT 1  ";
    const textEditor = await openEditor(content);

    const start = new vscode.Position(0, 0);
    const end = new vscode.Position(0, content.length);
    textEditor.selection = new vscode.Selection(start, end);

    const sql = getSqlToRun(textEditor);
    assert.strictEqual(sql, "SELECT 1");
  });

  it("returns null for whitespace-only selections", async () => {
    const content = "   ";
    const textEditor = await openEditor(content);

    const start = new vscode.Position(0, 0);
    const end = new vscode.Position(0, content.length);

    textEditor.selection = new vscode.Selection(start, end);
    const sql = getSqlToRun(textEditor);
    assert.strictEqual(sql, null);
  });

  it("returns the statement around the cursor", async () => {
    const content = "SELECT 1;\nSELECT 2;\nSELECT 3;";
    const textEditor = await openEditor(content);

    const cursor = new vscode.Position(1, 3);
    textEditor.selection = new vscode.Selection(cursor, cursor);

    const sql = getSqlToRun(textEditor);
    assert.strictEqual(sql, "SELECT 2");
  });

  it("returns null for empty documents", async () => {
    const textEditor = await openEditor("\n  \n");
    const cursor = new vscode.Position(0, 0);
    textEditor.selection = new vscode.Selection(cursor, cursor);

    const sql = getSqlToRun(textEditor);
    assert.strictEqual(sql, null);
  });

  it("returns previous statement when cursor is on semicolon", async () => {
    const content = "SELECT 1;SELECT 2;";
    const textEditor = await openEditor(content);

    const cursor = new vscode.Position(0, 8);
    textEditor.selection = new vscode.Selection(cursor, cursor);

    const sql = getSqlToRun(textEditor);
    assert.strictEqual(sql, "SELECT 1");
  });

  it("returns statement after the previous semicolon", async () => {
    const content = "SELECT 1;SELECT 2";
    const textEditor = await openEditor(content);

    const cursor = new vscode.Position(0, 9);
    textEditor.selection = new vscode.Selection(cursor, cursor);

    const sql = getSqlToRun(textEditor);
    assert.strictEqual(sql, "SELECT 2");
  });

  it("returns the full SQL document when running all statements", async () => {
    const textEditor = await openEditor("  SELECT 1;\nSELECT 2;  ");

    const sql = getAllSqlToRun(textEditor);
    assert.strictEqual(sql, "SELECT 1;\nSELECT 2;");
  });

  it("returns null for run-all on empty documents", async () => {
    const textEditor = await openEditor("  \n\t");

    const sql = getAllSqlToRun(textEditor);
    assert.strictEqual(sql, null);
  });

  it("returns SQL from an explicit range", async () => {
    const textEditor = await openEditor("SELECT 1;\nSELECT 2;");
    const range = new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 8));

    const sql = getSqlFromRange(textEditor.document, range);
    assert.strictEqual(sql, "SELECT 2");
  });

  it("returns statements for CodeLens without comment-only chunks", async () => {
    const textEditor = await openEditor("-- heading comment\nSELECT 1;\n/* split */\nSELECT 2;\n-- trailing");
    const statements = getSqlStatements(textEditor.document);

    assert.strictEqual(statements.length, 2);
    assert.strictEqual(statements[0].text, "SELECT 1");
    assert.strictEqual(statements[1].text, "SELECT 2");
  });

  it("ignores semicolons inside strings, comments, and dollar quotes", async () => {
    const textEditor = await openEditor(
      "SELECT ';' AS x;\n" +
        "SELECT 1 /* ; */;\n" +
        "DO $$\nBEGIN\n  RAISE NOTICE ';';\nEND\n$$;\n" +
        "SELECT 3;"
    );

    const statements = getSqlStatements(textEditor.document);
    assert.strictEqual(statements.length, 4);
    assert.strictEqual(statements[0].text, "SELECT ';' AS x");
    assert.strictEqual(statements[1].text, "SELECT 1 /* ; */");
    assert.ok(statements[2].text.startsWith("DO $$"));
    assert.strictEqual(statements[3].text, "SELECT 3");
  });
});
