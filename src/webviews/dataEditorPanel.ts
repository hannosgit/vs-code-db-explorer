import * as vscode from "vscode";

export interface EditorRow {
  values: string[];
  nulls: boolean[];
}

export interface DataEditorState {
  schemaName: string;
  tableName: string;
  columns: string[];
  rows: EditorRow[];
  rowLimit: number;
  loading?: boolean;
  error?: string;
}

export interface DataEditorCellUpdate {
  columnIndex: number;
  value: string;
  isNull: boolean;
}

export interface DataEditorUpdateChange {
  kind: "update";
  rowIndex: number;
  updates: DataEditorCellUpdate[];
}

export interface DataEditorInsertChange {
  kind: "insert";
  values: DataEditorCellUpdate[];
}

export type DataEditorChange = DataEditorUpdateChange | DataEditorInsertChange;

type SaveHandler = (changes: DataEditorChange[]) => void | Promise<void>;
type RefreshHandler = () => void | Promise<void>;

export class DataEditorPanel {
  private static currentPanel: DataEditorPanel | undefined;
  private saveHandler?: SaveHandler;
  private refreshHandler?: RefreshHandler;

  static createOrShow(
    extensionUri: vscode.Uri,
    viewColumn?: vscode.ViewColumn
  ): DataEditorPanel {
    if (DataEditorPanel.currentPanel) {
      DataEditorPanel.currentPanel.panel.reveal();
      return DataEditorPanel.currentPanel;
    }

    const column = viewColumn ?? vscode.ViewColumn.Beside;
    const panel = vscode.window.createWebviewPanel(
      "postgresDataEditor",
      "Postgres Data Editor",
      column,
      { enableScripts: true }
    );

    DataEditorPanel.currentPanel = new DataEditorPanel(panel, extensionUri);
    return DataEditorPanel.currentPanel;
  }

  static getViewColumn(): vscode.ViewColumn | undefined {
    return DataEditorPanel.currentPanel?.panel.viewColumn;
  }

  static disposeCurrentPanel(): void {
    const panel = DataEditorPanel.currentPanel?.panel;
    DataEditorPanel.currentPanel = undefined;
    panel?.dispose();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri
  ) {
    void this.extensionUri;
    this.panel.onDidDispose(() => {
      if (DataEditorPanel.currentPanel === this) {
        DataEditorPanel.currentPanel = undefined;
      }
    });

    this.panel.webview.onDidReceiveMessage((message) => {
      if (!message || typeof message !== "object") {
        return;
      }

      if (message.command === "save" && this.saveHandler) {
        void this.saveHandler(message.changes ?? []);
      }

      if (message.command === "refresh" && this.refreshHandler) {
        void this.refreshHandler();
      }
    });
  }

  setSaveHandler(handler?: SaveHandler): void {
    this.saveHandler = handler;
  }

  setRefreshHandler(handler?: RefreshHandler): void {
    this.refreshHandler = handler;
  }

  showState(state: DataEditorState): void {
    this.panel.title = `Data Editor: ${state.schemaName}.${state.tableName}`;
    this.panel.webview.html = buildHtml(state);
  }
}

function buildHtml(state: DataEditorState): string {
  const safeState = JSON.stringify(state).replace(/</g, "\\u003c");
  const headerTitle = `${escapeHtml(state.schemaName)}.${escapeHtml(state.tableName)}`;
  const rowCount = state.rows.length;
  const rowSummary =
    rowCount >= state.rowLimit
      ? `Showing first ${rowCount} rows (limit ${state.rowLimit}).`
      : `${rowCount} rows loaded.`;
  const addRowDisabled = state.loading || !!state.error || state.columns.length === 0;
  const body = state.loading
    ? `<div class="empty">Loading table data...</div>`
    : state.error
      ? `<div class="error">${escapeHtml(state.error)}</div>`
      : renderTableShell(state.columns);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Postgres Data Editor</title>
  <style>
    :root {
      color-scheme: light dark;
    }
    body {
      margin: 0;
      font-family: var(--vscode-font-family);
      font-size: 12px;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
    }
    header {
      padding: 12px 16px;
      border-bottom: 1px solid var(--vscode-editorWidget-border);
      background: var(--vscode-editorWidget-background);
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      justify-content: space-between;
    }
    header .title {
      font-weight: 600;
    }
    header .meta {
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
    }
    .actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    button {
      font: inherit;
      padding: 4px 10px;
      border-radius: 4px;
      border: 1px solid var(--vscode-button-border, transparent);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      border-color: var(--vscode-button-secondaryBorder, transparent);
    }
    button:disabled {
      opacity: 0.6;
      cursor: default;
    }
    .note {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      padding: 6px 16px 0;
    }
    .table-wrap {
      padding: 0 16px 16px;
      overflow: auto;
      max-height: calc(100vh - 140px);
    }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      border: 1px solid var(--vscode-editorWidget-border);
      text-align: left;
      vertical-align: top;
      padding: 0;
    }
    th {
      background: var(--vscode-editorWidget-background);
      position: sticky;
      top: 0;
      z-index: 1;
      padding: 6px 8px;
      font-weight: 600;
    }
    td input {
      width: 100%;
      box-sizing: border-box;
      border: none;
      background: transparent;
      color: inherit;
      padding: 6px 8px;
      font: inherit;
    }
    td input:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }
    td input.is-null {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    td input.dirty {
      background: var(--vscode-editor-wordHighlightBackground);
    }
    tr.new-row td {
      background: var(--vscode-editor-inactiveSelectionBackground, rgba(127, 127, 127, 0.12));
    }
    .empty, .error {
      padding: 16px;
      color: var(--vscode-descriptionForeground);
    }
    .error {
      color: var(--vscode-errorForeground);
    }
  </style>
</head>
<body>
  <header>
    <div>
      <div class="title">Data Editor - ${headerTitle}</div>
      <div class="meta">${rowSummary}</div>
    </div>
    <div class="actions">
      <button id="add-row" class="secondary"${addRowDisabled ? " disabled" : ""}>Add row</button>
      <button id="save" disabled>Save</button>
      <button id="revert" class="secondary" disabled>Revert</button>
      <button id="refresh" class="secondary">Refresh</button>
    </div>
  </header>
  <div class="note">Tip: use <strong>Add row</strong> to insert and type <strong>NULL</strong> to set a value to NULL.</div>
  ${body}
  <script>
    const state = ${safeState};
    const vscode = acquireVsCodeApi();
    const addRowButton = document.getElementById("add-row");
    const saveButton = document.getElementById("save");
    const revertButton = document.getElementById("revert");
    const refreshButton = document.getElementById("refresh");
    const inputs = [];
    const originalRows = state.rows.map((row) => ({
      values: [...row.values],
      nulls: [...row.nulls]
    }));
    let workingRows = originalRows.map((row) => ({
      values: [...row.values],
      nulls: [...row.nulls],
      isNew: false
    }));

    if (refreshButton) {
      refreshButton.addEventListener("click", () => {
        vscode.postMessage({ command: "refresh" });
      });
    }

    function createEmptyRow() {
      return {
        values: state.columns.map(() => ""),
        nulls: state.columns.map(() => false),
        isNew: true
      };
    }

    function computeCellValue(raw, baselineNull) {
      const trimmed = raw.trim();
      const isNull = trimmed.toLowerCase() === "null" || (trimmed === "" && baselineNull);
      return { value: raw, isNull };
    }

    function isCellDirty(rowIndex, columnIndex) {
      const row = workingRows[rowIndex];
      if (!row) {
        return false;
      }

      const value = row.values[columnIndex] ?? "";
      const isNull = row.nulls[columnIndex] === true;
      if (row.isNew) {
        return isNull || value !== "";
      }

      const originalRow = originalRows[rowIndex];
      if (!originalRow) {
        return isNull || value !== "";
      }

      const originalValue = originalRow.values[columnIndex] ?? "";
      const originalNull = originalRow.nulls[columnIndex] === true;
      return isNull !== originalNull || (!isNull && value !== originalValue);
    }

    function updateDirtyState() {
      const dirtyCount = inputs.filter((input) => input.classList.contains("dirty")).length;
      if (saveButton) {
        saveButton.disabled = dirtyCount === 0;
      }
      if (revertButton) {
        revertButton.disabled = dirtyCount === 0;
      }
    }

    function inputAt(rowIndex, columnIndex) {
      const columnsCount = state.columns.length;
      const index = rowIndex * columnsCount + columnIndex;
      return inputs[index];
    }

    function renderTable(focusRowIndex) {
      const table = document.getElementById("data-table");
      if (!table) {
        return;
      }
      const tbody = table.querySelector("tbody");
      if (!tbody) {
        return;
      }
      tbody.innerHTML = "";
      inputs.length = 0;

      workingRows.forEach((row, rowIndex) => {
        const tr = document.createElement("tr");
        if (row.isNew) {
          tr.classList.add("new-row");
        }
        state.columns.forEach((_, columnIndex) => {
          const td = document.createElement("td");
          const input = document.createElement("input");
          const value = row.values[columnIndex] ?? "";
          const isNull = row.nulls[columnIndex] === true;
          input.value = value;
          input.dataset.row = String(rowIndex);
          input.dataset.column = String(columnIndex);
          input.classList.toggle("dirty", isCellDirty(rowIndex, columnIndex));
          input.classList.toggle("is-null", isNull);
          if (isNull) {
            input.placeholder = "null";
          } else {
            input.placeholder = "";
          }
          input.addEventListener("input", () => {
            const baselineNull = row.isNew
              ? false
              : originalRows[rowIndex]?.nulls[columnIndex] === true;
            const next = computeCellValue(input.value, baselineNull);
            row.values[columnIndex] = next.value;
            row.nulls[columnIndex] = next.isNull;
            input.classList.toggle("dirty", isCellDirty(rowIndex, columnIndex));
            input.classList.toggle("is-null", next.isNull);
            input.placeholder = next.isNull ? "null" : "";
            updateDirtyState();
          });
          inputs.push(input);
          td.appendChild(input);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      updateDirtyState();
      if (typeof focusRowIndex === "number") {
        const firstInput = inputAt(focusRowIndex, 0);
        if (firstInput) {
          firstInput.focus();
        }
      }
    }

    function collectChanges() {
      const changes = [];
      workingRows.forEach((row, rowIndex) => {
        if (row.isNew) {
          const values = [];
          state.columns.forEach((_, columnIndex) => {
            const value = row.values[columnIndex] ?? "";
            const isNull = row.nulls[columnIndex] === true;
            if (!isNull && value === "") {
              return;
            }
            values.push({
              columnIndex,
              value,
              isNull
            });
          });
          if (values.length > 0) {
            changes.push({ kind: "insert", values });
          }
          return;
        }

        const originalRow = originalRows[rowIndex];
        if (!originalRow) {
          return;
        }

        const updates = [];
        state.columns.forEach((_, columnIndex) => {
          const value = row.values[columnIndex] ?? "";
          const isNull = row.nulls[columnIndex] === true;
          const originalValue = originalRow.values[columnIndex] ?? "";
          const originalNull = originalRow.nulls[columnIndex] === true;
          const changed = isNull !== originalNull || (!isNull && value !== originalValue);
          if (!changed) {
            return;
          }
          updates.push({
            columnIndex,
            value,
            isNull
          });
        });
        if (updates.length > 0) {
          changes.push({ kind: "update", rowIndex, updates });
        }
      });
      return changes;
    }

    function resetWorkingRows() {
      workingRows = originalRows.map((row) => ({
        values: [...row.values],
        nulls: [...row.nulls],
        isNew: false
      }));
    }

    if (addRowButton) {
      addRowButton.addEventListener("click", () => {
        workingRows.push(createEmptyRow());
        renderTable(workingRows.length - 1);
      });
    }

    if (!state.loading && !state.error) {
      renderTable();
    }

    if (saveButton) {
      saveButton.addEventListener("click", () => {
        const changes = collectChanges();
        vscode.postMessage({ command: "save", changes });
      });
    }

    if (revertButton) {
      revertButton.addEventListener("click", () => {
        resetWorkingRows();
        renderTable();
      });
    }
  </script>
</body>
</html>`;
}

function renderTableShell(columns: string[]): string {
  const headers = columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  return `
    <div class="table-wrap">
      <table id="data-table">
        <thead>
          <tr>${headers}</tr>
        </thead>
        <tbody></tbody>
      </table>
    </div>
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
