-- gen_random_uuid() lives in pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- btree_gist is required by the EXCLUDE constraint used on fiscal_periods (plan 1.1)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- citext used for case-insensitive emails
CREATE EXTENSION IF NOT EXISTS citext;
