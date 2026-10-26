-- AI chat assistant: conversations + their messages. The chatbot never
-- writes to any business table itself (see chatSqlEngine.ts's read-only
-- guardrails and chatActionService.ts, which only ever returns a pre-fill
-- payload for a human to review and save through the existing create
-- endpoints) — these two tables are the entire footprint of the feature on
-- the schema.
CREATE TABLE chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  user_id uuid NOT NULL REFERENCES users(id),
  -- Set from the first user message once it's known, for a conversation list.
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_conversations_business_user
  ON chat_conversations(business_id, user_id, updated_at DESC);

CREATE TRIGGER chat_conversations_updated_at
  BEFORE UPDATE ON chat_conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TYPE chat_message_role AS ENUM ('user', 'assistant');

CREATE TABLE chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES chat_conversations(id),
  role chat_message_role NOT NULL,
  content text NOT NULL,
  -- The structured transaction pre-fill, when this assistant reply is an
  -- "action" intent response. Never consumed server-side again — only read
  -- back by the client that renders the review card.
  action_payload jsonb,
  -- The generated SQL for a "query"-intent turn, kept for debugging/audit —
  -- this is the feature's audit trail (see CLAUDE.md's Audit + schemas
  -- section): no business entity is created or changed by chat, so there's
  -- nothing to run through auditRecord()/AUDIT; the row itself is the record.
  sql_query text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_chat_messages_conversation
  ON chat_messages(conversation_id, created_at);
