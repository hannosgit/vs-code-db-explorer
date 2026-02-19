import {
  ColumnDescriptor,
  SchemaDescriptor,
  SchemaProvider,
  TableDescriptor,
  TableReference
} from "../contracts";
import { PostgresConnectionDriver } from "./postgresConnectionDriver";
import { PostgresDialect } from "./postgresDialect";

type QueryResultLike = {
  rows?: Record<string, unknown>[];
};

export class PostgresSchemaProvider implements SchemaProvider {
  constructor(
    private readonly driver: PostgresConnectionDriver,
    private readonly dialect = new PostgresDialect()
  ) {}

  async listSchemas(): Promise<SchemaDescriptor[]> {
    const result = await this.driver.query<QueryResultLike>(
      "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY nspname"
    );

    return this.toRows(result).flatMap((row) => {
      const schema = row.nspname;
      if (typeof schema !== "string") {
        return [];
      }
      return [{ name: schema }];
    });
  }

  async listTables(schemaName: string): Promise<TableDescriptor[]> {
    const result = await this.driver.query<QueryResultLike>(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY table_name",
      [schemaName]
    );

    return this.toRows(result).flatMap((row) => {
      const tableName = row.table_name;
      if (typeof tableName !== "string") {
        return [];
      }
      return [{ schemaName, name: tableName }];
    });
  }

  async listColumns(table: TableReference): Promise<ColumnDescriptor[]> {
    const result = await this.driver.query<QueryResultLike>(
      "SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
      [table.schemaName, table.tableName]
    );

    return this.toRows(result).flatMap((row) => {
      const columnName = row.column_name;
      const dataType = row.data_type;
      const isNullable = row.is_nullable;
      if (
        typeof columnName !== "string" ||
        typeof dataType !== "string" ||
        typeof isNullable !== "string"
      ) {
        return [];
      }

      return [
        {
          schemaName: table.schemaName,
          tableName: table.tableName,
          name: columnName,
          dataType,
          isNullable: isNullable === "YES"
        }
      ];
    });
  }

  async dropSchema(schemaName: string): Promise<void> {
    const qualifiedName = this.dialect.quoteIdentifier(schemaName);
    await this.driver.query(`DROP SCHEMA ${qualifiedName} CASCADE`);
  }

  async dropTable(table: TableReference): Promise<void> {
    const qualifiedName = `${this.dialect.quoteIdentifier(table.schemaName)}.${this.dialect.quoteIdentifier(
      table.tableName
    )}`;
    await this.driver.query(`DROP TABLE ${qualifiedName}`);
  }

  async truncateTable(table: TableReference): Promise<void> {
    const qualifiedName = `${this.dialect.quoteIdentifier(table.schemaName)}.${this.dialect.quoteIdentifier(
      table.tableName
    )}`;
    await this.driver.query(`TRUNCATE TABLE ${qualifiedName}`);
  }

  private toRows(result: QueryResultLike): Record<string, unknown>[] {
    return Array.isArray(result.rows) ? result.rows : [];
  }
}
