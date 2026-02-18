import * as vscode from "vscode";
import { DEFAULT_DATABASE_ENGINE } from "../databases/databaseEngines";
import { ConnectionProfile } from "./connectionManager";

export interface NewConnectionInput {
  profile: ConnectionProfile;
  password?: string;
}

export async function promptForNewConnection(
  existingProfiles: ConnectionProfile[]
): Promise<NewConnectionInput | undefined> {
  const label = await vscode.window.showInputBox({
    prompt: "Connection name",
    placeHolder: "Local Postgres",
    ignoreFocusOut: true,
    validateInput: (value) => requireValue(value, "Enter a connection name.")
  });
  if (label === undefined) {
    return undefined;
  }

  const host = await vscode.window.showInputBox({
    prompt: "Host",
    value: "localhost",
    ignoreFocusOut: true,
    validateInput: (value) => requireValue(value, "Enter a host name.")
  });
  if (host === undefined) {
    return undefined;
  }

  const portInput = await vscode.window.showInputBox({
    prompt: "Port",
    value: "5432",
    ignoreFocusOut: true,
    validateInput: validatePort
  });
  if (portInput === undefined) {
    return undefined;
  }

  const database = await vscode.window.showInputBox({
    prompt: "Database",
    value: "postgres",
    ignoreFocusOut: true,
    validateInput: (value) => requireValue(value, "Enter a database name.")
  });
  if (database === undefined) {
    return undefined;
  }

  const user = await vscode.window.showInputBox({
    prompt: "User",
    value: "postgres",
    ignoreFocusOut: true,
    validateInput: (value) => requireValue(value, "Enter a database user.")
  });
  if (user === undefined) {
    return undefined;
  }

  const password = await vscode.window.showInputBox({
    prompt: "Password (optional)",
    placeHolder: "Leave empty to enter it when connecting",
    password: true,
    ignoreFocusOut: true
  });
  if (password === undefined) {
    return undefined;
  }

  const normalizedLabel = label.trim();
  const normalizedHost = host.trim();
  const normalizedDatabase = database.trim();
  const normalizedUser = user.trim();
  const normalizedPort = Number(portInput.trim());

  const profile: ConnectionProfile = {
    id: createUniqueProfileId(normalizedLabel, existingProfiles),
    label: normalizedLabel,
    engine: DEFAULT_DATABASE_ENGINE,
    host: normalizedHost,
    port: normalizedPort,
    database: normalizedDatabase,
    user: normalizedUser
  };

  return {
    profile,
    password: password.length > 0 ? password : undefined
  };
}

function requireValue(value: string, errorMessage: string): string | undefined {
  if (value.trim().length === 0) {
    return errorMessage;
  }
  return undefined;
}

function validatePort(value: string): string | undefined {
  if (value.trim().length === 0) {
    return "Enter a port number.";
  }

  if (!/^\d+$/.test(value.trim())) {
    return "Port must be a whole number.";
  }

  const port = Number(value.trim());
  if (port < 1 || port > 65535) {
    return "Port must be between 1 and 65535.";
  }

  return undefined;
}

function createUniqueProfileId(
  label: string,
  existingProfiles: ConnectionProfile[]
): string {
  const existingIds = new Set(existingProfiles.map((profile) => profile.id));
  const baseId = toId(label);
  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let suffix = 2;
  let candidate = `${baseId}-${suffix}`;
  while (existingIds.has(candidate)) {
    suffix += 1;
    candidate = `${baseId}-${suffix}`;
  }

  return candidate;
}

function toId(value: string): string {
  const id = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return id || "connection";
}
