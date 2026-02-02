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

export interface DataEditorChange {
  rowIndex: number;
  updates: DataEditorCellUpdate[];
}

type SaveHandler = (changes: DataEditorChange[]) => void | Promise<void>;
type RefreshHandler = () => void | Promise<void>;

export class DataEditorPanel {
  private static currentPanel: DataEditorPanel | undefined;
  private saveHandler?: SaveHandler;
  private refreshHandler?: RefreshHandler;

  static createOrShow(extensionUri: vscode.Uri): DataEditorPanel {
    if (DataEditorPanel.currentPanel) {
      DataEditorPanel.currentPanel.panel.reveal(vscode.ViewColumn.Beside);
      return DataEditorPanel.currentPanel;
    }

    const panel = vscode.window.createWebviewPanel(
      "postgresDataEditor",
      "Postgres Data Editor",
      vscode.ViewColumn.Beside,
      { enableScripts: true }
    );

    DataEditorPanel.currentPanel = new DataEditorPanel(panel, extensionUri);
    return DataEditorPanel.currentPanel;
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri
  ) {
    void this.extensionUri;
    this.panel.onDidDispose(() => {
      DataEditorPanel.currentPanel = undefined;
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
      <button id="save" disabled>Save</button>
      <button id="revert" class="secondary" disabled>Revert</button>
      <button id="refresh" class="secondary">Refresh</button>
    </div>
  </header>
  <div class="note">Tip: type <strong>NULL</strong> to set a value to NULL.</div>
  ${body}
  <script>
    const state = ${safeState};
    const vscode = acquireVsCodeApi();
    const saveButton = document.getElementById("save");
    const revertButton = document.getElementById("revert");
    const refreshButton = document.getElementById("refresh");
    const inputs = [];

    if (refreshButton) {
      refreshButton.addEventListener("click", () => {
        vscode.postMessage({ command: "refresh" });
      });
    }

    function computeCellUpdate(input, originalValue, originalNull) {
      const raw = input.value;
      const trimmed = raw.trim();
      const newNull = trimmed.toLowerCase() === "null" || (trimmed === "" && originalNull);
      const changed =
        newNull !== originalNull || (!newNull && raw !== originalValue);
      return { changed, isNull: newNull, value: raw };
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

    function renderTable() {
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

      state.rows.forEach((row, rowIndex) => {
        const tr = document.createElement("tr");
        state.columns.forEach((_, columnIndex) => {
          const td = document.createElement("td");
          const input = document.createElement("input");
          const value = row.values[columnIndex] ?? "";
          const isNull = row.nulls[columnIndex];
          input.value = value;
          input.dataset.row = String(rowIndex);
          input.dataset.column = String(columnIndex);
          if (isNull) {
            input.placeholder = "null";
            input.classList.add("is-null");
          }
          input.addEventListener("input", () => {
            const update = computeCellUpdate(input, value, isNull);
            input.classList.toggle("dirty", update.changed);
            input.classList.toggle("is-null", update.isNull);
            updateDirtyState();
          });
          inputs.push(input);
          td.appendChild(input);
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      updateDirtyState();
    }

    function collectChanges() {
      const changes = [];
      state.rows.forEach((row, rowIndex) => {
        const updates = [];
        state.columns.forEach((_, columnIndex) => {
          const input = inputAt(rowIndex, columnIndex);
          if (!input) {
            return;
          }
          const originalValue = row.values[columnIndex] ?? "";
          const originalNull = row.nulls[columnIndex];
          const update = computeCellUpdate(input, originalValue, originalNull);
          if (update.changed) {
            updates.push({
              columnIndex,
              value: update.value,
              isNull: update.isNull
            });
          }
        });
        if (updates.length > 0) {
          changes.push({ rowIndex, updates });
        }
      });
      return changes;
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
