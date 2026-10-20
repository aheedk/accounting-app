import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().url(),
  API_PORT: z.coerce.number().int().positive().default(4000),
  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL_MINUTES: z.coerce.number().int().positive().default(15),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(180),
  // Shorter than the web's, since a lost/stolen phone is a more common threat
  // model than a lost browser session.
  JWT_MOBILE_REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:5173'),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export const config = schema.parse(process.env);
export const corsOrigins = config.CORS_ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
