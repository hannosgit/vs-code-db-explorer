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

export type DataEditorChange = DataEditorUpdateChange | DataEditorInsertChange;

type SaveHandler = (changes: DataEditorChange[]) => void | Promise<void>;
type RefreshHandler = () => void | Promise<void>;
type PageDirection = "previous" | "next";
type PageHandler = (direction: PageDirection) => void | Promise<void>;

export class DataEditorPanel {
  private static currentPanel: DataEditorPanel | undefined;
  private saveHandler?: SaveHandler;
  private refreshHandler?: RefreshHandler;
  private pageHandler?: PageHandler;

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

      if (
        message.command === "page" &&
        this.pageHandler &&
        (message.direction === "previous" || message.direction === "next")
      ) {
        void this.pageHandler(message.direction);
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

  showState(state: DataEditorState): void {
    this.panel.title = `Data Editor: ${state.schemaName}.${state.tableName}`;
    this.panel.webview.html = buildHtml(state);
  }
}

function buildHtml(state: DataEditorState): string {
  const safeState = JSON.stringify(state).replace(/</g, "\\u003c");
  const headerTitle = `${escapeHtml(state.schemaName)}.${escapeHtml(state.tableName)}`;
  const rowCount = state.rows.length;
  const rowSummary = `Page ${state.pageNumber} • ${rowCount} rows loaded (page size ${state.pageSize}).`;
  const addRowDisabled = state.loading || !!state.error || state.columns.length === 0;
  const prevPageDisabled = state.loading || state.pageNumber <= 1;
  const nextPageDisabled = state.loading || !!state.error || !state.hasNextPage;
  const body = state.loading
    ? `<div class="empty">Loading table data...</div>`
    : state.error
      ? `<div class="error">${escapeHtml(state.error)}</div>`
      : renderTableShell(state.columns, state.columnTypes ?? []);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
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
      display: inline-flex;
      align-items: baseline;
      gap: 6px;
      flex-wrap: wrap;
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
    th.row-number {
      font-weight: 600;
    }
    td input,
    td select {
      width: 100%;
      box-sizing: border-box;
      border: none;
      background: transparent;
      color: inherit;
      padding: 6px 8px;
      font: inherit;
    }
    td input:focus,
    td select:focus {
      outline: 1px solid var(--vscode-focusBorder);
      outline-offset: -1px;
    }
    td input.is-null,
    td select.is-null {
      color: var(--vscode-descriptionForeground);
      font-style: italic;
    }
    td input.dirty,
    td select.dirty {
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
      <div class="pager">
        <button id="page-prev" class="secondary"${prevPageDisabled ? " disabled" : ""}>Previous</button>
        <span class="pager-status">Page ${state.pageNumber}</span>
        <button id="page-next" class="secondary"${nextPageDisabled ? " disabled" : ""}>Next</button>
      </div>
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
    const prevPageButton = document.getElementById("page-prev");
    const nextPageButton = document.getElementById("page-next");
    const cellControls = [];
    const ENUM_NULL_VALUE = "__db_explorer_enum_null__";
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

    function canNavigatePage() {
      if (!saveButton || saveButton.disabled) {
        return true;
      }
      return window.confirm("You have unsaved changes on this page. Continue and discard them?");
    }

    if (prevPageButton) {
      prevPageButton.addEventListener("click", () => {
        if (!canNavigatePage()) {
          return;
        }
        vscode.postMessage({ command: "page", direction: "previous" });
      });
    }

    if (nextPageButton) {
      nextPageButton.addEventListener("click", () => {
        if (!canNavigatePage()) {
          return;
        }
        vscode.postMessage({ command: "page", direction: "next" });
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
      const dirtyCount = cellControls.filter((control) => control.classList.contains("dirty")).length;
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
      return cellControls[index];
    }

    function enumValuesForColumn(columnIndex) {
      if (!Array.isArray(state.columnEnumValues)) {
        return [];
      }
      const values = state.columnEnumValues[columnIndex];
      if (!Array.isArray(values)) {
        return [];
      }
      return values.filter((value) => typeof value === "string");
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
      cellControls.length = 0;
      const rowNumberOffset = Math.max(0, (state.pageNumber - 1) * state.pageSize);

      workingRows.forEach((row, rowIndex) => {
        const tr = document.createElement("tr");
        if (row.isNew) {
          tr.classList.add("new-row");
        }
        const rowNumberCell = document.createElement("td");
        rowNumberCell.classList.add("row-number");
        rowNumberCell.textContent = String(rowNumberOffset + rowIndex + 1);
        tr.appendChild(rowNumberCell);
        state.columns.forEach((_, columnIndex) => {
          const td = document.createElement("td");
          const enumValues = row.isNew ? enumValuesForColumn(columnIndex) : [];
          if (enumValues.length > 0) {
            const select = document.createElement("select");
            const value = row.values[columnIndex] ?? "";
            const isNull = row.nulls[columnIndex] === true;
            const placeholderOption = document.createElement("option");
            placeholderOption.value = "";
            placeholderOption.textContent = "(unset)";
            select.appendChild(placeholderOption);
            const nullOption = document.createElement("option");
            nullOption.value = ENUM_NULL_VALUE;
            nullOption.textContent = "NULL";
            select.appendChild(nullOption);
            enumValues.forEach((enumValue) => {
              const option = document.createElement("option");
              option.value = enumValue;
              option.textContent = enumValue;
              select.appendChild(option);
            });
            select.value = isNull ? ENUM_NULL_VALUE : value;
            if (select.value !== (isNull ? ENUM_NULL_VALUE : value)) {
              select.value = "";
            }
            select.dataset.row = String(rowIndex);
            select.dataset.column = String(columnIndex);
            select.classList.toggle("dirty", isCellDirty(rowIndex, columnIndex));
            select.classList.toggle("is-null", isNull);
            select.addEventListener("change", () => {
              const nextValue = select.value;
              const nextIsNull = nextValue === ENUM_NULL_VALUE;
              row.values[columnIndex] = nextIsNull ? "" : nextValue;
              row.nulls[columnIndex] = nextIsNull;
              select.classList.toggle("dirty", isCellDirty(rowIndex, columnIndex));
              select.classList.toggle("is-null", nextIsNull);
              updateDirtyState();
            });
            cellControls.push(select);
            td.appendChild(select);
            tr.appendChild(td);
            return;
          }

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
          cellControls.push(input);
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

function renderTableShell(columns: string[], columnTypes: string[]): string {
  const headers = columns
    .map((column, columnIndex) => {
      const columnType = columnTypes[columnIndex] ?? "";
      const typeLabel = columnType ? ` <span class="column-type">(${escapeHtml(columnType)})</span>` : "";
      return `<th><span class="column-header">${escapeHtml(column)}${typeLabel}</span></th>`;
    })
    .join("");
  return `
    <div class="table-wrap">
      <table id="data-table">
        <thead>
          <tr><th class="row-number">#</th>${headers}</tr>
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
