import * as vscode from "vscode";

export function showNotImplemented(feature: string): void {
  void vscode.window.showInformationMessage(`${feature} is not implemented yet.`);
}
