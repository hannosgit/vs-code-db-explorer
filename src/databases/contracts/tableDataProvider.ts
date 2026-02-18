import { TableReference } from "./schemaProvider";

export interface TableColumnDescriptor {
  name: string;
  dataType?: string;
  enumValues?: string[];
}

export interface TableRowData {
  rowLocator?: string;
  values: unknown[];
}

export interface TablePageRequest {
  table: TableReference;
  pageSize: number;
  pageIndex: number;
}

export interface TablePageResult {
  table: TableReference;
  columns: TableColumnDescriptor[];
  rows: TableRowData[];
  pageSize: number;
  pageIndex: number;
  hasNextPage: boolean;
}

export interface TableCellChange {
  columnIndex: number;
  value: unknown;
  isNull: boolean;
}

export interface TableUpdateChange {
  kind: "update";
  rowLocator: string;
  updates: TableCellChange[];
}

export interface TableInsertChange {
  kind: "insert";
  values: TableCellChange[];
}

export interface TableDeleteChange {
  kind: "delete";
  rowLocator: string;
}

export type TableDataChange = TableUpdateChange | TableInsertChange | TableDeleteChange;

export interface TableSaveRequest {
  table: TableReference;
  columns: string[];
  changes: TableDataChange[];
}

export interface TableSaveResult {
  updatedRows: number;
  insertedRows: number;
  deletedRows: number;
}

export interface TableDataProvider {
  loadPage(request: TablePageRequest): Promise<TablePageResult>;
  saveChanges(request: TableSaveRequest): Promise<TableSaveResult>;
}
