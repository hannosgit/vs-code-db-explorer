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

export interface ViewDescriptor {
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
  listViews(schemaName: string): Promise<ViewDescriptor[]>;
  listColumns(table: TableReference): Promise<ColumnDescriptor[]>;
  dropSchema(schemaName: string): Promise<void>;
  dropTable(table: TableReference): Promise<void>;
  truncateTable(table: TableReference): Promise<void>;
}
