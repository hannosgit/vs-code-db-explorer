import * as vscode from "vscode";
import { ConnectionManager } from "../connections/connectionManager";
import {
  DataEditorChange,
  DataEditorInsertChange,
  DataEditorPanel,
  DataEditorState,
  DataEditorUpdateChange,
  EditorRow
} from "../webviews/dataEditorPanel";
import { ResultsPanel } from "../webviews/resultsPanel";

const DEFAULT_ROW_LIMIT = 200;
const ROW_TOKEN_ALIAS = "__postgres_explorer_row_token__";

type TableContext = { schemaName: string; tableName: string };

export class OpenTableService {
  private panel?: DataEditorPanel;
  private activeTable?: TableContext;
  private activeState?: DataEditorState;
  private activeRowTokens: string[] = [];

  constructor(
    private readonly connectionManager: ConnectionManager,
    private readonly extensionUri: vscode.Uri,
    private readonly rowLimit = DEFAULT_ROW_LIMIT
  ) {}

  async open(item?: unknown): Promise<void> {
    const table = this.toTableContext(item);
    if (!table) {
      void vscode.window.showWarningMessage("Select a table in the Postgres Schema view.");
      return;
    }

    const pool = this.connectionManager.getPool();
    if (!pool) {
      void vscode.window.showWarningMessage("Connect to a Postgres profile first.");
      return;
    }

    this.activeTable = table;
    const viewColumn = ResultsPanel.getViewColumn();
    ResultsPanel.disposeCurrentPanel();
    const panel = DataEditorPanel.createOrShow(this.extensionUri, viewColumn);
    this.panel = panel;
    panel.setSaveHandler((changes) => this.saveChanges(changes));
    panel.setRefreshHandler(() => this.reload());

    const loadingState: DataEditorState = {
      schemaName: table.schemaName,
      tableName: table.tableName,
      columns: [],
      rows: [],
      rowLimit: this.normalizeLimit(this.rowLimit),
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

  private buildOpenTableSql(schemaName: string, tableName: string, limit: number): string {
    const qualified = `${this.quoteIdentifier(schemaName)}.${this.quoteIdentifier(tableName)}`;
    const rowToken = this.quoteIdentifier(ROW_TOKEN_ALIAS);
    return `SELECT ctid::text AS ${rowToken}, * FROM ${qualified} ORDER BY ctid LIMIT ${limit};`;
  }

  private buildColumnTypesSql(): string {
    return `
      SELECT a.attname AS column_name, pg_catalog.format_type(a.atttypid, a.atttypmod) AS column_type
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = $1
        AND c.relname = $2
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY a.attnum;
    `;
  }

  private async loadColumnTypes(
    table: TableContext,
    columns: string[]
  ): Promise<string[]> {
    const pool = this.connectionManager.getPool();
    if (!pool || columns.length === 0) {
      return [];
    }

    try {
      const result = await pool.query(this.buildColumnTypesSql(), [table.schemaName, table.tableName]);
      const typeByColumn = new Map<string, string>();
      for (const row of result.rows as Record<string, unknown>[]) {
        const columnName = row.column_name;
        const columnType = row.column_type;
        if (typeof columnName === "string" && typeof columnType === "string") {
          typeByColumn.set(columnName, columnType);
        }
      }
      return columns.map((columnName) => typeByColumn.get(columnName) ?? "");
    } catch {
      return columns.map(() => "");
    }
  }

  private async reload(): Promise<void> {
    if (!this.activeTable) {
      return;
    }

    const pool = this.connectionManager.getPool();
    if (!pool) {
      void vscode.window.showWarningMessage("Connect to a Postgres profile first.");
      return;
    }

    const limit = this.normalizeLimit(this.rowLimit);
    const sql = this.buildOpenTableSql(this.activeTable.schemaName, this.activeTable.tableName, limit);

    try {
      const result = await pool.query(sql);
      const columns = result.fields
        .map((field) => field.name)
        .filter((fieldName) => fieldName !== ROW_TOKEN_ALIAS);
      const columnTypes = await this.loadColumnTypes(this.activeTable, columns);
      const rowTokens: string[] = [];
      const rows = result.rows.map((row) => this.toEditorRow(row, columns));
      result.rows.forEach((row) => {
        const rowToken = row[ROW_TOKEN_ALIAS];
        rowTokens.push(typeof rowToken === "string" ? rowToken : "");
      });
      const state: DataEditorState = {
        schemaName: this.activeTable.schemaName,
        tableName: this.activeTable.tableName,
        columns,
        columnTypes,
        rows,
        rowLimit: limit
      };
      this.activeState = state;
      this.activeRowTokens = rowTokens;
      this.panel?.showState(state);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to load table data.";
      const state: DataEditorState = {
        schemaName: this.activeTable.schemaName,
        tableName: this.activeTable.tableName,
        columns: [],
        rows: [],
        rowLimit: limit,
        error: message
      };
      this.activeState = state;
      this.activeRowTokens = [];
      this.panel?.showState(state);
    }
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

    const pool = this.connectionManager.getPool();
    if (!pool) {
      void vscode.window.showWarningMessage("Connect to a Postgres profile first.");
      return;
    }

    try {
      const client = await pool.connect();
      let updatedRows = 0;
      let insertedRows = 0;
      try {
        await client.query("BEGIN");
        for (const change of changes) {
          if (change.kind === "insert") {
            const statement = this.buildInsertStatement(table, state.columns, change);
            if (!statement) {
              continue;
            }
            const result = await client.query(statement.sql, statement.values);
            insertedRows += result.rowCount ?? 0;
            continue;
          }

          const rowToken = this.activeRowTokens[change.rowIndex];
          if (!rowToken) {
            continue;
          }

          const statement = this.buildUpdateStatement(table, state.columns, change, rowToken);
          if (!statement) {
            continue;
          }
          const result = await client.query(statement.sql, statement.values);
          updatedRows += result.rowCount ?? 0;
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      const summaryParts: string[] = [];
      if (updatedRows > 0) {
        summaryParts.push(`${updatedRows} updated`);
      }
      if (insertedRows > 0) {
        summaryParts.push(`${insertedRows} inserted`);
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

  private buildUpdateStatement(
    table: TableContext,
    columns: string[],
    change: DataEditorUpdateChange,
    rowToken: string
  ): { sql: string; values: unknown[] } | undefined {
    if (!change.updates.length) {
      return undefined;
    }

    const values: unknown[] = [];
    const setClauses: string[] = [];
    for (const update of change.updates) {
      const columnName = columns[update.columnIndex];
      if (!columnName) {
        continue;
      }
      setClauses.push(`${this.quoteIdentifier(columnName)} = $${values.length + 1}`);
      values.push(update.isNull ? null : update.value);
    }

    if (setClauses.length === 0) {
      return undefined;
    }

    const qualified = `${this.quoteIdentifier(table.schemaName)}.${this.quoteIdentifier(
      table.tableName
    )}`;
    values.push(rowToken);
    const sql = `UPDATE ${qualified} SET ${setClauses.join(", ")} WHERE ctid = $${
      values.length
    }::tid;`;

    return { sql, values };
  }

  private buildInsertStatement(
    table: TableContext,
    columns: string[],
    change: DataEditorInsertChange
  ): { sql: string; values: unknown[] } | undefined {
    if (!change.values.length) {
      return undefined;
    }

    const columnNames: string[] = [];
    const placeholders: string[] = [];
    const values: unknown[] = [];
    const seenColumns = new Set<number>();
    for (const update of change.values) {
      if (seenColumns.has(update.columnIndex)) {
        continue;
      }
      const columnName = columns[update.columnIndex];
      if (!columnName) {
        continue;
      }
      seenColumns.add(update.columnIndex);
      columnNames.push(this.quoteIdentifier(columnName));
      placeholders.push(`$${values.length + 1}`);
      values.push(update.isNull ? null : update.value);
    }

    if (columnNames.length === 0) {
      return undefined;
    }

    const qualified = `${this.quoteIdentifier(table.schemaName)}.${this.quoteIdentifier(
      table.tableName
    )}`;
    const sql = `INSERT INTO ${qualified} (${columnNames.join(", ")}) VALUES (${placeholders.join(
      ", "
    )});`;

    return { sql, values };
  }

  private toEditorRow(row: Record<string, unknown>, columns: string[]): EditorRow {
    const values: string[] = [];
    const nulls: boolean[] = [];
    columns.forEach((column) => {
      const value = row[column];
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

  private normalizeLimit(limit: number): number {
    if (!Number.isFinite(limit) || limit <= 0) {
      return DEFAULT_ROW_LIMIT;
    }
    return Math.floor(limit);
  }

  private quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, "\"\"")}"`;
  }
}
