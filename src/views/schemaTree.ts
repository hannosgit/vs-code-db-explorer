import * as vscode from "vscode";
import { ConnectionManager } from "../connections/connectionManager";
import { SchemaProvider } from "../databases/contracts";
import { PostgresConnectionDriver } from "../databases/postgres/postgresConnectionDriver";
import { PostgresSchemaProvider } from "../databases/postgres/postgresSchemaProvider";

type SchemaCollectionKind = "tables" | "views";

class SchemaPlaceholderItem extends vscode.TreeItem {
  constructor(label: string, description?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "dbSchemaPlaceholder";
    if (description) {
      this.description = description;
    }
  }
}

class SchemaErrorItem extends vscode.TreeItem {
  constructor(label: string, description?: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "dbSchemaError";
    this.iconPath = new vscode.ThemeIcon("error");
    if (description) {
      this.description = description;
      this.tooltip = description;
    }
  }
}

class SchemaItem extends vscode.TreeItem {
  constructor(public readonly schemaName: string) {
    super(schemaName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "dbSchema";
    this.iconPath = new vscode.ThemeIcon("symbol-namespace");
  }
}

class SchemaCollectionItem extends vscode.TreeItem {
  constructor(
    public readonly schemaName: string,
    public readonly kind: SchemaCollectionKind
  ) {
    super(kind, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "dbSchemaCollection";
    this.iconPath = new vscode.ThemeIcon(kind === "tables" ? "table" : "eye");
  }
}

class TableItem extends vscode.TreeItem {
  constructor(
    public readonly schemaName: string,
    public readonly tableName: string
  ) {
    super(tableName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "dbTable";
    this.iconPath = new vscode.ThemeIcon("table");
  }
}

class ViewItem extends vscode.TreeItem {
  constructor(
    public readonly schemaName: string,
    public readonly viewName: string
  ) {
    super(viewName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = "dbView";
    this.iconPath = new vscode.ThemeIcon("eye");
  }
}

class ColumnItem extends vscode.TreeItem {
  constructor(
    public readonly schemaName: string,
    public readonly tableName: string,
    public readonly columnName: string,
    dataType: string,
    isNullable: boolean
  ) {
    super(columnName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "dbColumn";
    const nullableSuffix = isNullable ? "" : " not null";
    this.description = `${dataType}${nullableSuffix}`;
    this.iconPath = new vscode.ThemeIcon("symbol-field");
  }
}

type SchemaNode =
  | SchemaPlaceholderItem
  | SchemaErrorItem
  | SchemaItem
  | SchemaCollectionItem
  | TableItem
  | ViewItem
  | ColumnItem;

interface TableContext {
  schemaName: string;
  tableName: string;
}

interface SchemaContext {
  schemaName: string;
}

export class SchemaTreeDataProvider implements vscode.TreeDataProvider<SchemaNode> {
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<SchemaNode | undefined>();
  readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  constructor(private readonly connectionManager: ConnectionManager) {
    this.connectionManager.onDidChangeActive(() => this.refresh());
  }

  refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  async dropSchema(item?: unknown): Promise<void> {
    const schema = this.toSchemaContext(item);
    if (!schema) {
      void vscode.window.showWarningMessage("Select a schema in the DB Schema view.");
      return;
    }

    const action = await vscode.window.showWarningMessage(
      `Drop schema ${schema.schemaName}?`,
      {
        modal: true,
        detail: "All objects in this schema will be dropped and this action cannot be undone."
      },
      "Drop Schema"
    );

    if (action !== "Drop Schema") {
      return;
    }

    const schemaProviderOrPlaceholder = this.getSchemaProviderOrPlaceholder();
    if (Array.isArray(schemaProviderOrPlaceholder)) {
      void vscode.window.showWarningMessage("Connect to a DB profile first.");
      return;
    }

    try {
      await schemaProviderOrPlaceholder.dropSchema(schema.schemaName);
      this.refresh();
      void vscode.window.showInformationMessage(`Dropped schema ${schema.schemaName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      void vscode.window.showErrorMessage(
        `Failed to drop schema ${schema.schemaName}: ${message}`
      );
    }
  }

  async dropTable(item?: unknown): Promise<void> {
    const table = this.toTableContext(item);
    if (!table) {
      void vscode.window.showWarningMessage("Select a table in the DB Schema view.");
      return;
    }

    const displayName = `${table.schemaName}.${table.tableName}`;
    const action = await vscode.window.showWarningMessage(
      `Drop table ${displayName}?`,
      { modal: true, detail: "This action cannot be undone." },
      "Drop Table"
    );

    if (action !== "Drop Table") {
      return;
    }

    const schemaProviderOrPlaceholder = this.getSchemaProviderOrPlaceholder();
    if (Array.isArray(schemaProviderOrPlaceholder)) {
      void vscode.window.showWarningMessage("Connect to a DB profile first.");
      return;
    }

    try {
      await schemaProviderOrPlaceholder.dropTable(table);
      this.refresh();
      void vscode.window.showInformationMessage(`Dropped table ${displayName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      void vscode.window.showErrorMessage(`Failed to drop table ${displayName}: ${message}`);
    }
  }

  async truncateTable(item?: unknown): Promise<void> {
    const table = this.toTableContext(item);
    if (!table) {
      void vscode.window.showWarningMessage("Select a table in the DB Schema view.");
      return;
    }

    const displayName = `${table.schemaName}.${table.tableName}`;
    const action = await vscode.window.showWarningMessage(
      `Truncate table ${displayName}?`,
      { modal: true, detail: "This will delete all rows and cannot be undone." },
      "Truncate Table"
    );

    if (action !== "Truncate Table") {
      return;
    }

    const schemaProviderOrPlaceholder = this.getSchemaProviderOrPlaceholder();
    if (Array.isArray(schemaProviderOrPlaceholder)) {
      void vscode.window.showWarningMessage("Connect to a DB profile first.");
      return;
    }

    try {
      await schemaProviderOrPlaceholder.truncateTable(table);
      this.refresh();
      void vscode.window.showInformationMessage(`Truncated table ${displayName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      void vscode.window.showErrorMessage(`Failed to truncate table ${displayName}: ${message}`);
    }
  }

  getTreeItem(element: SchemaNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SchemaNode): vscode.ProviderResult<SchemaNode[]> {
    if (!element) {
      return this.getSchemas();
    }

    if (element instanceof SchemaItem) {
      return this.getSchemaCollections(element.schemaName);
    }

    if (element instanceof SchemaCollectionItem) {
      if (element.kind === "tables") {
        return this.getTables(element.schemaName);
      }
      return this.getViews(element.schemaName);
    }

    if (element instanceof TableItem) {
      return this.getColumns(element.schemaName, element.tableName);
    }

    if (element instanceof ViewItem) {
      return this.getColumns(element.schemaName, element.viewName);
    }

    return [];
  }

  private getSchemaProviderOrPlaceholder(): SchemaProvider | SchemaPlaceholderItem[] {
    const session = this.connectionManager.getSession();
    if (session) {
      return session.schemaProvider;
    }

    const pool = this.connectionManager.getPool();
    if (pool) {
      return new PostgresSchemaProvider(new PostgresConnectionDriver(pool));
    }

    return [
      new SchemaPlaceholderItem("No active connection"),
      new SchemaPlaceholderItem("Connect to load schema")
    ];
  }

  private async getSchemas(): Promise<SchemaNode[]> {
    const schemaProviderOrPlaceholder = this.getSchemaProviderOrPlaceholder();
    if (Array.isArray(schemaProviderOrPlaceholder)) {
      return schemaProviderOrPlaceholder;
    }

    try {
      const schemas = await schemaProviderOrPlaceholder.listSchemas();
      if (schemas.length === 0) {
        return [new SchemaPlaceholderItem("No schemas found")];
      }
      return schemas.map((schema) => new SchemaItem(schema.name));
    } catch (error) {
      return [this.toErrorItem("Failed to load schemas", error)];
    }
  }

  private getSchemaCollections(schemaName: string): SchemaNode[] {
    return [
      new SchemaCollectionItem(schemaName, "tables"),
      new SchemaCollectionItem(schemaName, "views")
    ];
  }

  private async getTables(schemaName: string): Promise<SchemaNode[]> {
    const schemaProviderOrPlaceholder = this.getSchemaProviderOrPlaceholder();
    if (Array.isArray(schemaProviderOrPlaceholder)) {
      return schemaProviderOrPlaceholder;
    }

    try {
      const tables = await schemaProviderOrPlaceholder.listTables(schemaName);
      if (tables.length === 0) {
        return [new SchemaPlaceholderItem("No tables found")];
      }
      return tables.map((table) => new TableItem(table.schemaName, table.name));
    } catch (error) {
      return [this.toErrorItem(`Failed to load tables for ${schemaName}`, error)];
    }
  }

  private async getViews(schemaName: string): Promise<SchemaNode[]> {
    const schemaProviderOrPlaceholder = this.getSchemaProviderOrPlaceholder();
    if (Array.isArray(schemaProviderOrPlaceholder)) {
      return schemaProviderOrPlaceholder;
    }

    try {
      const views = await schemaProviderOrPlaceholder.listViews(schemaName);
      if (views.length === 0) {
        return [new SchemaPlaceholderItem("No views found")];
      }
      return views.map((view) => new ViewItem(view.schemaName, view.name));
    } catch (error) {
      return [this.toErrorItem(`Failed to load views for ${schemaName}`, error)];
    }
  }

  private async getColumns(schemaName: string, tableName: string): Promise<SchemaNode[]> {
    const schemaProviderOrPlaceholder = this.getSchemaProviderOrPlaceholder();
    if (Array.isArray(schemaProviderOrPlaceholder)) {
      return schemaProviderOrPlaceholder;
    }

    try {
      const columns = await schemaProviderOrPlaceholder.listColumns({ schemaName, tableName });
      if (columns.length === 0) {
        return [new SchemaPlaceholderItem("No columns found")];
      }
      return columns.map(
        (row) =>
          new ColumnItem(schemaName, tableName, row.name, row.dataType, row.isNullable)
      );
    } catch (error) {
      return [this.toErrorItem(`Failed to load columns for ${tableName}`, error)];
    }
  }

  private toErrorItem(label: string, error: unknown): SchemaErrorItem {
    if (error instanceof Error) {
      return new SchemaErrorItem(label, error.message);
    }
    return new SchemaErrorItem(label, "Unknown error");
  }

  private toTableContext(value: unknown): TableContext | undefined {
    if (value instanceof TableItem) {
      return {
        schemaName: value.schemaName,
        tableName: value.tableName
      };
    }

    if (!value || typeof value !== "object") {
      return undefined;
    }

    const maybe = value as { schemaName?: unknown; tableName?: unknown };
    if (typeof maybe.schemaName !== "string" || typeof maybe.tableName !== "string") {
      return undefined;
    }

    return {
      schemaName: maybe.schemaName,
      tableName: maybe.tableName
    };
  }

  private toSchemaContext(value: unknown): SchemaContext | undefined {
    if (value instanceof SchemaItem) {
      return {
        schemaName: value.schemaName
      };
    }

    if (!value || typeof value !== "object") {
      return undefined;
    }

    const maybe = value as {
      schemaName?: unknown;
      tableName?: unknown;
      viewName?: unknown;
      kind?: unknown;
    };
    if (
      typeof maybe.schemaName !== "string" ||
      typeof maybe.tableName === "string" ||
      typeof maybe.viewName === "string" ||
      typeof maybe.kind === "string"
    ) {
      return undefined;
    }

    return {
      schemaName: maybe.schemaName
    };
  }
}
