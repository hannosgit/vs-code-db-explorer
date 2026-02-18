import * as assert from "assert";
import { describe, it } from "mocha";
import { DatabaseAdapter, DatabaseSession } from "../../databases/contracts";
import { createDefaultDatabaseAdapterRegistry } from "../../databases/databaseAdapterRegistry";
import { DEFAULT_DATABASE_ENGINE } from "../../databases/databaseEngines";
import { PostgresAdapter } from "../../databases/postgres";

describe("DatabaseAdapterRegistry", () => {
  it("registers postgres in the default registry", () => {
    const registry = createDefaultDatabaseAdapterRegistry();
    const adapter = registry.get(DEFAULT_DATABASE_ENGINE);

    assert.ok(adapter);
    assert.ok(adapter instanceof PostgresAdapter);
  });

  it("registers custom adapters through the factory", () => {
    const fakeAdapter: DatabaseAdapter = {
      engine: "sqlite",
      createSession: async () =>
        ({
          profileId: "sqlite",
          engine: "sqlite",
          schemaProvider: {
            listSchemas: async () => [],
            listTables: async () => [],
            listColumns: async () => [],
            dropTable: async () => {},
            truncateTable: async () => {}
          },
          queryExecutor: {
            run: async () => ({
              sql: "",
              columns: [],
              rows: [],
              rowCount: 0,
              durationMs: 0,
              truncated: false
            }),
            runCancelable: () => ({
              promise: Promise.resolve({
                sql: "",
                columns: [],
                rows: [],
                rowCount: 0,
                durationMs: 0,
                truncated: false
              }),
              cancel: async () => true
            })
          },
          tableDataProvider: {
            loadPage: async () => ({
              table: { schemaName: "main", tableName: "items" },
              columns: [],
              rows: [],
              pageSize: 100,
              pageIndex: 0,
              hasNextPage: false
            }),
            saveChanges: async () => ({ updatedRows: 0, insertedRows: 0, deletedRows: 0 })
          },
          sqlDialect: {
            quoteIdentifier: (identifier: string) => identifier,
            parameterPlaceholder: (position: number) => `?${position}`,
            supportsRowLocator: () => false
          },
          dispose: async () => {}
        }) as DatabaseSession
    };

    const registry = createDefaultDatabaseAdapterRegistry([fakeAdapter]);

    assert.strictEqual(registry.get("sqlite"), fakeAdapter);
  });
});
