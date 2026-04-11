import * as assert from "assert";
import * as vscode from "vscode";
import { afterEach, beforeEach, describe, it } from "mocha";
import { ResultsPanel } from "../../webviews/resultsPanel";
import * as csvExport from "../../webviews/csvExport";
import { QueryExecutionResult } from "../../query/queryRunner";

class FakeWebview {
  html = "";
  private receiveMessageHandler?: (message: unknown) => void;

  onDidReceiveMessage(handler: (message: unknown) => void): vscode.Disposable {
    this.receiveMessageHandler = handler;
    return { dispose: () => {} };
  }

  fireMessage(message: unknown): void {
    this.receiveMessageHandler?.(message);
  }
}

class FakeWebviewPanel {
  readonly webview = new FakeWebview() as unknown as vscode.Webview;
  readonly onDidDisposeHandlers: Array<() => void> = [];
  viewColumn: vscode.ViewColumn | undefined;
  revealCalls = 0;
  disposeCalls = 0;

  constructor(viewColumn: vscode.ViewColumn | undefined) {
    this.viewColumn = viewColumn;
  }

  reveal(): void {
    this.revealCalls += 1;
  }

  dispose(): void {
    this.disposeCalls += 1;
    for (const handler of this.onDidDisposeHandlers) {
      handler();
    }
  }

  onDidDispose(handler: () => void): vscode.Disposable {
    this.onDidDisposeHandlers.push(handler);
    return { dispose: () => {} };
  }
}

describe("ResultsPanel", () => {
  let originalCreateWebviewPanel: typeof vscode.window.createWebviewPanel;
  let lastCreatedPanel: FakeWebviewPanel | undefined;
  let createPanelCalls = 0;
  let originalExportCsv: typeof csvExport.exportCsv;

  beforeEach(() => {
    ResultsPanel.disposeCurrentPanel();

    originalCreateWebviewPanel = vscode.window.createWebviewPanel;
    originalExportCsv = csvExport.exportCsv;

    const windowApi = vscode.window as unknown as {
      createWebviewPanel: typeof vscode.window.createWebviewPanel;
    };

    windowApi.createWebviewPanel = (
      _viewType,
      _title,
      showOptions,
      _options
    ) => {
      createPanelCalls += 1;
      const column = typeof showOptions === "number" ? showOptions : showOptions.viewColumn;
      lastCreatedPanel = new FakeWebviewPanel(column);
      return lastCreatedPanel as unknown as vscode.WebviewPanel;
    };
  });

  afterEach(() => {
    ResultsPanel.disposeCurrentPanel();

    const windowApi = vscode.window as unknown as {
      createWebviewPanel: typeof vscode.window.createWebviewPanel;
    };
    windowApi.createWebviewPanel = originalCreateWebviewPanel;

    (csvExport as unknown as { exportCsv: typeof csvExport.exportCsv }).exportCsv = originalExportCsv;
    lastCreatedPanel = undefined;
    createPanelCalls = 0;
  });

  it("creates and reuses the current panel", () => {
    const extensionUri = vscode.Uri.file("/tmp/db-explorer");

    const first = ResultsPanel.createOrShow(extensionUri);
    const second = ResultsPanel.createOrShow(extensionUri, vscode.ViewColumn.One);

    assert.strictEqual(first, second);
    assert.strictEqual(createPanelCalls, 1);
    assert.strictEqual(lastCreatedPanel?.revealCalls, 1);
    assert.strictEqual(ResultsPanel.getViewColumn(), vscode.ViewColumn.Beside);
  });

  it("renders loading state and escapes SQL content", () => {
    const panel = ResultsPanel.createOrShow(vscode.Uri.file("/tmp/db-explorer"));
    panel.showLoading("select '<script>alert(1)</script>';");

    const html = (lastCreatedPanel?.webview as unknown as FakeWebview).html;
    assert.ok(html.includes("Running query…"));
    assert.ok(html.includes("id=\"cancel-query\""));
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  });

  it("handles cancel and export messages from the webview", async () => {
    const panel = ResultsPanel.createOrShow(vscode.Uri.file("/tmp/db-explorer"));

    let cancelCalls = 0;
    panel.setCancelHandler(async () => {
      cancelCalls += 1;
      return true;
    });

    let exported:
      | { content: string; fileName: string; fallbackFileName: string }
      | undefined;
    (csvExport as unknown as { exportCsv: typeof csvExport.exportCsv }).exportCsv = async (options) => {
      exported = options;
    };

    const result: QueryExecutionResult = {
      sql: "select name from users",
      columns: ["name"],
      rows: [{ name: "Alice" }],
      rowCount: 1,
      durationMs: 4,
      truncated: false
    };

    panel.showResults(result);

    const webview = lastCreatedPanel?.webview as unknown as FakeWebview;
    webview.fireMessage({ command: "cancel" });
    webview.fireMessage({
      command: "exportCsv",
      content: "name\r\nAlice",
      fileName: "users"
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(cancelCalls, 1);
    assert.deepStrictEqual(exported, {
      content: "name\r\nAlice",
      fileName: "users",
      fallbackFileName: "query-results.csv"
    });
  });
});
