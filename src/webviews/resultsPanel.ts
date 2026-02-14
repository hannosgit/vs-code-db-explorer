import * as vscode from "vscode";
import { QueryExecutionResult } from "../query/queryRunner";

const RESULTS_PAGE_SIZE = 100;

export class ResultsPanel {
  private static currentPanel: ResultsPanel | undefined;
  private cancelHandler?: () => Promise<boolean>;

  static createOrShow(
    extensionUri: vscode.Uri,
    viewColumn?: vscode.ViewColumn
  ): ResultsPanel {
    if (ResultsPanel.currentPanel) {
      ResultsPanel.currentPanel.panel.reveal();
      return ResultsPanel.currentPanel;
    }

    const column = viewColumn ?? vscode.ViewColumn.Beside;
    const panel = vscode.window.createWebviewPanel(
      "postgresResults",
      "Postgres Results",
      column,
      { enableScripts: true }
    );

    ResultsPanel.currentPanel = new ResultsPanel(panel, extensionUri);
    return ResultsPanel.currentPanel;
  }

  static getViewColumn(): vscode.ViewColumn | undefined {
    return ResultsPanel.currentPanel?.panel.viewColumn;
  }

  static disposeCurrentPanel(): void {
    const panel = ResultsPanel.currentPanel?.panel;
    ResultsPanel.currentPanel = undefined;
    panel?.dispose();
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly extensionUri: vscode.Uri
  ) {
    void this.extensionUri;
    this.panel.onDidDispose(() => {
      if (ResultsPanel.currentPanel === this) {
        ResultsPanel.currentPanel = undefined;
      }
    });

    this.panel.webview.onDidReceiveMessage((message) => {
      if (message?.command === "cancel" && this.cancelHandler) {
        void this.cancelHandler();
      }
    });
  }

  showLoading(sql: string): void {
    this.panel.webview.html = buildHtml({
      sql,
      columns: [],
      rows: [],
      rowCount: null,
      durationMs: 0,
      truncated: false,
      loading: true
    });
  }

  showResults(result: QueryExecutionResult): void {
    this.panel.webview.html = buildHtml(result);
  }

  setCancelHandler(handler?: () => Promise<boolean>): void {
    this.cancelHandler = handler;
  }
}

function buildHtml(
  result: QueryExecutionResult & { loading?: boolean }
): string {
  const sqlBlock = `<pre>${escapeHtml(result.sql)}</pre>`;
  const header = result.loading
    ? `<div class="status status-row"><span>Running query…</span><button id="cancel-query">Cancel</button></div>`
    : renderStatus(result);
  const body = result.loading
    ? ""
    : result.cancelled
      ? renderCancelled(result)
      : result.error
      ? renderError(result)
      : renderTable(result);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Postgres Results</title>
  <style>
    :root {
      color-scheme: light dark;
      --border: #3a3a3a;
      --bg: #1e1e1e;
      --bg-alt: #252526;
      --text: #e5e5e5;
      --muted: #a0a0a0;
      --accent: #4fc1ff;
      --error: #ff6f6f;
    }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    header {
      padding: 12px 16px 4px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-alt);
    }
    pre {
      margin: 8px 0 0;
      padding: 8px;
      background: rgba(255, 255, 255, 0.04);
      border-radius: 6px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .status {
      font-size: 12px;
      color: var(--muted);
      margin-top: 6px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .status strong { color: var(--accent); }
    .status-row button {
      padding: 4px 10px;
      border-radius: 4px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text);
      cursor: pointer;
    }
    .status-row button[disabled] {
      opacity: 0.6;
      cursor: default;
    }
    .error {
      padding: 16px;
      color: var(--error);
    }
    .error code {
      color: var(--text);
    }
    .table-wrap {
      padding: 12px 16px 24px;
      overflow: auto;
    }
    .table-toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
      color: var(--muted);
      font-size: 12px;
    }
    .table-toolbar button {
      padding: 4px 10px;
      border-radius: 4px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text);
      cursor: pointer;
    }
    .table-toolbar button[disabled] {
      opacity: 0.6;
      cursor: default;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      font-size: 12px;
    }
    th, td {
      border: 1px solid var(--border);
      padding: 6px 8px;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: var(--bg-alt);
      position: sticky;
      top: 0;
      z-index: 1;
    }
    td.null {
      color: var(--muted);
      font-style: italic;
    }
    .empty {
      padding: 16px;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <header>
    <div><strong>SQL</strong></div>
    ${sqlBlock}
    ${header}
  </header>
  ${body}
  <script>
    const cancelButton = document.getElementById("cancel-query");
    if (cancelButton) {
      const vscode = acquireVsCodeApi();
      cancelButton.addEventListener("click", () => {
        cancelButton.setAttribute("disabled", "true");
        cancelButton.textContent = "Canceling…";
        vscode.postMessage({ command: "cancel" });
      });
    }
  </script>
</body>
</html>`;
}

function renderStatus(result: QueryExecutionResult): string {
  if (result.cancelled) {
    return `
      <div class="status">
        <strong>Cancelled</strong> • ${result.durationMs} ms
      </div>
    `;
  }

  if (result.error) {
    return `
      <div class="status">
        <strong>Error</strong> • ${result.durationMs} ms
      </div>
    `;
  }

  const rowCount = typeof result.rowCount === "number" ? result.rowCount : result.rows.length;
  const truncated = result.truncated ? " (truncated)" : "";
  return `
    <div class="status">
      <strong>${rowCount}</strong> rows • ${result.durationMs} ms${truncated}
    </div>
  `;
}

function renderCancelled(result: QueryExecutionResult): string {
  return `<div class="empty">Query cancelled after ${result.durationMs} ms.</div>`;
}

function renderError(result: QueryExecutionResult): string {
  const error = result.error;
  if (!error) {
    return "";
  }

  const detail = error.detail ? `<div>Detail: ${escapeHtml(error.detail)}</div>` : "";
  const code = error.code ? `<div>Code: <code>${escapeHtml(error.code)}</code></div>` : "";
  const position = error.position ? `<div>Position: ${escapeHtml(error.position)}</div>` : "";

  return `
    <div class="error">
      <div><strong>Error:</strong> ${escapeHtml(error.message)}</div>
      ${detail}
      ${code}
      ${position}
    </div>
  `;
}

function renderTable(result: QueryExecutionResult): string {
  if (result.columns.length === 0) {
    const rowCount = result.rowCount ?? 0;
    return `<div class="empty">Query completed. Rows affected: ${rowCount}.</div>`;
  }

  const headerRow = result.columns.map((col) => `<th>${escapeHtml(col)}</th>`).join("");
  const allRows = result.rows
    .map((row) => {
      const cells = result.columns
        .map((col) => formatCell(row[col]))
        .join("");
      return `<tr>${cells}</tr>`;
    });
  const safeRows = JSON.stringify(allRows).replace(/</g, "\\u003c");

  return `
    <div class="table-wrap">
      <div class="table-toolbar">
        <button id="results-prev" disabled>Previous</button>
        <span id="results-page-info"></span>
        <button id="results-next"${allRows.length > RESULTS_PAGE_SIZE ? "" : " disabled"}>Next</button>
      </div>
      <table>
        <thead>
          <tr>${headerRow}</tr>
        </thead>
        <tbody id="results-body"></tbody>
      </table>
    </div>
    <script>
      (() => {
        const rows = ${safeRows};
        const pageSize = ${RESULTS_PAGE_SIZE};
        const totalRows = rows.length;
        const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
        let pageIndex = 0;

        const prevButton = document.getElementById("results-prev");
        const nextButton = document.getElementById("results-next");
        const pageInfo = document.getElementById("results-page-info");
        const tbody = document.getElementById("results-body");

        if (!prevButton || !nextButton || !pageInfo || !tbody) {
          return;
        }

        function renderPage() {
          const start = pageIndex * pageSize;
          const end = Math.min(start + pageSize, totalRows);
          tbody.innerHTML = rows.slice(start, end).join("");
          prevButton.disabled = pageIndex === 0;
          nextButton.disabled = pageIndex >= totalPages - 1;
          if (totalRows === 0) {
            pageInfo.textContent = "No rows";
            return;
          }
          pageInfo.textContent = "Rows " + (start + 1) + "-" + end + " of " + totalRows + " (Page " + (pageIndex + 1) + " of " + totalPages + ")";
        }

        prevButton.addEventListener("click", () => {
          if (pageIndex === 0) {
            return;
          }
          pageIndex -= 1;
          renderPage();
        });

        nextButton.addEventListener("click", () => {
          if (pageIndex >= totalPages - 1) {
            return;
          }
          pageIndex += 1;
          renderPage();
        });

        renderPage();
      })();
    </script>
  `;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) {
    return `<td class="null">null</td>`;
  }

  let text: string;
  if (value instanceof Date) {
    text = value.toISOString();
  } else if (Buffer.isBuffer(value)) {
    text = `\\x${value.toString("hex")}`;
  } else if (typeof value === "object") {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  } else {
    text = String(value);
  }

  const max = 2000;
  const truncated = text.length > max;
  const display = truncated ? `${text.slice(0, max)}…` : text;
  const title = truncated ? ` title="${escapeHtml(text)}"` : "";

  return `<td${title}>${escapeHtml(display)}</td>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
