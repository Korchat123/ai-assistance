import {
  PROTOCOL_LIMITS,
  ServerEventSchema,
  type ServerEvent,
} from "@live2d-agent/protocol";
import { Pool } from "pg";

import type { ConversationMessage } from "./agent-types.js";

export type HydratedSession = {
  sessionId: string;
  conversationId: string;
  lastAcknowledgedSequence: number;
  events: ServerEvent[];
  messages: ConversationMessage[];
};

export type PersistedToolCall = {
  toolCallId: string;
  conversationId: string;
  turnId: string;
  toolName: string;
  argumentsHash?: string;
  status: string;
  output?: string;
  error?: string;
};

export type PersistedApproval = {
  approvalId: string;
  toolCallId: string;
  conversationId: string;
  turnId: string;
  argumentsHash: string;
  status: "pending" | "approved" | "denied";
};

export type ArtifactReference = {
  artifactId: string;
  conversationId: string;
  turnId?: string;
  storageKey: string;
  mediaType: string;
  byteSize: number;
  expiresAt?: string;
};

export interface Persistence {
  createSession(sessionId: string, conversationId: string): Promise<void>;
  loadSession(sessionId: string): Promise<HydratedSession | undefined>;
  appendEvent(event: ServerEvent): Promise<void>;
  recordMessage(
    conversationId: string,
    turnId: string,
    message: ConversationMessage,
  ): Promise<void>;
  acknowledge(sessionId: string, sequence: number): Promise<void>;
  recordToolCall(call: PersistedToolCall): Promise<void>;
  recordApproval(approval: PersistedApproval): Promise<void>;
  resolveApproval(
    approvalId: string,
    status: "approved" | "denied",
  ): Promise<void>;
  createArtifact(reference: ArtifactReference): Promise<void>;
  deleteExpiredArtifacts(now: string): Promise<ArtifactReference[]>;
  close(): Promise<void>;
}

export class MemoryPersistence implements Persistence {
  private readonly sessions = new Map<
    string,
    {
      conversationId: string;
      lastAcknowledgedSequence: number;
      events: ServerEvent[];
      messages: ConversationMessage[];
    }
  >();
  public readonly toolCalls = new Map<string, PersistedToolCall>();
  public readonly approvals = new Map<string, PersistedApproval>();
  public readonly artifacts = new Map<string, ArtifactReference>();

  public createSession(
    sessionId: string,
    conversationId: string,
  ): Promise<void> {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        conversationId,
        lastAcknowledgedSequence: -1,
        events: [],
        messages: [],
      });
    }
    return Promise.resolve();
  }

  public loadSession(sessionId: string): Promise<HydratedSession | undefined> {
    const session = this.sessions.get(sessionId);
    return Promise.resolve(
      session === undefined
        ? undefined
        : {
            sessionId,
            conversationId: session.conversationId,
            lastAcknowledgedSequence: session.lastAcknowledgedSequence,
            events: [...session.events],
            messages: [...session.messages],
          },
    );
  }

  public appendEvent(event: ServerEvent): Promise<void> {
    const session = this.sessions.get(event.sessionId);
    if (session !== undefined) {
      session.events.push(event);
      if (session.events.length > PROTOCOL_LIMITS.replayEvents) {
        session.events.shift();
      }
    }
    return Promise.resolve();
  }

  public acknowledge(sessionId: string, sequence: number): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session !== undefined) {
      session.lastAcknowledgedSequence = Math.max(
        session.lastAcknowledgedSequence,
        sequence,
      );
    }
    return Promise.resolve();
  }

  public recordMessage(
    conversationId: string,
    _turnId: string,
    message: ConversationMessage,
  ): Promise<void> {
    const session = [...this.sessions.values()].find(
      (candidate) => candidate.conversationId === conversationId,
    );
    session?.messages.push(message);
    return Promise.resolve();
  }

  public recordToolCall(call: PersistedToolCall): Promise<void> {
    this.toolCalls.set(call.toolCallId, call);
    return Promise.resolve();
  }

  public recordApproval(approval: PersistedApproval): Promise<void> {
    this.approvals.set(approval.approvalId, approval);
    return Promise.resolve();
  }

  public resolveApproval(
    approvalId: string,
    status: "approved" | "denied",
  ): Promise<void> {
    const approval = this.approvals.get(approvalId);
    if (approval !== undefined) {
      this.approvals.set(approvalId, { ...approval, status });
    }
    return Promise.resolve();
  }

  public createArtifact(reference: ArtifactReference): Promise<void> {
    this.artifacts.set(reference.artifactId, reference);
    return Promise.resolve();
  }

  public deleteExpiredArtifacts(now: string): Promise<ArtifactReference[]> {
    const expired = [...this.artifacts.values()].filter(
      (artifact) =>
        artifact.expiresAt !== undefined && artifact.expiresAt <= now,
    );
    for (const artifact of expired) {
      this.artifacts.delete(artifact.artifactId);
    }
    return Promise.resolve(expired);
  }

  public close(): Promise<void> {
    return Promise.resolve();
  }
}

export class PostgresPersistence implements Persistence {
  private readonly pool: Pool;

  public constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 10 });
  }

  public async createSession(
    sessionId: string,
    conversationId: string,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO conversations (conversation_id)
         VALUES ($1)
         ON CONFLICT (conversation_id) DO NOTHING`,
        [conversationId],
      );
      await client.query(
        `INSERT INTO sessions (session_id, conversation_id)
         VALUES ($1, $2)
         ON CONFLICT (session_id) DO NOTHING`,
        [sessionId, conversationId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public async loadSession(
    sessionId: string,
  ): Promise<HydratedSession | undefined> {
    const sessionResult = await this.pool.query<{
      session_id: string;
      conversation_id: string;
      last_acknowledged_sequence: number;
    }>(
      `SELECT session_id, conversation_id,
              last_acknowledged_sequence::int AS last_acknowledged_sequence
       FROM sessions
       WHERE session_id = $1`,
      [sessionId],
    );
    const session = sessionResult.rows[0];
    if (session === undefined) {
      return undefined;
    }
    const eventResult = await this.pool.query<{ event: unknown }>(
      `SELECT event
       FROM (
         SELECT sequence, event
         FROM run_events
         WHERE session_id = $1
         ORDER BY sequence DESC
         LIMIT $2
       ) recent
       ORDER BY sequence ASC`,
      [sessionId, PROTOCOL_LIMITS.replayEvents],
    );
    const messageResult = await this.pool.query<{
      role: ConversationMessage["role"];
      text: string;
    }>(
      `SELECT role, message_text AS text
       FROM messages
       WHERE conversation_id = $1
       ORDER BY message_sequence ASC`,
      [session.conversation_id],
    );
    return {
      sessionId: session.session_id,
      conversationId: session.conversation_id,
      lastAcknowledgedSequence: session.last_acknowledged_sequence,
      events: eventResult.rows.map((row) => ServerEventSchema.parse(row.event)),
      messages: messageResult.rows,
    };
  }

  public async appendEvent(event: ServerEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO run_events (
         event_id, session_id, conversation_id, turn_id, sequence,
         event_type, event, created_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
       ON CONFLICT (session_id, sequence) DO NOTHING`,
      [
        event.eventId,
        event.sessionId,
        event.conversationId,
        event.turnId ?? null,
        event.sequence,
        event.type,
        JSON.stringify(event),
        event.timestamp,
      ],
    );
  }

  public async acknowledge(sessionId: string, sequence: number): Promise<void> {
    await this.pool.query(
      `UPDATE sessions
       SET last_acknowledged_sequence =
             GREATEST(last_acknowledged_sequence, $2),
           updated_at = now()
       WHERE session_id = $1`,
      [sessionId, sequence],
    );
  }

  public async recordMessage(
    conversationId: string,
    turnId: string,
    message: ConversationMessage,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO messages (
         message_id, conversation_id, turn_id, role, message_text
       )
       VALUES ($1, $2, $3, $4, $5)`,
      [
        crypto.randomUUID(),
        conversationId,
        turnId,
        message.role,
        message.text,
      ],
    );
  }

  public async recordToolCall(call: PersistedToolCall): Promise<void> {
    await this.pool.query(
      `INSERT INTO tool_calls (
         tool_call_id, conversation_id, turn_id, tool_name,
         arguments_hash, status, output, error
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (tool_call_id) DO UPDATE SET
         status = EXCLUDED.status,
         output = COALESCE(EXCLUDED.output, tool_calls.output),
         error = COALESCE(EXCLUDED.error, tool_calls.error),
         updated_at = now()`,
      [
        call.toolCallId,
        call.conversationId,
        call.turnId,
        call.toolName,
        call.argumentsHash ?? null,
        call.status,
        call.output ?? null,
        call.error ?? null,
      ],
    );
  }

  public async recordApproval(approval: PersistedApproval): Promise<void> {
    await this.pool.query(
      `INSERT INTO approvals (
         approval_id, tool_call_id, conversation_id, turn_id,
         arguments_hash, status
       )
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (approval_id) DO NOTHING`,
      [
        approval.approvalId,
        approval.toolCallId,
        approval.conversationId,
        approval.turnId,
        approval.argumentsHash,
        approval.status,
      ],
    );
  }

  public async resolveApproval(
    approvalId: string,
    status: "approved" | "denied",
  ): Promise<void> {
    await this.pool.query(
      `UPDATE approvals
       SET status = $2, resolved_at = now()
       WHERE approval_id = $1 AND status = 'pending'`,
      [approvalId, status],
    );
  }

  public async createArtifact(reference: ArtifactReference): Promise<void> {
    await this.pool.query(
      `INSERT INTO artifacts (
         artifact_id, conversation_id, turn_id, storage_key,
         media_type, byte_size, expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        reference.artifactId,
        reference.conversationId,
        reference.turnId ?? null,
        reference.storageKey,
        reference.mediaType,
        reference.byteSize,
        reference.expiresAt ?? null,
      ],
    );
  }

  public async deleteExpiredArtifacts(
    now: string,
  ): Promise<ArtifactReference[]> {
    const result = await this.pool.query<{
      artifact_id: string;
      conversation_id: string;
      turn_id: string | null;
      storage_key: string;
      media_type: string;
      byte_size: string;
      expires_at: Date | null;
    }>(
      `DELETE FROM artifacts
       WHERE expires_at IS NOT NULL AND expires_at <= $1
       RETURNING artifact_id, conversation_id, turn_id, storage_key,
                 media_type, byte_size, expires_at`,
      [now],
    );
    return result.rows.map((row) => ({
      artifactId: row.artifact_id,
      conversationId: row.conversation_id,
      ...(row.turn_id === null ? {} : { turnId: row.turn_id }),
      storageKey: row.storage_key,
      mediaType: row.media_type,
      byteSize: Number(row.byte_size),
      ...(row.expires_at === null
        ? {}
        : { expiresAt: row.expires_at.toISOString() }),
    }));
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createPersistence(
  databaseUrl = process.env.DATABASE_URL,
): Persistence {
  return databaseUrl === undefined || databaseUrl.trim() === ""
    ? new MemoryPersistence()
    : new PostgresPersistence(databaseUrl);
}
