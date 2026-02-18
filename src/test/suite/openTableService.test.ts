import * as assert from "assert";
import * as vscode from "vscode";
import { describe, it } from "mocha";
import { ConnectionManager } from "../../connections/connectionManager";
import {
  TableDataProvider,
  TablePageResult,
  TableReference,
  TableSaveResult
} from "../../databases/contracts";
import { OpenTableService } from "../../query/openTableService";
import { DataEditorPanel, DataEditorState } from "../../webviews/dataEditorPanel";
import { ResultsPanel } from "../../webviews/resultsPanel";

function createService(options: {
  getSession?: () => { tableDataProvider: TableDataProvider } | undefined;
  getPool?: () => unknown;
} = {}): OpenTableService {
  const manager = {
    getSession: options.getSession ?? (() => undefined),
    getPool: options.getPool ?? (() => undefined)
  } as unknown as ConnectionManager;

  return new OpenTableService(manager, vscode.Uri.parse("test:/db-explorer"));
}

function patchWindowMessages(stubs: {
  showWarningMessage?: (...args: unknown[]) => Thenable<string | undefined>;
  showInformationMessage?: (...args: unknown[]) => Thenable<string | undefined>;
}): () => void {
  const windowApi = vscode.window as unknown as {
    showWarningMessage: (...args: unknown[]) => Thenable<string | undefined>;
    showInformationMessage: (...args: unknown[]) => Thenable<string | undefined>;
  };
  const originalWarning = windowApi.showWarningMessage;
  const originalInfo = windowApi.showInformationMessage;

  if (stubs.showWarningMessage) {
    windowApi.showWarningMessage = stubs.showWarningMessage;
  }
  if (stubs.showInformationMessage) {
    windowApi.showInformationMessage = stubs.showInformationMessage;
  }

  return () => {
    windowApi.showWarningMessage = originalWarning;
    windowApi.showInformationMessage = originalInfo;
  };
}

function patchDataEditorPanel(states: DataEditorState[]): () => void {
  const dataEditorPanelClass = DataEditorPanel as unknown as {
    createOrShow: (extensionUri: vscode.Uri, viewColumn?: vscode.ViewColumn) => {
      setSaveHandler: (handler?: (changes: unknown[]) => void | Promise<void>) => void;
      setRefreshHandler: (handler?: () => void | Promise<void>) => void;
      setPageHandler: (handler?: (direction: "previous" | "next") => void | Promise<void>) => void;
      showState: (state: DataEditorState) => void;
    };
  };
  const resultsPanelClass = ResultsPanel as unknown as {
    getViewColumn: () => vscode.ViewColumn | undefined;
    disposeCurrentPanel: () => void;
  };

  const originalCreateOrShow = dataEditorPanelClass.createOrShow;
  const originalGetViewColumn = resultsPanelClass.getViewColumn;
  const originalDisposeCurrentPanel = resultsPanelClass.disposeCurrentPanel;

  dataEditorPanelClass.createOrShow = () => ({
    setSaveHandler: () => {},
    setRefreshHandler: () => {},
    setPageHandler: () => {},
    showState: (state: DataEditorState) => {
      states.push(state);
    }
  });
  resultsPanelClass.getViewColumn = () => undefined;
  resultsPanelClass.disposeCurrentPanel = () => {};

  return () => {
    dataEditorPanelClass.createOrShow = originalCreateOrShow;
    resultsPanelClass.getViewColumn = originalGetViewColumn;
    resultsPanelClass.disposeCurrentPanel = originalDisposeCurrentPanel;
  };
}

describe("OpenTableService contracts", () => {
  it("validates table context values", () => {
    const service = createService();
    const toTableContext = (service as unknown as {
      toTableContext: (value: unknown) => TableReference | undefined;
    }).toTableContext.bind(service);

    assert.strictEqual(toTableContext(undefined), undefined);
    assert.strictEqual(toTableContext("public.users"), undefined);
    assert.strictEqual(toTableContext({ schemaName: "public" }), undefined);
    assert.deepStrictEqual(toTableContext({ schemaName: "public", tableName: "users" }), {
      schemaName: "public",
      tableName: "users"
    });
  });

  it("maps editor updates, inserts, and deletes to TableDataProvider changes", () => {
    const service = createService();
    (service as unknown as { activeRowTokens: string[] }).activeRowTokens = ["(0,1)", "(0,2)"];

    const mapped = (service as unknown as {
      toTableDataChanges: (changes: Array<{
        kind: "update" | "insert" | "delete";
        rowIndex?: number;
        updates?: Array<{ columnIndex: number; value: string; isNull: boolean }>;
        values?: Array<{ columnIndex: number; value: string; isNull: boolean }>;
      }>) => unknown[];
    }).toTableDataChanges([
      {
        kind: "update",
        rowIndex: 0,
        updates: [{ columnIndex: 1, value: "Ada", isNull: false }]
      },
      {
        kind: "insert",
        values: [{ columnIndex: 0, value: "2", isNull: false }]
      },
      {
        kind: "delete",
        rowIndex: 1
      }
    ]);

    assert.deepStrictEqual(mapped, [
      {
        kind: "update",
        rowLocator: "(0,1)",
        updates: [{ columnIndex: 1, value: "Ada", isNull: false }]
      },
      {
        kind: "insert",
        values: [{ columnIndex: 0, value: "2", isNull: false }]
      },
      {
        kind: "delete",
        rowLocator: "(0,2)"
      }
    ]);
  });

  it("warns when opening a table without an active connection", async () => {
    let warningMessage = "";
    const restoreWindow = patchWindowMessages({
      showWarningMessage: async (message: unknown) => {
        warningMessage = String(message);
        return undefined;
      }
    });

    try {
      const service = createService();
      await service.open({ schemaName: "public", tableName: "users" });
    } finally {
      restoreWindow();
    }

    assert.strictEqual(warningMessage, "Connect to a DB profile first.");
  });

  it("shows loading state before rendering session table data", async () => {
    const states: DataEditorState[] = [];
    const restorePanel = patchDataEditorPanel(states);

    const fakeProvider: TableDataProvider = {
      loadPage: async (): Promise<TablePageResult> => ({
        table: { schemaName: "public", tableName: "users" },
        columns: [
          { name: "id", dataType: "integer", enumValues: [] },
          { name: "name", dataType: "text", enumValues: [] }
        ],
        rows: [
          {
            rowLocator: "(0,1)",
            values: [1, "Ada"]
          }
        ],
        pageSize: 100,
        pageIndex: 0,
        hasNextPage: false
      }),
      saveChanges: async (): Promise<TableSaveResult> => ({
        updatedRows: 0,
        insertedRows: 0,
        deletedRows: 0
      })
    };

    try {
      const service = createService({
        getSession: () => ({ tableDataProvider: fakeProvider })
      });
      await service.open({ schemaName: "public", tableName: "users" });
    } finally {
      restorePanel();
    }

    assert.strictEqual(states.length, 2);
    assert.strictEqual(states[0].loading, true);
    assert.deepStrictEqual(states[1].columns, ["id", "name"]);
    assert.deepStrictEqual(states[1].columnTypes, ["integer", "text"]);
    assert.deepStrictEqual(states[1].rows, [{ values: ["1", "Ada"], nulls: [false, false] }]);
    assert.strictEqual(states[1].hasNextPage, false);
  });
});
