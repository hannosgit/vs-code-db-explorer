import * as vscode from "vscode";
import { getSqlStatements } from "./sqlText";

export class SqlCodeLensProvider implements vscode.CodeLensProvider {
  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    return getSqlStatements(document).map(
      (statement) =>
        new vscode.CodeLens(statement.range, {
          title: "Run statement",
          command: "dbExplorer.runQuery",
          arguments: [document.uri, statement.range]
        })
    );
  }
}
