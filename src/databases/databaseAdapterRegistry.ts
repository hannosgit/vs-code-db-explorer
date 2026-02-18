import { DatabaseAdapter } from "./contracts";
import { DEFAULT_DATABASE_ENGINE } from "./databaseEngines";
import { PostgresAdapter } from "./postgres";

export class DatabaseAdapterRegistry {
  private readonly adapters = new Map<string, DatabaseAdapter>();

  register(adapter: DatabaseAdapter): void {
    this.adapters.set(adapter.engine, adapter);
  }

  get(engine: string): DatabaseAdapter | undefined {
    return this.adapters.get(engine);
  }
}

export function createDefaultDatabaseAdapterRegistry(
  adapters: DatabaseAdapter[] = []
): DatabaseAdapterRegistry {
  const registry = new DatabaseAdapterRegistry();
  const defaultAdapter = new PostgresAdapter();
  if (defaultAdapter.engine !== DEFAULT_DATABASE_ENGINE) {
    throw new Error(
      `Default adapter engine "${defaultAdapter.engine}" does not match "${DEFAULT_DATABASE_ENGINE}".`
    );
  }

  [defaultAdapter, ...adapters].forEach((adapter) => registry.register(adapter));
  return registry;
}
