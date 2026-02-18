export interface SqlDialect {
  quoteIdentifier(identifier: string): string;
  parameterPlaceholder(position: number): string;
  supportsRowLocator(): boolean;
}
