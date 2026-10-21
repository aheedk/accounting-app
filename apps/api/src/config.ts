import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(4000),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  // A session's length is no longer a setting: the firm's idle sign-out and a
  // 12-hour limit decide it (services/auth/authService.ts). A JWT_REFRESH_TTL_DAYS
  // still set on a host is ignored.
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export const config = schema.parse(process.env);

// The example secrets in .env.example are public: with them anyone could sign
// their own access tokens. Production refuses to start on them (security
// review 2026-10-21), and says so in the deploy log.
const EXAMPLE_SECRETS = new Set(['dev-access-secret-change-me', 'dev-refresh-secret-change-me']);
if (config.NODE_ENV === 'production') {
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const) {
    if (EXAMPLE_SECRETS.has(config[key])) {
      throw new Error(`${key} is the example value from .env.example. Set a long random one in the host's settings (node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))").`);
    }
    if (config[key].length < 32) console.warn(`[config] ${key} is shorter than 32 characters; a longer random one is safer.`);
  }
  if (config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET) {
    console.warn('[config] JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are the same; give each its own.');
  }
}
export const corsOrigins = config.CORS_ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
