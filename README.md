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

Passwords will be handled via VS Code SecretStorage in a later milestone.
