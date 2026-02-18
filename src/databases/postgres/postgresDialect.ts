import { SqlDialect } from "../contracts";

export class PostgresDialect implements SqlDialect {
  quoteIdentifier(identifier: string): string {
    return `"${identifier.replace(/"/g, "\"\"")}"`;
  }

  parameterPlaceholder(position: number): string {
    return `$${position}`;
  }

  supportsRowLocator(): boolean {
    return true;
  }
}
