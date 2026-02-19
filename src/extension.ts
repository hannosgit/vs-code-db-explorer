import * as vscode from "vscode";
import { ConnectionManager } from "./connections/connectionManager";
import { promptForNewConnection } from "./connections/createConnectionProfile";
import { OpenTableService } from "./query/openTableService";
import { SqlCodeLensProvider } from "./query/sqlCodeLensProvider";
import { getAllSqlToRun, getSqlFromRange, getSqlToRun } from "./query/sqlText";
import { ConnectionsTreeDataProvider } from "./views/connectionsTree";
import { SchemaTreeDataProvider } from "./views/schemaTree";
import { DataEditorPanel } from "./webviews/dataEditorPanel";
import { ResultsPanel } from "./webviews/resultsPanel";

const lastProfileStateKey = "dbExplorer.lastProfileId";

function getProfilesTarget(): vscode.ConfigurationTarget {
  return vscode.workspace.workspaceFolders
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

function toRange(value: unknown): vscode.Range | undefined {
  if (value instanceof vscode.Range) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as {
    start?: unknown;
    end?: unknown;
  };

  if (!isPosition(candidate.start) || !isPosition(candidate.end)) {
    return undefined;
  }

  return new vscode.Range(
    new vscode.Position(candidate.start.line, candidate.start.character),
    new vscode.Position(candidate.end.line, candidate.end.character)
  );
}

function isPosition(
  value: unknown
): value is { line: number; character: number } {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as { line?: unknown; character?: unknown };
  return (
    typeof candidate.line === "number" &&
    Number.isInteger(candidate.line) &&
    candidate.line >= 0 &&
    typeof candidate.character === "number" &&
    Number.isInteger(candidate.character) &&
    candidate.character >= 0
  );
}

export function activate(context: vscode.ExtensionContext): void {
  const connectionManager = new ConnectionManager(context.secrets);
  const connectionsProvider = new ConnectionsTreeDataProvider(connectionManager);
  const schemaProvider = new SchemaTreeDataProvider(connectionManager);
  const openTableService = new OpenTableService(connectionManager, context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("dbConnections", connectionsProvider),
    vscode.window.registerTreeDataProvider("dbSchema", schemaProvider),
    vscode.languages.registerCodeLensProvider({ language: "sql" }, new SqlCodeLensProvider())
  );

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = "dbExplorer.connect";
  statusBar.text = "DB Explorer: Disconnected";
  statusBar.show();
  context.subscriptions.push(statusBar);

  const resolveEditor = async (resource?: vscode.Uri): Promise<vscode.TextEditor | undefined> => {
    let editor = vscode.window.activeTextEditor;

    if (resource) {
      const activeUri = editor?.document.uri.toString();
      if (!activeUri || activeUri !== resource.toString()) {
        const document = await vscode.workspace.openTextDocument(resource);
        editor = await vscode.window.showTextDocument(document, { preview: false });
      }
    }

    return editor;
  };

  connectionManager.onDidChangeActive((state) => {
    if (state.activeProfileId) {
      void context.workspaceState.update(lastProfileStateKey, state.activeProfileId);
      statusBar.text = `DB Explorer: ${state.activeProfileId}`;
      statusBar.command = "dbExplorer.disconnect";
    } else {
      statusBar.text = "DB Explorer: Disconnected";
      statusBar.command = "dbExplorer.connect";
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("dbExplorer.addConnection", async () => {
      const existingProfiles = connectionManager.listProfiles();
      const input = await promptForNewConnection(existingProfiles);
      if (!input) {
        return;
      }

      const config = vscode.workspace.getConfiguration("dbExplorer");
      await config.update(
        "profiles",
        [...existingProfiles, input.profile],
        getProfilesTarget()
      );

      if (input.password !== undefined) {
        await connectionManager.storePassword(input.profile.id, input.password);
      }

      connectionsProvider.refresh();

      const action = await vscode.window.showInformationMessage(
        `Added connection "${input.profile.label}".`,
        "Connect now"
      );

      if (action !== "Connect now") {
        return;
      }

      try {
        await connectionManager.connect(input.profile.id);
        connectionsProvider.refresh();
        schemaProvider.refresh();
      } catch (error) {
        if (error instanceof Error && error.message === "Connection canceled.") {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Failed to connect to DB.";
        void vscode.window.showErrorMessage(message);
      }
    }),
    vscode.commands.registerCommand("dbExplorer.connect", async () => {
      const profiles = connectionManager.listProfiles();
      if (profiles.length === 0) {
        void vscode.window.showWarningMessage(
          "No profiles configured. Run \"DB Explorer: Add Connection\" or edit settings.json."
        );
        return;
      }

      const picked = await vscode.window.showQuickPick(
        profiles.map((profile) => ({
          label: profile.label,
          description: `${profile.user}@${profile.host}:${profile.port}/${profile.database}`,
          profile
        })),
        { placeHolder: "Select a DB Explorer connection" }
      );

      if (!picked) {
        return;
      }

      try {
        await connectionManager.connect(picked.profile.id);
        connectionsProvider.refresh();
        schemaProvider.refresh();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Failed to connect to DB.";
        void vscode.window.showErrorMessage(message);
      }
    }),
    vscode.commands.registerCommand("dbExplorer.disconnect", async () => {
      await connectionManager.disconnect();
      connectionsProvider.refresh();
      schemaProvider.refresh();
    }),
    vscode.commands.registerCommand("dbExplorer.refreshSchema", () => {
      schemaProvider.refresh();
    }),
    vscode.commands.registerCommand(
      "dbExplorer.runQuery",
      async (resource?: vscode.Uri, statementRange?: unknown) => {
        const editor = await resolveEditor(resource);

        if (!editor) {
          void vscode.window.showWarningMessage("Open a SQL file to run a query.");
          return;
        }

        const range = toRange(statementRange);
        const sql = range
          ? getSqlFromRange(editor.document, range)
          : getSqlToRun(editor);
        if (!sql) {
          void vscode.window.showWarningMessage("No SQL statement selected or found.");
          return;
        }

        const session = connectionManager.getSession();
        if (!session) {
          void vscode.window.showWarningMessage("Connect to a DB profile first.");
          return;
        }

        const viewColumn = DataEditorPanel.getViewColumn();
        DataEditorPanel.disposeCurrentPanel();
        const panel = ResultsPanel.createOrShow(context.extensionUri, viewColumn);
        panel.showLoading(sql);
        panel.setCancelHandler(undefined);

        const { promise, cancel } = session.queryExecutor.runCancelable(sql);
        panel.setCancelHandler(cancel);

        const result = await promise;
        panel.setCancelHandler(undefined);
        panel.showResults(result);

        if (result.error && !result.cancelled) {
          void vscode.window.showErrorMessage(result.error.message);
        }
      }
    ),
    vscode.commands.registerCommand("dbExplorer.runAllStatements", async (resource?: vscode.Uri) => {
      const editor = await resolveEditor(resource);

      if (!editor || editor.document.languageId !== "sql") {
        void vscode.window.showWarningMessage("Open a SQL file to run statements.");
        return;
      }

      const sql = getAllSqlToRun(editor);
      if (!sql) {
        void vscode.window.showWarningMessage("No SQL statements found in the file.");
        return;
      }

      const session = connectionManager.getSession();
      if (!session) {
        void vscode.window.showWarningMessage("Connect to a DB profile first.");
        return;
      }

      const viewColumn = DataEditorPanel.getViewColumn();
      DataEditorPanel.disposeCurrentPanel();
      const panel = ResultsPanel.createOrShow(context.extensionUri, viewColumn);
      panel.showLoading(sql);
      panel.setCancelHandler(undefined);

      const { promise, cancel } = session.queryExecutor.runCancelable(sql);
      panel.setCancelHandler(cancel);

      const result = await promise;
      panel.setCancelHandler(undefined);
      panel.showResults(result);

      if (result.error && !result.cancelled) {
        void vscode.window.showErrorMessage(result.error.message);
      }
    }),
    vscode.commands.registerCommand("dbExplorer.openTable", (item?: unknown) =>
      openTableService.open(item)
    ),
    vscode.commands.registerCommand("dbExplorer.dropSchema", (item?: unknown) =>
      schemaProvider.dropSchema(item)
    ),
    vscode.commands.registerCommand("dbExplorer.dropTable", (item?: unknown) =>
      schemaProvider.dropTable(item)
    ),
    vscode.commands.registerCommand("dbExplorer.truncateTable", (item?: unknown) =>
      schemaProvider.truncateTable(item)
    ),
    vscode.commands.registerCommand("dbExplorer.clearPassword", async () => {
      const profiles = connectionManager.listProfiles();
      if (profiles.length === 0) {
        void vscode.window.showWarningMessage(
          "No profiles configured. Run \"DB Explorer: Add Connection\" or edit settings.json."
        );
        return;
      }

      const picked = await vscode.window.showQuickPick(
        profiles.map((profile) => ({
          label: profile.label,
          description: `${profile.user}@${profile.host}:${profile.port}/${profile.database}`,
          profile
        })),
        { placeHolder: "Select a profile to clear stored password" }
      );

      if (!picked) {
        return;
      }

      await connectionManager.clearStoredPassword(picked.profile.id);
      void vscode.window.showInformationMessage(
        `Cleared stored password for ${picked.profile.label}.`
      );
    })
  );

  const restoreLastProfile = async (): Promise<void> => {
    if (connectionManager.getActiveProfileId()) {
      return;
    }

    const lastProfileId = context.workspaceState.get<string>(lastProfileStateKey);
    if (!lastProfileId) {
      return;
    }

    const profiles = connectionManager.listProfiles();
    if (!profiles.some((profile) => profile.id === lastProfileId)) {
      await context.workspaceState.update(lastProfileStateKey, undefined);
      return;
    }

    try {
      await connectionManager.connect(lastProfileId);
    } catch (error) {
      if (error instanceof Error && error.message === "Connection canceled.") {
        return;
      }
      const message =
        error instanceof Error ? error.message : "Failed to connect to DB.";
      void vscode.window.showErrorMessage(message);
    }
  };

  void restoreLastProfile();
}

export function deactivate(): void {}
