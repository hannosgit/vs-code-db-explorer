import * as vscode from "vscode";

export interface EditorRow {
  values: string[];
  nulls: boolean[];
}

export interface DataEditorState {
  schemaName: string;
  tableName: string;
  columns: string[];
  columnTypes?: string[];
  columnEnumValues?: string[][];
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  rows: EditorRow[];
  pageSize: number;
  pageNumber: number;
  hasNextPage: boolean;
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

export interface DataEditorDeleteChange {
  kind: "delete";
  rowIndex: number;
}

export type DataEditorChange =
  | DataEditorUpdateChange
  | DataEditorInsertChange
  | DataEditorDeleteChange;

type SaveHandler = (changes: DataEditorChange[]) => void | Promise<void>;
type RefreshHandler = () => void | Promise<void>;
type PageDirection = "previous" | "next";
type PageHandler = (direction: PageDirection) => void | Promise<void>;
type SortHandler = (columnIndex: number) => void | Promise<void>;

export class DataEditorPanel {
  private static currentPanel: DataEditorPanel | undefined;
  private saveHandler?: SaveHandler;
  private refreshHandler?: RefreshHandler;
  private pageHandler?: PageHandler;
  private sortHandler?: SortHandler;

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
      "dbDataEditor",
      "DB Explorer Data Editor",
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

      if (
        message.command === "page" &&
        this.pageHandler &&
        (message.direction === "previous" || message.direction === "next")
      ) {
        void this.pageHandler(message.direction);
      }

      if (
        message.command === "sort" &&
        this.sortHandler &&
        Number.isInteger(message.columnIndex) &&
        message.columnIndex >= 0
      ) {
        void this.sortHandler(message.columnIndex);
      }

      if (
        message.command === "exportCsv" &&
        typeof message.content === "string" &&
        typeof message.fileName === "string"
      ) {
        void this.exportCsv(message.content, message.fileName);
      }
    });
  }

  setSaveHandler(handler?: SaveHandler): void {
    this.saveHandler = handler;
  }

  setRefreshHandler(handler?: RefreshHandler): void {
    this.refreshHandler = handler;
  }

  setPageHandler(handler?: PageHandler): void {
    this.pageHandler = handler;
  }

  setSortHandler(handler?: SortHandler): void {
    this.sortHandler = handler;
  }

  private async exportCsv(content: string, fileName: string): Promise<void> {
    const safeFileName = toSafeCsvFileName(fileName);
    const defaultUri = getDefaultSaveUri(safeFileName);
    const uri = await vscode.window.showSaveDialog({
      saveLabel: "Export CSV",
      filters: { "CSV files": ["csv"] },
      defaultUri
    });

    if (!uri) {
      return;
    }

    try {
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, "utf8"));
      void vscode.window.showInformationMessage(`CSV exported to ${uri.fsPath || uri.path}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      void vscode.window.showErrorMessage(`Unable to export CSV: ${reason}`);
    }
  }

  showState(state: DataEditorState): void {
    this.panel.title = `Data Editor: ${state.schemaName}.${state.tableName}`;
    this.panel.webview.html = buildHtml(this.panel.webview, this.extensionUri, state);
  }
}

function toSafeCsvFileName(fileName: string): string {
  const trimmed = fileName.trim();
  const withFallback = trimmed.length > 0 ? trimmed : "data-export.csv";
  return withFallback.toLowerCase().endsWith(".csv") ? withFallback : `${withFallback}.csv`;
}

function getDefaultSaveUri(fileName: string): vscode.Uri | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceFolder) {
    return undefined;
  }

  return vscode.Uri.joinPath(workspaceFolder, fileName);
}

function buildHtml(
  webview: vscode.Webview,
  extensionUri: vscode.Uri,
  state: DataEditorState
): string {
  const safeState = JSON.stringify(state).replace(/</g, "\\u003c");
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "dist", "webviews", "dataEditorUi.js")
  );
  const csp = [
    "default-src 'none'",
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src ${webview.cspSource}`
  ].join("; ");
  const headerTitle = `${escapeHtml(state.schemaName)}.${escapeHtml(state.tableName)}`;
  const rowCount = state.rows.length;
  const sortSummary = state.sortColumn
    ? ` Sorted by ${escapeHtml(state.sortColumn)} (${state.sortDirection === "desc" ? "descending" : "ascending"}).`
    : "";
  const rowSummary = `Page ${state.pageNumber} • ${rowCount} rows loaded (page size ${state.pageSize}).${sortSummary}`;
  const addRowDisabled = state.loading || !!state.error || state.columns.length === 0;
  const prevPageDisabled = state.loading || state.pageNumber <= 1;
  const nextPageDisabled = state.loading || !!state.error || !state.hasNextPage;
  const body = state.loading
    ? `<div class="empty">Loading table data...</div>`
    : state.error
      ? `<div class="error">${escapeHtml(state.error)}</div>`
      : renderTableShell(
          state.columns,
          state.columnTypes ?? [],
          state.sortColumn,
          state.sortDirection
        );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <title>DB Explorer Data Editor</title>
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
    .pager {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .pager-status {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
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
    th .column-header {
      display: flex;
      align-items: baseline;
      gap: 6px;
      flex-wrap: wrap;
    }
    th button.column-sort {
      all: unset;
      box-sizing: border-box;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      width: 100%;
      cursor: pointer;
    }
    th button.column-sort:focus-visible {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
      border-radius: 3px;
    }
    th button.column-sort .sort-indicator {
      color: var(--vscode-descriptionForeground);
      font-size: 11px;
      min-width: 12px;
      text-align: right;
    }
    th button.column-sort.is-active .sort-indicator {
      color: var(--vscode-editor-foreground);
    }
    th .column-type {
      font-size: 11px;
      font-weight: 400;
      color: var(--vscode-descriptionForeground);
    }
    th.row-number,
    td.row-number {
      width: 1%;
      white-space: nowrap;
      text-align: right;
      padding: 6px 8px;
      color: var(--vscode-descriptionForeground);
    }
    th.row-actions,
    td.row-actions {
      width: 1%;
      white-space: nowrap;
      text-align: center;
      padding: 4px 6px;
    }
    th.row-number {
      font-weight: 600;
    }
    td.row-actions button {
      padding: 2px 8px;
      font-size: 11px;
    }
    td input:not([type="checkbox"]),
    td select {
      width: 100%;
      box-sizing: border-box;
      border: none;
      background: transparent;
      color: inherit;
      padding: 6px 8px;
      font: inherit;
    }
    td input:not([type="checkbox"]):focus,
    td select:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }
    td input:not([type="checkbox"]).is-null,
    td select.is-null {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    td input:not([type="checkbox"]).dirty,
    td select.dirty {
      background: var(--vscode-editor-wordHighlightBackground);
    }
    td .boolean-editor {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      min-height: 28px;
      box-sizing: border-box;
    }
    td .boolean-editor input[type="checkbox"] {
      width: 13px;
      height: 13px;
      margin: 0;
      flex: 0 0 auto;
    }
    td .boolean-editor input[type="checkbox"]:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: 2px;
    }
    td .boolean-editor .boolean-state {
      font-size: 11px;
      color: var(--vscode-editor-foreground);
      white-space: nowrap;
    }
    td .boolean-editor.is-null .boolean-state {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    td .boolean-editor.dirty {
      background: var(--vscode-editor-wordHighlightBackground);
    }
    tr.new-row td {
      background: var(--vscode-editor-inactiveSelectionBackground, rgba(127, 127, 127, 0.12));
    }
    tr.deleted-row td {
      opacity: 0.75;
    }
    tr.deleted-row td:not(.row-actions):not(.row-number) {
      text-decoration: line-through;
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
      <div class="pager">
        <button id="page-prev" class="secondary"${prevPageDisabled ? " disabled" : ""}>Previous</button>
        <span class="pager-status">Page ${state.pageNumber}</span>
        <button id="page-next" class="secondary"${nextPageDisabled ? " disabled" : ""}>Next</button>
      </div>
    </div>
  </header>
  <div class="note">Tip: click a column header to sort, use <strong>Add row</strong> to insert, <strong>Delete</strong> to remove rows, type <strong>NULL</strong> to set a value to NULL, and use the boolean checkbox to cycle <strong>FALSE</strong>, <strong>TRUE</strong>, and <strong>NULL</strong>.</div>
  ${body}
  <textarea id="initial-state" hidden>${safeState}</textarea>
  <script src="${scriptUri}" defer></script>
</body>
</html>`;
}

function renderTableShell(
  columns: string[],
  columnTypes: string[],
  sortColumn?: string,
  sortDirection?: "asc" | "desc"
): string {
  const headers = columns
    .map((column, columnIndex) => {
      const columnType = columnTypes[columnIndex] ?? "";
      const typeLabel = columnType ? ` <span class="column-type">(${escapeHtml(columnType)})</span>` : "";
      const isSorted = sortColumn === column;
      const direction = sortDirection === "desc" ? "desc" : "asc";
      const indicator = isSorted ? (direction === "desc" ? "▼" : "▲") : "↕";
      const activeClass = isSorted ? " is-active" : "";
      const label = escapeHtml(column);
      return `<th><button type="button" class="column-sort${activeClass}" data-column-index="${columnIndex}" title="Sort by ${label}"><span class="column-header">${label}${typeLabel}</span><span class="sort-indicator">${indicator}</span></button></th>`;
    })
    .join("");
  return `
    <div class="table-wrap">
      <table id="data-table">
        <thead>
          <tr><th class="row-number">#</th><th class="row-actions">Actions</th>${headers}</tr>
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
