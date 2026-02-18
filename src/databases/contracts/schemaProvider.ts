export interface TableReference {
  schemaName: string;
  tableName: string;
}

export interface SchemaDescriptor {
  name: string;
}

export interface TableDescriptor {
  schemaName: string;
  name: string;
}

export interface ColumnDescriptor {
  schemaName: string;
  tableName: string;
  name: string;
  dataType: string;
  isNullable: boolean;
}

export interface SchemaProvider {
  listSchemas(): Promise<SchemaDescriptor[]>;
  listTables(schemaName: string): Promise<TableDescriptor[]>;
  listColumns(table: TableReference): Promise<ColumnDescriptor[]>;
  dropTable(table: TableReference): Promise<void>;
  truncateTable(table: TableReference): Promise<void>;
}
