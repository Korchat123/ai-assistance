CREATE TABLE IF NOT EXISTS conversations (
  conversation_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(conversation_id),
  last_acknowledged_sequence bigint NOT NULL DEFAULT -1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS run_events (
  event_id text PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  conversation_id text NOT NULL REFERENCES conversations(conversation_id),
  turn_id text,
  sequence bigint NOT NULL,
  event_type text NOT NULL,
  event jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (session_id, sequence)
);

CREATE INDEX IF NOT EXISTS run_events_conversation_sequence_idx
  ON run_events (conversation_id, sequence);

CREATE TABLE IF NOT EXISTS messages (
  message_sequence bigserial PRIMARY KEY,
  message_id text NOT NULL UNIQUE,
  conversation_id text NOT NULL REFERENCES conversations(conversation_id),
  turn_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  message_text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conversation_sequence_idx
  ON messages (conversation_id, message_sequence);

CREATE TABLE IF NOT EXISTS tool_calls (
  tool_call_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(conversation_id),
  turn_id text NOT NULL,
  tool_name text NOT NULL,
  arguments_hash text,
  status text NOT NULL,
  output text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS approvals (
  approval_id text PRIMARY KEY,
  tool_call_id text NOT NULL REFERENCES tool_calls(tool_call_id),
  conversation_id text NOT NULL REFERENCES conversations(conversation_id),
  turn_id text NOT NULL,
  arguments_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'denied')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE IF NOT EXISTS artifacts (
  artifact_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations(conversation_id),
  turn_id text,
  storage_key text NOT NULL UNIQUE,
  media_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS artifacts_expiry_idx
  ON artifacts (expires_at)
  WHERE expires_at IS NOT NULL;
