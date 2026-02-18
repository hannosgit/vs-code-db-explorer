# Repository Guidelines

This repository contains a VS Code extension for exploring databases. For now only PostgreSQL is supported, support for other databases might be added later.
Use the notes below to contribute changes consistently.

## Project Structure & Module Organization
- `src/` contains the TypeScript source. Entry point: `src/extension.ts`.
- `src/connections/` manages profiles and connection lifecycle.
- `src/databases/` contains database engine adapters, contracts, and PostgreSQL implementations.
- `src/query/` handles SQL selection and execution helpers.
- `src/views/` provides tree view data providers for the sidebar.
- `src/webviews/` renders results UI and related messaging.
- `src/test/` contains the VS Code extension test harness and test suites.
- `src/utils/` holds shared helpers (notifications, etc.).
- `dist/` is generated output from the TypeScript build.
- `specs.md` documents product goals, architecture, and roadmap.

## Build, Test, and Development Commands
- `npm install` installs dependencies.
- `npm run compile` builds TypeScript into `dist/` using `tsc`.
- `npm test` compiles and runs the extension test suite.
- `npm run coverage` compiles and runs tests with `c8` coverage reporting.
- `npm run watch` runs `tsc -watch` for iterative development.
- `npm run package` creates a VSIX via `vsce package` (requires `vsce`).

## Coding Style & Naming Conventions
- TypeScript with `strict` mode (see `tsconfig.json`).
- Match the existing style: 2-space indentation, double quotes, and semicolons.
- File names use lower camelCase (e.g., `connectionManager.ts`), classes use PascalCase.

## Testing Guidelines
- Automated tests are wired via the VS Code test harness and run through `npm test`.
- Unit and extension tests live under `src/test/suite/`.
- PostgreSQL integration tests live under `src/test/suite/postgres/` and require a reachable Postgres instance.
- Prefer `*.test.ts` naming for new tests.

## Commit & Pull Request Guidelines
- Commit history uses short, descriptive messages (sentence case or simple imperatives).
- Keep commits focused and mention user-facing changes in the PR description.
- For UI/webview changes, include screenshots or short clips.
- Note any new commands, settings, or config keys in the PR.
- Automatically update `CHANGELOG.md` after each completed change with a concise entry describing what changed. Only add a change if it affects the user of the extension directly, e.g. do not include refactorings.

## Security & Configuration Tips
- Do not commit credentials. Profiles live in VS Code settings under `dbExplorer.profiles` and passwords are stored in SecretStorage.
- Example settings snippet:

```json
"dbExplorer.profiles": [
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

## Agent-Specific Instructions
- Avoid editing `dist/` directly; always rebuild with `npm run compile`.
- Keep changes confined to `src/` unless updating docs or configuration.
