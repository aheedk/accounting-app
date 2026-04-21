// apps/api/src/app.ts
import express, { type Express } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { corsOrigins } from './config.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import healthRoutes from './routes/health.js';
import coaRoutes from './routes/chartOfAccounts.js';
import periodRoutes from './routes/fiscalPeriods.js';

export function makeApp(): Express {
  const app = express();
  app.use(requestId);
  app.use(cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      if (corsOrigins.includes(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(healthRoutes);
  app.use(authRoutes);
  app.use(meRoutes);
  app.use(coaRoutes);
  app.use(periodRoutes);
  app.use(errorHandler);
  return app;
}
