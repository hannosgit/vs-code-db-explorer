import * as vscode from "vscode";

export function getSqlToRun(editor: vscode.TextEditor): string | null {
  const selection = editor.selection;
  const document = editor.document;

  if (!selection.isEmpty) {
    const selected = document.getText(selection).trim();
    return selected.length > 0 ? selected : null;
  }

  const text = document.getText();
  if (text.trim().length === 0) {
    return null;
  }

  const cursorOffset = document.offsetAt(selection.active);
  const startIndex = Math.max(text.lastIndexOf(";", cursorOffset - 1) + 1, 0);
  const endIndex = text.indexOf(";", cursorOffset);
  const sliceEnd = endIndex === -1 ? text.length : endIndex;
  const sql = text.slice(startIndex, sliceEnd).trim();

  return sql.length > 0 ? sql : null;
}

export function getAllSqlToRun(editor: vscode.TextEditor): string | null {
  const sql = editor.document.getText().trim();
  return sql.length > 0 ? sql : null;
}
