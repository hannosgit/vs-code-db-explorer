import * as vscode from "vscode";

export interface ConnectionProfile {
  id: string;
  label: string;
  host: string;
  port: number;
  database: string;
  user: string;
}

export interface ConnectionState {
  activeProfileId?: string;
}

export class ConnectionManager {
  private activeProfileId?: string;
  private readonly onDidChangeActiveEmitter = new vscode.EventEmitter<ConnectionState>();

  constructor(private readonly secrets: vscode.SecretStorage) {
    void this.secrets; // Placeholder to keep constructor signature meaningful.
  }

  get onDidChangeActive(): vscode.Event<ConnectionState> {
    return this.onDidChangeActiveEmitter.event;
  }

  getActiveProfileId(): string | undefined {
    return this.activeProfileId;
  }

  listProfiles(): ConnectionProfile[] {
    const config = vscode.workspace.getConfiguration("postgresExplorer");
    return config.get<ConnectionProfile[]>("profiles", []);
  }

  async connect(profileId: string): Promise<void> {
    this.activeProfileId = profileId;
    this.onDidChangeActiveEmitter.fire({ activeProfileId: profileId });
  }

  async disconnect(): Promise<void> {
    this.activeProfileId = undefined;
    this.onDidChangeActiveEmitter.fire({ activeProfileId: undefined });
  }
}
