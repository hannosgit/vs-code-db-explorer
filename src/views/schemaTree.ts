import * as vscode from "vscode";
import { Pool } from "pg";
import { ConnectionManager } from "../connections/connectionManager";

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

class ColumnItem extends vscode.TreeItem {
  constructor(
    public readonly schemaName: string,
    public readonly tableName: string,
    public readonly columnName: string,
    dataType: string,
    isNullable: string
  ) {
    super(columnName, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "dbColumn";
    const nullableSuffix = isNullable === "YES" ? "" : " not null";
    this.description = `${dataType}${nullableSuffix}`;
    this.iconPath = new vscode.ThemeIcon("symbol-field");
  }
}

type SchemaNode = SchemaPlaceholderItem | SchemaErrorItem | SchemaItem | TableItem | ColumnItem;

interface SchemaRow {
  nspname: string;
}

interface TableRow {
  table_name: string;
}

interface ColumnRow {
  column_name: string;
  data_type: string;
  is_nullable: string;
}

interface TableContext {
  schemaName: string;
  tableName: string;
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

  async dropTable(item?: unknown): Promise<void> {
    const table = this.toTableContext(item);
    if (!table) {
      void vscode.window.showWarningMessage("Select a table in the DB Schema view.");
      return;
    }

    const pool = this.connectionManager.getPool();
    if (!pool) {
      void vscode.window.showWarningMessage("Connect to a DB profile first.");
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

    const qualifiedName = `${this.quoteIdentifier(table.schemaName)}.${this.quoteIdentifier(
      table.tableName
    )}`;

    try {
      await pool.query(`DROP TABLE ${qualifiedName}`);
      this.refresh();
      void vscode.window.showInformationMessage(`Dropped table ${displayName}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      void vscode.window.showErrorMessage(`Failed to drop table ${displayName}: ${message}`);
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
      return this.getTables(element.schemaName);
    }

    if (element instanceof TableItem) {
      return this.getColumns(element.schemaName, element.tableName);
    }

    return [];
  }

  private getPoolOrPlaceholder(): Pool | SchemaPlaceholderItem[] {
    const pool = this.connectionManager.getPool();
    if (!pool) {
      return [
        new SchemaPlaceholderItem("No active connection"),
        new SchemaPlaceholderItem("Connect to load schema")
      ];
    }
    return pool;
  }

  private async getSchemas(): Promise<SchemaNode[]> {
    const poolOrPlaceholder = this.getPoolOrPlaceholder();
    if (Array.isArray(poolOrPlaceholder)) {
      return poolOrPlaceholder;
    }

    const pool = poolOrPlaceholder;
    try {
      const result = await pool.query<SchemaRow>(
        "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY nspname"
      );
      if (result.rows.length === 0) {
        return [new SchemaPlaceholderItem("No schemas found")];
      }
      return result.rows.map((row) => new SchemaItem(row.nspname));
    } catch (error) {
      return [this.toErrorItem("Failed to load schemas", error)];
    }
  }

  private async getTables(schemaName: string): Promise<SchemaNode[]> {
    const poolOrPlaceholder = this.getPoolOrPlaceholder();
    if (Array.isArray(poolOrPlaceholder)) {
      return poolOrPlaceholder;
    }

    const pool = poolOrPlaceholder;
    try {
      const result = await pool.query<TableRow>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name",
        [schemaName]
      );
      if (result.rows.length === 0) {
        return [new SchemaPlaceholderItem("No tables found")];
      }
      return result.rows.map((row) => new TableItem(schemaName, row.table_name));
    } catch (error) {
      return [this.toErrorItem(`Failed to load tables for ${schemaName}`, error)];
    }
  }

  private async getColumns(schemaName: string, tableName: string): Promise<SchemaNode[]> {
    const poolOrPlaceholder = this.getPoolOrPlaceholder();
    if (Array.isArray(poolOrPlaceholder)) {
      return poolOrPlaceholder;
    }

    const pool = poolOrPlaceholder;
    try {
      const result = await pool.query<ColumnRow>(
        "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
        [schemaName, tableName]
      );
      if (result.rows.length === 0) {
        return [new SchemaPlaceholderItem("No columns found")];
      }
      return result.rows.map(
        (row) =>
          new ColumnItem(schemaName, tableName, row.column_name, row.data_type, row.is_nullable)
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

  private quoteIdentifier(value: string): string {
    return `"${value.replace(/"/g, "\"\"")}"`;
  }
}
