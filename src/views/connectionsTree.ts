import * as vscode from "vscode";
import { ConnectionManager, ConnectionProfile } from "../connections/connectionManager";

class ConnectionItem extends vscode.TreeItem {
  constructor(
    public readonly profile: ConnectionProfile,
    isActive: boolean
  ) {
    super(profile.label, vscode.TreeItemCollapsibleState.None);
    this.id = profile.id;
    this.description = `${profile.user}@${profile.host}:${profile.port}/${profile.database}`;
    this.contextValue = "dbConnection";
    this.iconPath = new vscode.ThemeIcon(isActive ? "plug" : "circle-outline");
  }
}

class PlaceholderItem extends vscode.TreeItem {
  constructor(label: string, command?: vscode.Command) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "dbPlaceholder";
    this.command = command;
    if (command) {
      this.iconPath = new vscode.ThemeIcon("add");
    }
  }
}

function getProfilesTarget(): vscode.ConfigurationTarget {
  return vscode.workspace.workspaceFolders
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;
}

export class ConnectionsTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly connectionManager: ConnectionManager) {
    this.connectionManager.onDidChangeActive(() => this.refresh());
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  async deleteConnection(item?: unknown): Promise<void> {
    const profiles = this.connectionManager.listProfiles();
    if (profiles.length === 0) {
      void vscode.window.showWarningMessage(
        "No profiles configured. Run \"DB Explorer: Add Connection\" or edit settings.json."
      );
      return;
    }

    const profile = await this.resolveProfileToDelete(item, profiles);
    if (!profile) {
      return;
    }

    const action = await vscode.window.showWarningMessage(
      `Delete connection ${profile.label}?`,
      {
        modal: true,
        detail: "This removes the connection profile from settings and clears its stored password."
      },
      "Delete Connection"
    );

    if (action !== "Delete Connection") {
      return;
    }

    try {
      if (this.connectionManager.getActiveProfileId() === profile.id) {
        await this.connectionManager.disconnect();
      }

      const config = vscode.workspace.getConfiguration("dbExplorer");
      await config.update(
        "profiles",
        profiles.filter((candidate) => candidate.id !== profile.id),
        getProfilesTarget()
      );

      await this.connectionManager.clearStoredPassword(profile.id);
      this.refresh();

      void vscode.window.showInformationMessage(`Deleted connection ${profile.label}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      void vscode.window.showErrorMessage(
        `Failed to delete connection ${profile.label}: ${message}`
      );
    }
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<vscode.TreeItem[]> {
    const profiles = this.connectionManager.listProfiles();
    if (profiles.length === 0) {
      return [
        new PlaceholderItem("No profiles configured"),
        new PlaceholderItem("Create a connection profile", {
          command: "dbExplorer.addConnection",
          title: "DB Explorer: Add Connection"
        })
      ];
    }

    const activeId = this.connectionManager.getActiveProfileId();
    return profiles.map((profile) => new ConnectionItem(profile, profile.id === activeId));
  }

  private async resolveProfileToDelete(
    item: unknown,
    profiles: ConnectionProfile[]
  ): Promise<ConnectionProfile | undefined> {
    if (item === undefined) {
      const picked = await vscode.window.showQuickPick(
        profiles.map((profile) => ({
          label: profile.label,
          description: `${profile.user}@${profile.host}:${profile.port}/${profile.database}`,
          profile
        })),
        { placeHolder: "Select a DB Explorer connection to delete" }
      );

      return picked?.profile;
    }

    const profileId = this.toProfileId(item);
    if (!profileId) {
      void vscode.window.showWarningMessage("Select a connection in the DB Connections view.");
      return undefined;
    }

    const profile = profiles.find((candidate) => candidate.id === profileId);
    if (!profile) {
      void vscode.window.showWarningMessage(`Connection profile "${profileId}" not found.`);
      return undefined;
    }

    return profile;
  }

  private toProfileId(value: unknown): string | undefined {
    if (value instanceof ConnectionItem) {
      return value.profile.id;
    }

    if (!value || typeof value !== "object") {
      return undefined;
    }

    const maybe = value as {
      id?: unknown;
      profile?: unknown;
    };

    if (typeof maybe.id === "string") {
      return maybe.id;
    }

    if (!maybe.profile || typeof maybe.profile !== "object") {
      return undefined;
    }

    const profile = maybe.profile as { id?: unknown };
    if (typeof profile.id !== "string") {
      return undefined;
    }

    return profile.id;
  }
}
