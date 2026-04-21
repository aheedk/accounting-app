import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config, corsOrigins } from './config.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import healthRoutes from './routes/health.js';

const app = express();

app.use(requestId);
app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true); // curl, health checks
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

app.use(errorHandler);

app.listen(config.API_PORT, () => {
  console.log(`api listening on :${config.API_PORT}`);
});
