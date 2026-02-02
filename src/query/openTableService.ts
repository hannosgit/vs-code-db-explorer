import * as vscode from "vscode";
import { ConnectionManager } from "../connections/connectionManager";
import {
  DataEditorChange,
  DataEditorPanel,
  DataEditorState,
  EditorRow
} from "../webviews/dataEditorPanel";
import { ResultsPanel } from "../webviews/resultsPanel";

const DEFAULT_ROW_LIMIT = 200;

type TableContext = { schemaName: string; tableName: string };

export class OpenTableService {
  private panel?: DataEditorPanel;
  private activeTable?: TableContext;
  private activeState?: DataEditorState;

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
    return `SELECT * FROM ${qualified} LIMIT ${limit};`;
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
      const columns = result.fields.map((field) => field.name);
      const rows = result.rows.map((row) => this.toEditorRow(row, columns));
      const state: DataEditorState = {
        schemaName: this.activeTable.schemaName,
        tableName: this.activeTable.tableName,
        columns,
        rows,
        rowLimit: limit
      };
      this.activeState = state;
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
    if (!table || !state || state.rows.length === 0) {
      void vscode.window.showWarningMessage("Reload the table before saving changes.");
      return;
    }

    const pool = this.connectionManager.getPool();
    if (!pool) {
      void vscode.window.showWarningMessage("Connect to a Postgres profile first.");
      return;
    }

    const limit = this.normalizeLimit(this.rowLimit);
    const loadingState: DataEditorState = {
      schemaName: table.schemaName,
      tableName: table.tableName,
      columns: state.columns,
      rows: state.rows,
      rowLimit: limit,
      loading: true
    };
    this.panel?.showState(loadingState);

    try {
      const client = await pool.connect();
      let updatedRows = 0;
      try {
        await client.query("BEGIN");
        for (const change of changes) {
          const original = state.rows[change.rowIndex];
          if (!original) {
            continue;
          }
          const statement = this.buildUpdateStatement(table, state.columns, original, change);
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

      void vscode.window.showInformationMessage(
        `Saved changes to ${updatedRows} row${updatedRows === 1 ? "" : "s"}.`
      );
      await this.reload();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to save changes.";
      void vscode.window.showErrorMessage(message);
      await this.reload();
    }
  }

  private buildUpdateStatement(
    table: TableContext,
    columns: string[],
    original: EditorRow,
    change: DataEditorChange
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

    const whereClauses: string[] = [];
    columns.forEach((columnName, index) => {
      if (original.nulls[index]) {
        whereClauses.push(`${this.quoteIdentifier(columnName)} IS NULL`);
        return;
      }
      whereClauses.push(`${this.quoteIdentifier(columnName)} = $${values.length + 1}`);
      values.push(original.values[index]);
    });

    const qualified = `${this.quoteIdentifier(table.schemaName)}.${this.quoteIdentifier(
      table.tableName
    )}`;
    const sql = `UPDATE ${qualified} SET ${setClauses.join(", ")} WHERE ${whereClauses.join(
      " AND "
    )};`;

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
