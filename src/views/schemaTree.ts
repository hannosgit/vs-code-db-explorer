import * as vscode from "vscode";
import { ConnectionManager } from "../connections/connectionManager";

class SchemaPlaceholderItem extends vscode.TreeItem {
  constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "postgresSchemaPlaceholder";
  }
}

export class SchemaTreeDataProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
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
    const activeId = this.connectionManager.getActiveProfileId();
    if (!activeId) {
      return [
        new SchemaPlaceholderItem("No active connection"),
        new SchemaPlaceholderItem("Connect to load schema")
      ];
    }

    return [new SchemaPlaceholderItem(`Connected to ${activeId}`)];
  }
}
