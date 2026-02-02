# Postgres Explorer (VS Code Extension)

Early scaffold for a PostgreSQL-focused VS Code extension.

## Development

- Install deps: `npm install`
- Build: `npm run compile`
- Watch: `npm run watch`

## Configuration

Add connection profiles to your user or workspace settings:

```json
"postgresExplorer.profiles": [
  {
    "id": "local",
    "label": "Local Postgres",
    "host": "localhost",
    "port": 5432,
    "database": "postgres",
    "user": "postgres"
  }
]
```

When connecting, the extension will prompt for a password and store it in VS Code SecretStorage.

## Running a Query

- Connect via Command Palette: `Postgres: Connect`
- Open a SQL file and place the cursor in a statement (or select SQL)
- Run `Postgres: Run Query` to see results in a webview
- Use the Cancel button in the results panel to stop long-running queries

## Managing Stored Passwords

- Run `Postgres: Clear Stored Password` to remove a saved password
