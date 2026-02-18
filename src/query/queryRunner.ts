import {
  CancelableQuery,
  QueryErrorInfo,
  QueryExecutionResult
} from "../databases/contracts/queryExecutor";
import {
  PostgresConnectionDriver,
  PostgresPoolLike
} from "../databases/postgres/postgresConnectionDriver";
import {
  DEFAULT_ROW_LIMIT,
  PostgresQueryExecutor
} from "../databases/postgres/postgresQueryExecutor";

export type { QueryErrorInfo, QueryExecutionResult, CancelableQuery };
export { DEFAULT_ROW_LIMIT };

export async function runQuery(
  pool: PostgresPoolLike,
  sql: string,
  rowLimit = DEFAULT_ROW_LIMIT
): Promise<QueryExecutionResult> {
  return createExecutor(pool).run(sql, { rowLimit });
}

export function runCancelableQuery(
  pool: PostgresPoolLike,
  sql: string,
  rowLimit = DEFAULT_ROW_LIMIT
): CancelableQuery {
  return createExecutor(pool).runCancelable(sql, { rowLimit });
}

function createExecutor(pool: PostgresPoolLike): PostgresQueryExecutor {
  return new PostgresQueryExecutor(new PostgresConnectionDriver(pool));
}
