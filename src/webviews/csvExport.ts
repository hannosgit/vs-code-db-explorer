import * as vscode from "vscode";

interface ExportCsvOptions {
  content: string;
  fileName: string;
  fallbackFileName: string;
}

export async function exportCsv(options: ExportCsvOptions): Promise<void> {
  const safeFileName = toSafeCsvFileName(options.fileName, options.fallbackFileName);
  const defaultUri = getDefaultSaveUri(safeFileName);
  const uri = await vscode.window.showSaveDialog({
    saveLabel: "Export CSV",
    filters: { "CSV files": ["csv"] },
    defaultUri
  });

  if (!uri) {
    return;
  }

  try {
    await vscode.workspace.fs.writeFile(uri, Buffer.from(options.content, "utf8"));
    void vscode.window.showInformationMessage(`CSV exported to ${uri.fsPath || uri.path}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Unable to export CSV: ${reason}`);
  }
}

function toSafeCsvFileName(fileName: string, fallbackFileName: string): string {
  const trimmed = fileName.trim();
  const withFallback = trimmed.length > 0 ? trimmed : fallbackFileName;
  return withFallback.toLowerCase().endsWith(".csv") ? withFallback : `${withFallback}.csv`;
}

function getDefaultSaveUri(fileName: string): vscode.Uri | undefined {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (!workspaceFolder) {
    return undefined;
  }

  return vscode.Uri.joinPath(workspaceFolder, fileName);
}
