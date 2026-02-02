import * as vscode from "vscode";
import { ConnectionManager } from "./connections/connectionManager";
import { runCancelableQuery } from "./query/queryRunner";
import { getSqlToRun } from "./query/sqlText";
import { ConnectionsTreeDataProvider } from "./views/connectionsTree";
import { SchemaTreeDataProvider } from "./views/schemaTree";
import { ResultsPanel } from "./webviews/resultsPanel";
import { showNotImplemented } from "./utils/notifications";

export function activate(context: vscode.ExtensionContext): void {
  const connectionManager = new ConnectionManager(context.secrets);
  const connectionsProvider = new ConnectionsTreeDataProvider(connectionManager);
  const schemaProvider = new SchemaTreeDataProvider(connectionManager);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("postgresConnections", connectionsProvider),
    vscode.window.registerTreeDataProvider("postgresSchema", schemaProvider)
  );

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.command = "postgres.connect";
  statusBar.text = "Postgres: Disconnected";
  statusBar.show();
  context.subscriptions.push(statusBar);

  connectionManager.onDidChangeActive((state) => {
    if (state.activeProfileId) {
      statusBar.text = `Postgres: ${state.activeProfileId}`;
      statusBar.command = "postgres.disconnect";
    } else {
      statusBar.text = "Postgres: Disconnected";
      statusBar.command = "postgres.connect";
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand("postgres.connect", async () => {
      const profiles = connectionManager.listProfiles();
      if (profiles.length === 0) {
        void vscode.window.showWarningMessage(
          "No profiles configured. Add profiles in settings.json."
        );
        return;
      }

      const picked = await vscode.window.showQuickPick(
        profiles.map((profile) => ({
          label: profile.label,
          description: `${profile.user}@${profile.host}:${profile.port}/${profile.database}`,
          profile
        })),
        { placeHolder: "Select a Postgres connection" }
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
          error instanceof Error ? error.message : "Failed to connect to Postgres.";
        void vscode.window.showErrorMessage(message);
      }
    }),
    vscode.commands.registerCommand("postgres.disconnect", async () => {
      await connectionManager.disconnect();
      connectionsProvider.refresh();
      schemaProvider.refresh();
    }),
    vscode.commands.registerCommand("postgres.refreshSchema", () => {
      schemaProvider.refresh();
    }),
    vscode.commands.registerCommand("postgres.runQuery", async (resource?: vscode.Uri) => {
      let editor = vscode.window.activeTextEditor;

      if (resource) {
        const activeUri = editor?.document.uri.toString();
        if (!activeUri || activeUri !== resource.toString()) {
          const document = await vscode.workspace.openTextDocument(resource);
          editor = await vscode.window.showTextDocument(document, { preview: false });
        }
      }

      if (!editor) {
        void vscode.window.showWarningMessage("Open a SQL file to run a query.");
        return;
      }

      const sql = getSqlToRun(editor);
      if (!sql) {
        void vscode.window.showWarningMessage("No SQL statement selected or found.");
        return;
      }

      const pool = connectionManager.getPool();
      if (!pool) {
        void vscode.window.showWarningMessage("Connect to a Postgres profile first.");
        return;
      }

      const panel = ResultsPanel.createOrShow(context.extensionUri);
      panel.showLoading(sql);
      panel.setCancelHandler(undefined);

      const { promise, cancel } = runCancelableQuery(pool, sql);
      panel.setCancelHandler(cancel);

      const result = await promise;
      panel.setCancelHandler(undefined);
      panel.showResults(result);

      if (result.error && !result.cancelled) {
        void vscode.window.showErrorMessage(result.error.message);
      }
    }),
    vscode.commands.registerCommand("postgres.openTable", () => {
      showNotImplemented("Open Table");
    }),
    vscode.commands.registerCommand("postgres.exportResults", () => {
      showNotImplemented("Export Results");
    }),
    vscode.commands.registerCommand("postgres.clearPassword", async () => {
      const profiles = connectionManager.listProfiles();
      if (profiles.length === 0) {
        void vscode.window.showWarningMessage(
          "No profiles configured. Add profiles in settings.json."
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
}

export function deactivate(): void {}
