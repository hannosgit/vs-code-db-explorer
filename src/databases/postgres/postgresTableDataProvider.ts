import {
  TableDataProvider,
  TableDeleteChange,
  TableInsertChange,
  TablePageRequest,
  TablePageResult,
  TableReference,
  TableSaveRequest,
  TableSaveResult,
  TableUpdateChange
} from "../contracts";
import { SqlDialect } from "../contracts/sqlDialect";
import { PostgresConnectionDriver } from "./postgresConnectionDriver";
import { PostgresDialect } from "./postgresDialect";

const DEFAULT_PAGE_SIZE = 100;

type QueryResultLike = {
  fields?: Array<{ name: string }>;
  rows?: Record<string, unknown>[];
  rowCount?: number | null;
};

type Queryable = {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
};

export class PostgresTableDataProvider implements TableDataProvider {
  static readonly ROW_TOKEN_ALIAS = "__postgres_explorer_row_token__";

  constructor(
    private readonly driver: PostgresConnectionDriver,
    private readonly dialect: SqlDialect = new PostgresDialect()
  ) {}

  async loadPage(request: TablePageRequest): Promise<TablePageResult> {
    const pageSize = PostgresTableDataProvider.normalizePageSize(
      request.pageSize,
      DEFAULT_PAGE_SIZE
    );
    const offset = request.pageIndex * pageSize;
    const limit = pageSize + 1;
    const sql = PostgresTableDataProvider.buildOpenTableSql(
      request.table.schemaName,
      request.table.tableName,
      limit,
      offset,
      this.dialect
    );
    const result = await this.driver.query<QueryResultLike>(sql);
    const fields = Array.isArray(result.fields) ? result.fields : [];
    const allRows = Array.isArray(result.rows) ? result.rows : [];
    const columns = fields
      .map((field) => field.name)
      .filter((fieldName) => fieldName !== PostgresTableDataProvider.ROW_TOKEN_ALIAS);

    const [columnTypes, columnEnumValues] = await Promise.all([
      PostgresTableDataProvider.loadColumnTypes(this.driver, request.table, columns),
      PostgresTableDataProvider.loadColumnEnumValues(this.driver, request.table, columns)
    ]);

    const hasNextPage = allRows.length > pageSize;
    const visibleRows = hasNextPage ? allRows.slice(0, pageSize) : allRows;

    return {
      table: request.table,
      columns: columns.map((name, index) => ({
        name,
        dataType: columnTypes[index],
        enumValues: columnEnumValues[index]
      })),
      rows: visibleRows.map((row) => {
        const rowLocator = row[PostgresTableDataProvider.ROW_TOKEN_ALIAS];
        return {
          rowLocator: typeof rowLocator === "string" ? rowLocator : undefined,
          values: columns.map((columnName) => row[columnName])
        };
      }),
      pageSize,
      pageIndex: request.pageIndex,
      hasNextPage
    };
  }

  async saveChanges(request: TableSaveRequest): Promise<TableSaveResult> {
    if (!request.changes.length || request.columns.length === 0) {
      return { updatedRows: 0, insertedRows: 0, deletedRows: 0 };
    }

    const client = await this.driver.connect();
    let updatedRows = 0;
    let insertedRows = 0;
    let deletedRows = 0;

    try {
      await client.query("BEGIN");

      for (const change of request.changes) {
        if (change.kind === "insert") {
          const statement = PostgresTableDataProvider.buildInsertStatement(
            request.table,
            request.columns,
            change,
            this.dialect
          );
          if (!statement) {
            continue;
          }

          const result = await client.query<QueryResultLike>(statement.sql, statement.values);
          insertedRows += this.readRowCount(result);
          continue;
        }

        if (change.kind === "delete") {
          const statement = PostgresTableDataProvider.buildDeleteStatement(
            request.table,
            change,
            this.dialect
          );
          if (!statement) {
            continue;
          }

          const result = await client.query<QueryResultLike>(statement.sql, statement.values);
          deletedRows += this.readRowCount(result);
          continue;
        }

        const statement = PostgresTableDataProvider.buildUpdateStatement(
          request.table,
          request.columns,
          change,
          this.dialect
        );
        if (!statement) {
          continue;
        }

        const result = await client.query<QueryResultLike>(statement.sql, statement.values);
        updatedRows += this.readRowCount(result);
      }

      await client.query("COMMIT");
      return { updatedRows, insertedRows, deletedRows };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  static buildOpenTableSql(
    schemaName: string,
    tableName: string,
    limit: number,
    offset: number,
    dialect: SqlDialect = new PostgresDialect()
  ): string {
    const qualified = `${dialect.quoteIdentifier(schemaName)}.${dialect.quoteIdentifier(tableName)}`;
    const rowToken = dialect.quoteIdentifier(PostgresTableDataProvider.ROW_TOKEN_ALIAS);
    return `SELECT ctid::text AS ${rowToken}, * FROM ${qualified} ORDER BY ctid LIMIT ${limit} OFFSET ${offset};`;
  }

  static buildColumnTypesSql(): string {
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

  static buildColumnEnumValuesSql(): string {
    return `
      SELECT a.attname AS column_name, e.enumlabel AS enum_value
      FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_catalog.pg_type t ON t.oid = a.atttypid
      JOIN pg_catalog.pg_type et ON et.oid = CASE
        WHEN t.typtype = 'd' THEN t.typbasetype
        ELSE t.oid
      END
      JOIN pg_catalog.pg_enum e ON e.enumtypid = et.oid
      WHERE n.nspname = $1
        AND c.relname = $2
        AND a.attnum > 0
        AND NOT a.attisdropped
        AND et.typtype = 'e'
      ORDER BY a.attnum, e.enumsortorder;
    `;
  }

  static async loadColumnTypes(
    queryable: Queryable,
    table: TableReference,
    columns: string[]
  ): Promise<string[]> {
    if (columns.length === 0) {
      return [];
    }

    try {
      const result = (await queryable.query(PostgresTableDataProvider.buildColumnTypesSql(), [
        table.schemaName,
        table.tableName
      ])) as QueryResultLike;

      const typeByColumn = new Map<string, string>();
      for (const row of Array.isArray(result.rows) ? result.rows : []) {
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

  static async loadColumnEnumValues(
    queryable: Queryable,
    table: TableReference,
    columns: string[]
  ): Promise<string[][]> {
    if (columns.length === 0) {
      return [];
    }

    try {
      const result = (await queryable.query(PostgresTableDataProvider.buildColumnEnumValuesSql(), [
        table.schemaName,
        table.tableName
      ])) as QueryResultLike;

      const enumValuesByColumn = new Map<string, string[]>();
      for (const row of Array.isArray(result.rows) ? result.rows : []) {
        const columnName = row.column_name;
        const enumValue = row.enum_value;
        if (typeof columnName !== "string" || typeof enumValue !== "string") {
          continue;
        }

        const existing = enumValuesByColumn.get(columnName);
        if (existing) {
          existing.push(enumValue);
        } else {
          enumValuesByColumn.set(columnName, [enumValue]);
        }
      }

      return columns.map((columnName) => enumValuesByColumn.get(columnName) ?? []);
    } catch {
      return columns.map(() => []);
    }
  }

  static buildUpdateStatement(
    table: TableReference,
    columns: string[],
    change: TableUpdateChange,
    dialect: SqlDialect = new PostgresDialect()
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

      setClauses.push(`${dialect.quoteIdentifier(columnName)} = $${values.length + 1}`);
      values.push(update.isNull ? null : update.value);
    }

    if (setClauses.length === 0) {
      return undefined;
    }

    const qualified = `${dialect.quoteIdentifier(table.schemaName)}.${dialect.quoteIdentifier(
      table.tableName
    )}`;
    values.push(change.rowLocator);
    const sql = `UPDATE ${qualified} SET ${setClauses.join(", ")} WHERE ctid = $${
      values.length
    }::tid;`;

    return { sql, values };
  }

  static buildInsertStatement(
    table: TableReference,
    columns: string[],
    change: TableInsertChange,
    dialect: SqlDialect = new PostgresDialect()
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
      columnNames.push(dialect.quoteIdentifier(columnName));
      placeholders.push(`$${values.length + 1}`);
      values.push(update.isNull ? null : update.value);
    }

    if (columnNames.length === 0) {
      return undefined;
    }

    const qualified = `${dialect.quoteIdentifier(table.schemaName)}.${dialect.quoteIdentifier(
      table.tableName
    )}`;
    const sql = `INSERT INTO ${qualified} (${columnNames.join(", ")}) VALUES (${placeholders.join(
      ", "
    )});`;

    return { sql, values };
  }

  static buildDeleteStatement(
    table: TableReference,
    change: TableDeleteChange,
    dialect: SqlDialect = new PostgresDialect()
  ): { sql: string; values: unknown[] } | undefined {
    if (!change.rowLocator) {
      return undefined;
    }

    const qualified = `${dialect.quoteIdentifier(table.schemaName)}.${dialect.quoteIdentifier(
      table.tableName
    )}`;
    const sql = `DELETE FROM ${qualified} WHERE ctid = $1::tid;`;
    return { sql, values: [change.rowLocator] };
  }

  static quoteIdentifier(identifier: string): string {
    return new PostgresDialect().quoteIdentifier(identifier);
  }

  static normalizePageSize(limit: number, fallback: number): number {
    if (!Number.isFinite(limit) || limit <= 0) {
      return fallback;
    }
    return Math.floor(limit);
  }

  private readRowCount(result: QueryResultLike): number {
    return typeof result.rowCount === "number" ? result.rowCount : 0;
  }
}
