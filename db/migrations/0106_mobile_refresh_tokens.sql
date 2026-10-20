-- Mobile clients can't use the web's httpOnly-cookie refresh flow, so their
-- refresh tokens are tagged distinctly: a mobile session gets a shorter
-- (30-day) rotation window and is only accepted back through the
-- body-based /auth/refresh-mobile route, never the cookie-based /auth/refresh.
ALTER TABLE refresh_tokens
  ADD COLUMN token_type text NOT NULL DEFAULT 'web' CHECK (token_type IN ('web', 'mobile'));
