# db/ conventions

### Postgres
- Migrations are sequentially numbered: `db/migrations/00NN_<name>.sql`.
- Triggers `set_updated_at` and `protect_posted` patterns are reused — see existing migrations for examples.
- Posted-period guard: services that mutate JE-bearing entities check the period is not closed before posting.
