ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS client_id text;

UPDATE sessions
SET client_id = session_id
WHERE client_id IS NULL;

ALTER TABLE sessions
  ALTER COLUMN client_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS sessions_client_idx
  ON sessions (client_id);

CREATE TABLE IF NOT EXISTS conversation_summaries (
  conversation_id text PRIMARY KEY REFERENCES conversations(conversation_id)
    ON DELETE CASCADE,
  summary text NOT NULL,
  source_message_count integer NOT NULL CHECK (source_message_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memory_candidates (
  candidate_id text PRIMARY KEY,
  client_id text NOT NULL,
  conversation_id text NOT NULL REFERENCES conversations(conversation_id),
  turn_id text NOT NULL,
  content text NOT NULL,
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  sensitivity text NOT NULL
    CHECK (sensitivity IN ('low', 'personal', 'sensitive')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'denied')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL,
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS memory_candidates_owner_status_idx
  ON memory_candidates (client_id, status);

CREATE TABLE IF NOT EXISTS memory_items (
  memory_id text PRIMARY KEY,
  client_id text NOT NULL,
  content text NOT NULL,
  confidence double precision NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  sensitivity text NOT NULL
    CHECK (sensitivity IN ('low', 'personal', 'sensitive')),
  source_conversation_id text NOT NULL
    REFERENCES conversations(conversation_id),
  source_turn_id text NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL,
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS memory_items_owner_active_idx
  ON memory_items (client_id, created_at DESC)
  WHERE deleted_at IS NULL;
