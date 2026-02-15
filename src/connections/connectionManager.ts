import * as vscode from "vscode";
import { Pool } from "pg";

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
  private static readonly passwordKeyPrefix = "dbExplorer.password.";
  private activeProfileId?: string;
  private readonly pools = new Map<string, Pool>();
  private readonly onDidChangeActiveEmitter = new vscode.EventEmitter<ConnectionState>();

  constructor(private readonly secrets: vscode.SecretStorage) {
    void this.secrets;
  }

  get onDidChangeActive(): vscode.Event<ConnectionState> {
    return this.onDidChangeActiveEmitter.event;
  }

  getActiveProfileId(): string | undefined {
    return this.activeProfileId;
  }

  getActiveProfile(): ConnectionProfile | undefined {
    const activeId = this.activeProfileId;
    if (!activeId) {
      return undefined;
    }

    return this.listProfiles().find((profile) => profile.id === activeId);
  }

  getPool(profileId?: string): Pool | undefined {
    const id = profileId ?? this.activeProfileId;
    if (!id) {
      return undefined;
    }

    return this.pools.get(id);
  }

  listProfiles(): ConnectionProfile[] {
    const config = vscode.workspace.getConfiguration("dbExplorer");
    return config.get<ConnectionProfile[]>("profiles", []);
  }

  async clearStoredPassword(profileId: string): Promise<void> {
    const passwordKey = `${ConnectionManager.passwordKeyPrefix}${profileId}`;
    await this.secrets.delete(passwordKey);
  }

  async storePassword(profileId: string, password: string): Promise<void> {
    const passwordKey = `${ConnectionManager.passwordKeyPrefix}${profileId}`;
    await this.secrets.store(passwordKey, password);
  }

  async connect(profileId: string): Promise<void> {
    const profile = this.listProfiles().find((item) => item.id === profileId);
    if (!profile) {
      throw new Error(`Profile "${profileId}" not found.`);
    }

    if (this.activeProfileId && this.activeProfileId !== profileId) {
      await this.disconnect();
    }

    const existingPool = this.pools.get(profileId);
    if (existingPool) {
      await existingPool.end();
      this.pools.delete(profileId);
    }

    const passwordKey = `${ConnectionManager.passwordKeyPrefix}${profile.id}`;
    let password = await this.secrets.get(passwordKey);
    if (password === undefined) {
      const input = await vscode.window.showInputBox({
        prompt: `Password for ${profile.user}@${profile.host}`,
        password: true,
        ignoreFocusOut: true
      });
      if (input === undefined) {
        throw new Error("Connection canceled.");
      }
      password = input;
      await this.secrets.store(passwordKey, password);
    }

    const pool = new Pool({
      host: profile.host,
      port: profile.port,
      database: profile.database,
      user: profile.user,
      password,
      application_name: "VS Code DB Explorer"
    });

    try {
      const client = await pool.connect();
      client.release();
    } catch (error) {
      await pool.end();
      throw error;
    }

    this.pools.set(profileId, pool);
    this.activeProfileId = profileId;
    this.onDidChangeActiveEmitter.fire({ activeProfileId: profileId });
  }

  async disconnect(): Promise<void> {
    const activeId = this.activeProfileId;
    if (activeId) {
      const pool = this.pools.get(activeId);
      if (pool) {
        await pool.end();
        this.pools.delete(activeId);
      }
    }
    this.activeProfileId = undefined;
    this.onDidChangeActiveEmitter.fire({ activeProfileId: undefined });
  }
}
