import { QueryExecutor } from "./queryExecutor";
import { SchemaProvider } from "./schemaProvider";
import { SqlDialect } from "./sqlDialect";
import { TableDataProvider } from "./tableDataProvider";

export interface DatabaseSession {
  readonly profileId: string;
  readonly engine: string;
  readonly schemaProvider: SchemaProvider;
  readonly queryExecutor: QueryExecutor;
  readonly tableDataProvider: TableDataProvider;
  readonly sqlDialect: SqlDialect;
  dispose(): Promise<void>;
}
