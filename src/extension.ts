import * as vscode from "vscode";
import { ConnectionManager } from "./connections/connectionManager";
import { ConnectionsTreeDataProvider } from "./views/connectionsTree";
import { SchemaTreeDataProvider } from "./views/schemaTree";
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

      await connectionManager.connect(picked.profile.id);
      connectionsProvider.refresh();
      schemaProvider.refresh();
    }),
    vscode.commands.registerCommand("postgres.disconnect", async () => {
      await connectionManager.disconnect();
      connectionsProvider.refresh();
      schemaProvider.refresh();
    }),
    vscode.commands.registerCommand("postgres.refreshSchema", () => {
      schemaProvider.refresh();
    }),
    vscode.commands.registerCommand("postgres.runQuery", () => {
      showNotImplemented("Run Query");
    }),
    vscode.commands.registerCommand("postgres.openTable", () => {
      showNotImplemented("Open Table");
    }),
    vscode.commands.registerCommand("postgres.exportResults", () => {
      showNotImplemented("Export Results");
    })
  );
}

export function deactivate(): void {}
