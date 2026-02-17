# VS Code Database Explorer Extension — Specs

## Goals
- Primary users: developers
- Core workflows: explore schema, run ad‑hoc SQL, edit data
- Connection scope: local and remote DB instances
- For now only PostgreSQL is supported
- SSL: not supported in v1
- Data editing: no special constraints (full CRUD where allowed by DB)

## Non‑Goals (v1)
- SSL/Certificate management
- SSH tunnels
- Migration tooling
- ER diagramming
- Cloud-specific auth (IAM, OAuth)

## User Stories
- As a dev, I can create and save connection profiles for local and remote DBs.
- As a dev, I can browse schemas/tables/columns quickly with refresh.
- As a dev, I can run SQL and see results with paging and copy/export.
- As a dev, I can open a table and edit rows inline.

## UX / UI Overview
### Sidebar Views
- **DB Connections**
  - List of saved profiles
  - Connect/disconnect with status indicator
  - Context menu: Edit, Delete, Refresh Schema
- **Schema Explorer** (per connection)
  - Schemas → Tables → Columns
  - Expand to show indexes and constraints
  - Lazy-loaded nodes

### SQL Editor
- Command: **DB: Run Query**
  - Executes selection or current statement
- Results pane (webview)
  - Grid with paging
  - Copy cell/row, export CSV/JSON
  - Show row count + execution time
- Cancel query action

### Data Editor
- Open from table node: **Open Table**
- Grid with paging + inline edit
- Toolbar: Add row, Delete row, Save changes, Revert
- Primary key aware update/delete; fallback to all-columns match if no PK

## Extension Contributions (package.json)
- Views: `dbConnections`, `dbSchema`
- Commands:
  - `dbExplorer.connect`
  - `dbExplorer.disconnect`
  - `dbExplorer.refreshSchema`
  - `dbExplorer.runQuery`
  - `dbExplorer.openTable`
- Menus:
  - View title actions (refresh, connect)
  - Tree item context actions (open table, run query in new editor)
- Status bar: connection indicator

## Architecture
### Core Modules
- **ConnectionManager**
  - Manages profiles, pools, connect/disconnect lifecycle
  - One pool per profile
- **SchemaService**
  - Queries information_schema + pg_catalog
  - Caches schema with TTL + manual refresh
- **QueryRunner**
  - Runs SQL, supports cancel
  - Measures execution time
- **DataEditorService**
  - Generates CRUD SQL for grid edits

### Storage
- Connection profiles in `settings.json`
- Secrets in `SecretStorage`

### Webviews
- Results grid webview
- Data editor webview
- Messaging bridge for paging, edits, export

## Data Access Details
- Driver: `pg`
- Query cancel: `pg_cancel_backend(pid)`
- Paging: `LIMIT/OFFSET` (configurable page size)
- Editing:
  - UPDATE/DELETE by PK where present
  - If no PK, warn user; allow edit with full-row match

## Defaults (v1)
- Grid page size: 200 rows (configurable 50–1000)
- Ad‑hoc queries run as‑is; client caps displayed rows at 10,000 (truncate with banner + "Export full" action)
- Max cell display length: 2,000 chars (show "View full value" modal)
- Query timeout: 30s (configurable; timeout errors shown with retry)
- Large tables: if estimated rows > 100,000, show warning banner but allow edits; load first page only

## Schema Queries (v1)
- Schemas: `SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'`
- Tables: `SELECT table_name FROM information_schema.tables WHERE table_schema = $1`
- Columns: `SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`
- Indexes/constraints from `pg_catalog`

## MVP Milestones
1) Connection profiles + connect/disconnect + status bar
2) Schema explorer (schemas/tables/columns) + refresh
3) Run query + results grid + cancel
4) Open table + inline edits + save/revert

## V1 Enhancements
- Query history + favorites
- Export CSV/JSON
- Explain/Analyze view

## Milestone Checklist
### Milestone 0: Project Setup
- [ ] Extension scaffold (TypeScript, build, activation)
- [ ] `pg` wired + connection smoke test
- [ ] Commands/views registered
- [ ] Logging + error helper utilities

### Milestone 1: Connections
- [ ] Profile model + validation
- [ ] Settings storage + SecretStorage integration
- [ ] Connect/disconnect + status bar state
- [ ] Connection picker (Quick Pick)
- [ ] Pool lifecycle management

### Milestone 2: Schema Explorer
- [ ] Tree view provider (schemas → tables → columns)
- [ ] Lazy loading + refresh command
- [ ] Schema cache TTL + manual refresh
- [ ] Index/constraint nodes

### Milestone 3: SQL Runner
- [ ] Statement detection (selection/current statement)
- [ ] Query execution + cancellation
- [ ] Results grid webview with paging
- [ ] Row count + execution time display

### Milestone 4: Data Editor
- [ ] Open table command + webview
- [ ] Paging + sorting
- [ ] Inline edits with change tracking
- [ ] Insert/delete rows + save/revert
- [ ] PK-aware updates; warn on no PK

### Milestone 5: V1 Enhancements
- [ ] Export CSV/JSON
- [ ] Query history + favorites
- [ ] Explain/Analyze view

### Milestone 6: Testing + Packaging
- [ ] Unit tests for SQL parsing, CRUD, schema cache
- [ ] Integration tests with local Postgres (Docker)
- [ ] README + usage docs
- [ ] Marketplace assets + changelog

## Backlog (Task Breakdown)
### Epic 1: Project Setup + Scaffolding
- Initialize extension (TypeScript, webpack/esbuild, basic activation)
- Add `pg` dependency + connection test utility
- Define contribution points (views, commands, status bar)
- Basic logging + error notification helpers

### Epic 2: Connections
- Connection profile model + validation
- Store profiles in settings; passwords in SecretStorage
- Connect/disconnect + status bar indicator
- Connection picker + quick-pick flow
- Pool lifecycle management

### Epic 3: Schema Explorer
- Tree view provider (schemas → tables → columns)
- Lazy loading + refresh command
- Schema cache with TTL + manual refresh
- Index/constraint nodes

### Epic 4: SQL Runner
- Query runner (selection or current statement)
- Query cancel (pg_cancel_backend)
- Result webview (grid + paging)
- Result metadata (row count, exec time)

### Epic 5: Data Editor
- Open table command + data webview
- Read with paging + sort
- Inline edit + change tracking
- Insert/delete rows + save/revert
- PK-aware update/delete; fallback with warning

### Epic 6: Export + History (V1)
- Export CSV/JSON from result grid
- Query history list + rerun
- Favorites (save SQL snippets)

### Epic 7: Tests
- Unit tests: SQL statement detection, CRUD SQL generation, schema cache
- Integration tests: run local Postgres via Docker
- Integration tests: query cancel + CRUD

### Epic 8: Docs + Packaging
- README with setup + connection examples
- Command palette usage + screenshots
- Marketplace assets + changelog

## Testing Plan
- Unit tests for:
  - SQL parsing (current statement detection)
  - CRUD query generation
  - Schema cache TTL logic
- Integration tests:
  - Local Postgres via Docker
  - Query run/cancel
  - Edit operations (insert/update/delete)

## Open Questions
- None
