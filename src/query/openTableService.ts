import * as vscode from "vscode";
import { ConnectionManager } from "../connections/connectionManager";
import {
  TableDataProvider,
  TableDataChange,
  TableDeleteChange,
  TableInsertChange,
  TableReference,
  TableSort,
  TableSortDirection,
  TableUpdateChange
} from "../databases/contracts";
import {
  PostgresConnectionDriver,
  PostgresPoolLike
} from "../databases/postgres/postgresConnectionDriver";
import { PostgresTableDataProvider } from "../databases/postgres/postgresTableDataProvider";
import {
  DataEditorChange,
  DataEditorDeleteChange,
  DataEditorInsertChange,
  DataEditorPanel,
  DataEditorState,
  DataEditorUpdateChange,
  EditorRow
} from "../webviews/dataEditorPanel";
import { ResultsPanel } from "../webviews/resultsPanel";

const DATA_EDITOR_PAGE_SIZE = 100;

type TableContext = TableReference;

export class OpenTableService {
  private panel?: DataEditorPanel;
  private activeTable?: TableContext;
  private activeState?: DataEditorState;
  private activeRowTokens: string[] = [];
  private currentPage = 0;
  private currentSortColumn?: string;
  private currentSortDirection: TableSortDirection = "asc";

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly extensionUri: vscode.Uri
  ) {}

  async open(item?: unknown): Promise<void> {
    const table = this.toTableContext(item);
    if (!table) {
      void vscode.window.showWarningMessage("Select a table in the DB Schema view.");
      return;
    }

    if (!this.getTableDataProvider()) {
      void vscode.window.showWarningMessage("Connect to a DB profile first.");
      return;
    }

    this.activeTable = table;
    this.currentPage = 0;
    this.currentSortColumn = undefined;
    this.currentSortDirection = "asc";
    const viewColumn = ResultsPanel.getViewColumn();
    ResultsPanel.disposeCurrentPanel();
    const panel = DataEditorPanel.createOrShow(this.extensionUri, viewColumn);
    this.panel = panel;
    panel.setSaveHandler((changes) => this.saveChanges(changes));
    panel.setRefreshHandler(() => this.reload());
    panel.setPageHandler((direction) => this.changePage(direction));
    panel.setSortHandler((columnIndex) => this.changeSort(columnIndex));

    const pageSize = this.normalizePageSize(DATA_EDITOR_PAGE_SIZE);

    const loadingState: DataEditorState = {
      schemaName: table.schemaName,
      tableName: table.tableName,
      columns: [],
      rows: [],
      pageSize,
      pageNumber: this.currentPage + 1,
      hasNextPage: false,
      loading: true
    };
    panel.showState(loadingState);

    await this.reload();
  }

  private toTableContext(value: unknown): TableContext | undefined {
    if (!value || typeof value !== "object") {
      return undefined;
    }

    const maybe = value as { schemaName?: unknown; tableName?: unknown };
    if (typeof maybe.schemaName !== "string" || typeof maybe.tableName !== "string") {
      return undefined;
    }

    return { schemaName: maybe.schemaName, tableName: maybe.tableName };
  }

  private buildOpenTableSql(
    schemaName: string,
    tableName: string,
    limit: number,
    offset: number,
    sortBy?: TableSort
  ): string {
    return PostgresTableDataProvider.buildOpenTableSql(
      schemaName,
      tableName,
      limit,
      offset,
      sortBy
    );
  }

  private buildColumnTypesSql(): string {
    return PostgresTableDataProvider.buildColumnTypesSql();
  }

  private buildColumnEnumValuesSql(): string {
    return PostgresTableDataProvider.buildColumnEnumValuesSql();
  }

  private async loadColumnTypes(
    table: TableContext,
    columns: string[]
  ): Promise<string[]> {
    const pool = this.connectionManager.getPool();
    if (!pool || columns.length === 0) {
      return [];
    }

    return PostgresTableDataProvider.loadColumnTypes(pool, table, columns);
  }

  private async loadColumnEnumValues(
    table: TableContext,
    columns: string[]
  ): Promise<string[][]> {
    const pool = this.connectionManager.getPool();
    if (!pool || columns.length === 0) {
      return [];
    }

    return PostgresTableDataProvider.loadColumnEnumValues(pool, table, columns);
  }

  private async reload(): Promise<void> {
    if (!this.activeTable) {
      return;
    }

    const tableDataProvider = this.getTableDataProvider();
    if (!tableDataProvider) {
      void vscode.window.showWarningMessage("Connect to a DB profile first.");
      return;
    }

    const pageSize = this.normalizePageSize(DATA_EDITOR_PAGE_SIZE);

    try {
      const page = await tableDataProvider.loadPage({
        table: this.activeTable,
        pageSize,
        pageIndex: this.currentPage,
        sortBy: this.currentSortColumn
          ? {
              columnName: this.currentSortColumn,
              direction: this.currentSortDirection
            }
          : undefined
      });
      const columns = page.columns.map((column) => column.name);
      const columnTypes = page.columns.map((column) => column.dataType ?? "");
      const columnEnumValues = page.columns.map((column) => column.enumValues ?? []);
      const state: DataEditorState = {
        schemaName: this.activeTable.schemaName,
        tableName: this.activeTable.tableName,
        columns,
        columnTypes,
        columnEnumValues,
        rows: page.rows.map((row) => this.toEditorRowFromValues(row.values)),
        pageSize: page.pageSize,
        pageNumber: this.currentPage + 1,
        hasNextPage: page.hasNextPage,
        sortColumn: this.currentSortColumn,
        sortDirection: this.currentSortColumn ? this.currentSortDirection : undefined
      };
      this.activeState = state;
      this.activeRowTokens = page.rows.map((row) => row.rowLocator ?? "");
      this.panel?.showState(state);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load table data.";
      const state: DataEditorState = {
        schemaName: this.activeTable.schemaName,
        tableName: this.activeTable.tableName,
        columns: [],
        rows: [],
        pageSize,
        pageNumber: this.currentPage + 1,
        hasNextPage: false,
        sortColumn: this.currentSortColumn,
        sortDirection: this.currentSortColumn ? this.currentSortDirection : undefined,
        error: message
      };
      this.activeState = state;
      this.activeRowTokens = [];
      this.panel?.showState(state);
    }
  }

  private async changePage(direction: "previous" | "next"): Promise<void> {
    if (direction === "previous") {
      if (this.currentPage === 0) {
        return;
      }
      this.currentPage -= 1;
      await this.reload();
      return;
    }

    if (!this.activeState?.hasNextPage) {
      return;
    }

    this.currentPage += 1;
    await this.reload();
  }

  private async saveChanges(changes: DataEditorChange[]): Promise<void> {
    if (!changes.length) {
      void vscode.window.showInformationMessage("No changes to save.");
      return;
    }

    const table = this.activeTable;
    const state = this.activeState;
    if (!table || !state || state.columns.length === 0) {
      void vscode.window.showWarningMessage("Reload the table before saving changes.");
      return;
    }

    const tableDataProvider = this.getTableDataProvider();
    if (!tableDataProvider) {
      void vscode.window.showWarningMessage("Connect to a DB profile first.");
      return;
    }

    try {
      const mappedChanges = this.toTableDataChanges(changes);
      const { updatedRows, insertedRows, deletedRows } = await tableDataProvider.saveChanges({
        table,
        columns: state.columns,
        changes: mappedChanges
      });

      const summaryParts: string[] = [];
      if (updatedRows > 0) {
        summaryParts.push(`${updatedRows} updated`);
      }
      if (insertedRows > 0) {
        summaryParts.push(`${insertedRows} inserted`);
      }
      if (deletedRows > 0) {
        summaryParts.push(`${deletedRows} deleted`);
      }
      const summary = summaryParts.length > 0 ? summaryParts.join(", ") : "no rows affected";
      void vscode.window.showInformationMessage(
        `Saved changes: ${summary}.`
      );
      await this.reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save changes.";
      void vscode.window.showErrorMessage(message);
    }
  }

  private async changeSort(columnIndex: number): Promise<void> {
    const columns = this.activeState?.columns ?? [];
    const columnName = columns[columnIndex];
    if (!columnName) {
      return;
    }

    if (this.currentSortColumn === columnName) {
      this.currentSortDirection = this.currentSortDirection === "asc" ? "desc" : "asc";
    } else {
      this.currentSortColumn = columnName;
      this.currentSortDirection = "asc";
    }

    this.currentPage = 0;
    await this.reload();
  }

  private toTableDataChanges(changes: DataEditorChange[]): TableDataChange[] {
    const mapped: TableDataChange[] = [];

    for (const change of changes) {
      if (change.kind === "insert") {
        const insertChange: TableInsertChange = {
          kind: "insert",
          values: change.values.map((value) => ({
            columnIndex: value.columnIndex,
            value: value.value,
            isNull: value.isNull
          }))
        };
        mapped.push(insertChange);
        continue;
      }

      const rowToken = this.activeRowTokens[change.rowIndex];
      if (!rowToken) {
        continue;
      }

      if (change.kind === "delete") {
        const deleteChange: TableDeleteChange = {
          kind: "delete",
          rowLocator: rowToken
        };
        mapped.push(deleteChange);
        continue;
      }

      const updateChange: TableUpdateChange = {
        kind: "update",
        rowLocator: rowToken,
        updates: change.updates.map((update) => ({
          columnIndex: update.columnIndex,
          value: update.value,
          isNull: update.isNull
        }))
      };
      mapped.push(updateChange);
    }

    return mapped;
  }

  private getTableDataProvider(): TableDataProvider | undefined {
    const manager = this.connectionManager as unknown as {
      getSession?: () => { tableDataProvider: TableDataProvider } | undefined;
      getPool?: () => unknown;
    };

    const session =
      typeof manager.getSession === "function" ? manager.getSession() : undefined;
    if (session) {
      return session.tableDataProvider;
    }

    if (typeof manager.getPool !== "function") {
      return undefined;
    }

    const pool = manager.getPool();
    if (!pool) {
      return undefined;
    }

    return new PostgresTableDataProvider(
      new PostgresConnectionDriver(pool as PostgresPoolLike)
    );
  }

  private buildUpdateStatement(
    table: TableContext,
    columns: string[],
    change: DataEditorUpdateChange,
    rowToken: string
  ): { sql: string; values: unknown[] } | undefined {
    const updateChange: TableUpdateChange = {
      kind: "update",
      rowLocator: rowToken,
      updates: change.updates.map((update) => ({
        columnIndex: update.columnIndex,
        value: update.value,
        isNull: update.isNull
      }))
    };

    return PostgresTableDataProvider.buildUpdateStatement(table, columns, updateChange);
  }

  private buildInsertStatement(
    table: TableContext,
    columns: string[],
    change: DataEditorInsertChange
  ): { sql: string; values: unknown[] } | undefined {
    const insertChange: TableInsertChange = {
      kind: "insert",
      values: change.values.map((value) => ({
        columnIndex: value.columnIndex,
        value: value.value,
        isNull: value.isNull
      }))
    };

    return PostgresTableDataProvider.buildInsertStatement(table, columns, insertChange);
  }

  private buildDeleteStatement(
    table: TableContext,
    change: DataEditorDeleteChange,
    rowToken: string
  ): { sql: string; values: unknown[] } | undefined {
    const deleteChange: TableDeleteChange = {
      kind: "delete",
      rowLocator: rowToken
    };

    return PostgresTableDataProvider.buildDeleteStatement(table, deleteChange);
  }

  private toEditorRow(row: Record<string, unknown>, columns: string[]): EditorRow {
    return this.toEditorRowFromValues(columns.map((column) => row[column]));
  }

  private toEditorRowFromValues(rowValues: unknown[]): EditorRow {
    const values: string[] = [];
    const nulls: boolean[] = [];
    rowValues.forEach((value) => {
      if (value === null || value === undefined) {
        values.push("");
        nulls.push(true);
      } else {
        values.push(this.formatValue(value));
        nulls.push(false);
      }
    });
    return { values, nulls };
  }

  private formatValue(value: unknown): string {
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (Buffer.isBuffer(value)) {
      return `\\x${value.toString("hex")}`;
    }
    if (typeof value === "object") {
      try {
        return JSON.stringify(value);
      } catch {
        return String(value);
      }
    }
    return String(value);
  }

  private normalizePageSize(limit: number): number {
    return PostgresTableDataProvider.normalizePageSize(limit, DATA_EDITOR_PAGE_SIZE);
  }

  private quoteIdentifier(identifier: string): string {
    return PostgresTableDataProvider.quoteIdentifier(identifier);
  }
}
