import * as vscode from "vscode";

type ScannerState =
  | { kind: "normal" }
  | { kind: "singleQuote" }
  | { kind: "doubleQuote" }
  | { kind: "lineComment" }
  | { kind: "blockComment"; depth: number }
  | { kind: "dollarQuote"; delimiter: string };

interface SqlSegment {
  rawEnd: number;
  firstContentOffset?: number;
}

export interface SqlStatement {
  text: string;
  range: vscode.Range;
}

export function getSqlFromRange(
  document: vscode.TextDocument,
  range: vscode.Range
): string | null {
  const sql = document.getText(document.validateRange(range)).trim();
  return sql.length > 0 ? sql : null;
}

export function getSqlStatements(document: vscode.TextDocument): SqlStatement[] {
  const text = document.getText();
  const statements: SqlStatement[] = [];

  for (const segment of scanSqlSegments(text)) {
    if (segment.firstContentOffset === undefined) {
      continue;
    }

    const end = trimRightWhitespace(text, segment.rawEnd);
    if (end <= segment.firstContentOffset) {
      continue;
    }

    const range = new vscode.Range(
      document.positionAt(segment.firstContentOffset),
      document.positionAt(end)
    );
    const statement = document.getText(range).trimEnd();

    if (statement.length === 0) {
      continue;
    }

    statements.push({
      text: statement,
      range
    });
  }

  return statements;
}

export function getSqlToRun(editor: vscode.TextEditor): string | null {
  const selection = editor.selection;
  const document = editor.document;

  if (!selection.isEmpty) {
    const selected = document.getText(selection).trim();
    return selected.length > 0 ? selected : null;
  }

  const text = document.getText();
  if (text.trim().length === 0) {
    return null;
  }

  const cursorOffset = document.offsetAt(selection.active);
  const separators = collectSeparatorOffsets(text);
  const startIndex = findSegmentStart(cursorOffset, separators);
  const endIndex = findSegmentEnd(cursorOffset, separators, text.length);
  const sql = text.slice(startIndex, endIndex).trim();

  return sql.length > 0 ? sql : null;
}

export function getAllSqlToRun(editor: vscode.TextEditor): string | null {
  const sql = editor.document.getText().trim();
  return sql.length > 0 ? sql : null;
}

function findSegmentStart(cursorOffset: number, separators: number[]): number {
  for (let i = separators.length - 1; i >= 0; i -= 1) {
    if (separators[i] <= cursorOffset - 1) {
      return separators[i] + 1;
    }
  }

  return 0;
}

function findSegmentEnd(cursorOffset: number, separators: number[], textLength: number): number {
  for (const separator of separators) {
    if (separator >= cursorOffset) {
      return separator;
    }
  }

  return textLength;
}

function collectSeparatorOffsets(text: string): number[] {
  return scanSqlSegments(text).map((segment) => segment.rawEnd).filter((offset) => offset < text.length);
}

function scanSqlSegments(text: string): SqlSegment[] {
  const segments: SqlSegment[] = [];

  let state: ScannerState = { kind: "normal" };
  let firstContentOffset: number | undefined;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = i + 1 < text.length ? text[i + 1] : "";

    if (state.kind === "singleQuote") {
      if (char === "'" && next === "'") {
        i += 1;
        continue;
      }

      if (char === "'") {
        state = { kind: "normal" };
      }
      continue;
    }

    if (state.kind === "doubleQuote") {
      if (char === '"' && next === '"') {
        i += 1;
        continue;
      }

      if (char === '"') {
        state = { kind: "normal" };
      }
      continue;
    }

    if (state.kind === "lineComment") {
      if (char === "\n") {
        state = { kind: "normal" };
      }
      continue;
    }

    if (state.kind === "blockComment") {
      if (char === "/" && next === "*") {
        state = { kind: "blockComment", depth: state.depth + 1 };
        i += 1;
        continue;
      }

      if (char === "*" && next === "/") {
        if (state.depth <= 1) {
          state = { kind: "normal" };
        } else {
          state = { kind: "blockComment", depth: state.depth - 1 };
        }
        i += 1;
      }
      continue;
    }

    if (state.kind === "dollarQuote") {
      if (text.startsWith(state.delimiter, i)) {
        i += state.delimiter.length - 1;
        state = { kind: "normal" };
      }
      continue;
    }

    if (char === "-" && next === "-") {
      state = { kind: "lineComment" };
      i += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      state = { kind: "blockComment", depth: 1 };
      i += 1;
      continue;
    }

    if (char === ";") {
      segments.push({
        rawEnd: i,
        firstContentOffset
      });
      firstContentOffset = undefined;
      continue;
    }

    if (char === "'" || char === '"') {
      if (firstContentOffset === undefined) {
        firstContentOffset = i;
      }
      state = char === "'" ? { kind: "singleQuote" } : { kind: "doubleQuote" };
      continue;
    }

    if (char === "$") {
      const delimiter = readDollarQuoteDelimiter(text, i);
      if (delimiter) {
        if (firstContentOffset === undefined) {
          firstContentOffset = i;
        }
        state = { kind: "dollarQuote", delimiter };
        i += delimiter.length - 1;
        continue;
      }
    }

    if (!isWhitespace(char) && firstContentOffset === undefined) {
      firstContentOffset = i;
    }
  }

  segments.push({
    rawEnd: text.length,
    firstContentOffset
  });

  return segments;
}

function trimRightWhitespace(text: string, index: number): number {
  let end = index;
  while (end > 0 && isWhitespace(text[end - 1])) {
    end -= 1;
  }
  return end;
}

function readDollarQuoteDelimiter(text: string, offset: number): string | null {
  if (text[offset] !== "$") {
    return null;
  }

  let cursor = offset + 1;
  while (cursor < text.length && text[cursor] !== "$") {
    if (!isDollarTagChar(text[cursor])) {
      return null;
    }
    cursor += 1;
  }

  if (cursor >= text.length || text[cursor] !== "$") {
    return null;
  }

  return text.slice(offset, cursor + 1);
}

function isDollarTagChar(char: string): boolean {
  const code = char.charCodeAt(0);
  return (
    (code >= 48 && code <= 57) ||
    (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) ||
    char === "_"
  );
}

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}
