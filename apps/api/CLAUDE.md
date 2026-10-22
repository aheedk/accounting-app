# apps/api conventions

### DB / Kysely
- Numeric/date columns: `ColumnType<string, string | number | undefined, string | number>`. **Never `Generated<ColumnType<>>`** — that double-wrap is a bug.
- Generated columns (defaults, sequences): `Generated<T>`.
- PL/pgSQL tenant filters: `COALESCE(current_setting('app.X', true), '')`.
