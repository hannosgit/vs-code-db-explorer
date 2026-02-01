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
    this.contextValue = "postgresConnection";
    this.iconPath = new vscode.ThemeIcon(isActive ? "plug" : "circle-outline");
  }
}

class PlaceholderItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "postgresPlaceholder";
  }
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

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.ProviderResult<vscode.TreeItem[]> {
    const profiles = this.connectionManager.listProfiles();
    if (profiles.length === 0) {
      return [
        new PlaceholderItem("No profiles configured"),
        new PlaceholderItem("Add profiles in settings.json")
      ];
    }

    const activeId = this.connectionManager.getActiveProfileId();
    return profiles.map((profile) => new ConnectionItem(profile, profile.id === activeId));
  }
}
