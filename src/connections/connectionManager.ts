import * as vscode from "vscode";
import {
  DatabaseAdapter,
  DatabaseConnectionProfile,
  DatabaseSession
} from "../databases/contracts";
import {
  createDefaultDatabaseAdapterRegistry,
  DatabaseAdapterRegistry
} from "../databases/databaseAdapterRegistry";
import { DEFAULT_DATABASE_ENGINE } from "../databases/databaseEngines";
import { PostgresPoolLike } from "../databases/postgres/postgresConnectionDriver";

export interface ConnectionProfile {
  id: string;
  label: string;
  host: string;
  port: number;
  database: string;
  user: string;
  engine?: string;
  [key: string]: unknown;
}

export interface ConnectionState {
  activeProfileId?: string;
}

export interface ConnectionManagerOptions {
  adapters?: DatabaseAdapter[];
  adapterRegistry?: DatabaseAdapterRegistry;
}

interface StoredConnectionProfile {
  id: string;
  label: string;
  host: string;
  port: number;
  database: string;
  user: string;
  engine?: string;
  [key: string]: unknown;
}

export class ConnectionManager {
  private static readonly passwordKeyPrefix = "dbExplorer.password.";
  private activeProfileId?: string;
  private readonly sessions = new Map<string, DatabaseSession>();
  private readonly adapterRegistry: DatabaseAdapterRegistry;
  private readonly onDidChangeActiveEmitter = new vscode.EventEmitter<ConnectionState>();

  constructor(
    private readonly secrets: vscode.SecretStorage,
    options: ConnectionManagerOptions = {}
  ) {
    this.adapterRegistry = options.adapterRegistry ??
      createDefaultDatabaseAdapterRegistry(options.adapters);
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

  getSession(profileId?: string): DatabaseSession | undefined {
    const id = profileId ?? this.activeProfileId;
    if (!id) {
      return undefined;
    }

    return this.sessions.get(id);
  }

  getPool(profileId?: string): PostgresPoolLike | undefined {
    const session = this.getSession(profileId);
    if (!session) {
      return undefined;
    }

    const maybeSessionWithPool = session as { getPool?: () => PostgresPoolLike };
    if (typeof maybeSessionWithPool.getPool !== "function") {
      return undefined;
    }

    return maybeSessionWithPool.getPool();
  }

  listProfiles(): ConnectionProfile[] {
    const config = vscode.workspace.getConfiguration("dbExplorer");
    const profiles = config.get<StoredConnectionProfile[]>("profiles", []);
    return profiles.map((profile) => this.toConnectionProfile(profile));
  }

  async clearStoredPassword(profileId: string): Promise<void> {
    await this.secrets.delete(this.buildPasswordKey(profileId));
  }

  async storePassword(profileId: string, password: string): Promise<void> {
    await this.secrets.store(this.buildPasswordKey(profileId), password);
  }

  async connect(profileId: string): Promise<void> {
    const profile = this.findProfile(profileId);
    if (!profile) {
      throw new Error(`Profile "${profileId}" not found.`);
    }

    if (this.activeProfileId && this.activeProfileId !== profileId) {
      await this.disconnect();
    }

    await this.disposeSession(profileId);

    const adapter = this.resolveAdapter(profile);
    const password = await this.resolvePassword(profile);
    const session = await adapter.createSession(this.toDatabaseProfile(profile), { password });

    this.sessions.set(profileId, session);
    this.activeProfileId = profileId;
    this.onDidChangeActiveEmitter.fire({ activeProfileId: profileId });
  }

  async disconnect(): Promise<void> {
    const activeId = this.activeProfileId;
    if (activeId) {
      await this.disposeSession(activeId);
    }
    this.activeProfileId = undefined;
    this.onDidChangeActiveEmitter.fire({ activeProfileId: undefined });
  }

  private buildPasswordKey(profileId: string): string {
    return `${ConnectionManager.passwordKeyPrefix}${profileId}`;
  }

  private async resolvePassword(profile: ConnectionProfile): Promise<string> {
    const passwordKey = this.buildPasswordKey(profile.id);
    const storedPassword = await this.secrets.get(passwordKey);
    if (storedPassword !== undefined) {
      return storedPassword;
    }

    const input = await vscode.window.showInputBox({
      prompt: `Password for ${profile.user}@${profile.host}`,
      password: true,
      ignoreFocusOut: true
    });
    if (input === undefined) {
      throw new Error("Connection canceled.");
    }

    await this.secrets.store(passwordKey, input);
    return input;
  }

  private resolveAdapter(profile: ConnectionProfile): DatabaseAdapter {
    const engine = this.resolveEngine(profile);
    const adapter = this.adapterRegistry.get(engine);
    if (!adapter) {
      throw new Error(`No database adapter registered for engine "${engine}".`);
    }
    return adapter;
  }

  private resolveEngine(profile: { engine?: unknown }): string {
    if (typeof profile.engine !== "string") {
      return DEFAULT_DATABASE_ENGINE;
    }

    const normalized = profile.engine.trim();
    return normalized.length > 0 ? normalized : DEFAULT_DATABASE_ENGINE;
  }

  private toConnectionProfile(profile: StoredConnectionProfile): ConnectionProfile {
    return {
      ...profile,
      engine: this.resolveEngine(profile)
    };
  }

  private toDatabaseProfile(profile: ConnectionProfile): DatabaseConnectionProfile {
    return {
      ...profile,
      engine: this.resolveEngine(profile)
    };
  }

  private findProfile(profileId: string): ConnectionProfile | undefined {
    return this.listProfiles().find((profile) => profile.id === profileId);
  }

  private async disposeSession(profileId: string): Promise<void> {
    const existingSession = this.sessions.get(profileId);
    if (!existingSession) {
      return;
    }

    try {
      await existingSession.dispose();
    } finally {
      this.sessions.delete(profileId);
    }
  }
}
