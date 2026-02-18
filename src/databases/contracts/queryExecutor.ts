export interface QueryErrorInfo {
  message: string;
  detail?: string;
  code?: string;
  position?: string;
}

export interface QueryExecutionResult {
  sql: string;
  columns: string[];
  rows: Record<string, unknown>[];
  rowCount: number | null;
  durationMs: number;
  truncated: boolean;
  cancelled?: boolean;
  error?: QueryErrorInfo;
}

export interface QueryRunOptions {
  rowLimit?: number;
}

export interface CancelableQuery {
  promise: Promise<QueryExecutionResult>;
  cancel: () => Promise<boolean>;
}

export interface QueryExecutor {
  run(sql: string, options?: QueryRunOptions): Promise<QueryExecutionResult>;
  runCancelable(sql: string, options?: QueryRunOptions): CancelableQuery;
}
