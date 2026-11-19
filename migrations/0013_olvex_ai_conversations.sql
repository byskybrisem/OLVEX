CREATE TABLE olvex_ai_conversations (
  business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  branch_id TEXT,
  branch_name TEXT,
  title TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (business_id, user_id, id)
);

CREATE INDEX idx_olvex_ai_conversation_recent
  ON olvex_ai_conversations(business_id, user_id, updated_at DESC, id DESC);

CREATE TABLE olvex_ai_turns (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  started_at TEXT NOT NULL,
  attempt TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending','complete','failed')),
  answer TEXT,
  evidence TEXT,
  proposal_id TEXT,
  error TEXT,
  FOREIGN KEY (business_id, user_id, chat_id)
    REFERENCES olvex_ai_conversations(business_id, user_id, id) ON DELETE CASCADE,
  UNIQUE (business_id, user_id, chat_id, request_id)
);

CREATE INDEX idx_olvex_ai_turn_page ON olvex_ai_turns(business_id, user_id, chat_id, seq DESC);
CREATE UNIQUE INDEX idx_olvex_ai_one_active_turn
  ON olvex_ai_turns(business_id, user_id, chat_id) WHERE state = 'pending';
