process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://accounting:accounting@localhost:5432/accounting';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'test-access-secret-at-least-16-chars';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-at-least-16';
