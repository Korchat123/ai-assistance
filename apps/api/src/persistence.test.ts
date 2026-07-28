import { describe, expect, it } from "vitest";

import { MemoryPersistence } from "./persistence.js";

describe("artifact retention", () => {
  it("returns expired storage references for physical cleanup", async () => {
    const persistence = new MemoryPersistence();
    await persistence.createSession("ses_1", "con_1", "client_1");
    await persistence.createArtifact({
      artifactId: "artifact_expired",
      conversationId: "con_1",
      storageKey: "con_1/expired.txt",
      mediaType: "text/plain",
      byteSize: 10,
      expiresAt: "2026-01-01T00:00:00.000Z",
    });
    await persistence.createArtifact({
      artifactId: "artifact_kept",
      conversationId: "con_1",
      storageKey: "con_1/kept.txt",
      mediaType: "text/plain",
      byteSize: 20,
      expiresAt: "2027-01-01T00:00:00.000Z",
    });

    const expired = await persistence.deleteExpiredArtifacts(
      "2026-06-01T00:00:00.000Z",
    );

    expect(expired.map((artifact) => artifact.artifactId)).toEqual([
      "artifact_expired",
    ]);
    expect(persistence.artifacts.has("artifact_kept")).toBe(true);
  });
});

describe("long-term memory isolation", () => {
  it("requires owner approval and owner deletion", async () => {
    const persistence = new MemoryPersistence();
    await persistence.createSession("ses_a", "con_a", "client_a");
    await persistence.createMemoryCandidate({
      candidateId: "candidate_a",
      clientId: "client_a",
      conversationId: "con_a",
      turnId: "turn_a",
      content: "Prefers concise answers.",
      confidence: 1,
      sensitivity: "personal",
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
    });

    await expect(
      persistence.resolveMemoryCandidate(
        "client_b",
        "candidate_a",
        "approved",
      ),
    ).resolves.toBeUndefined();
    const memory = await persistence.resolveMemoryCandidate(
      "client_a",
      "candidate_a",
      "approved",
    );
    expect(memory).toMatchObject({
      clientId: "client_a",
      sourceConversationId: "con_a",
      sourceTurnId: "turn_a",
    });
    await expect(
      persistence.listMemories("client_b", "2026-06-01T00:00:00.000Z"),
    ).resolves.toEqual([]);
    await expect(
      persistence.deleteMemory("client_b", memory?.memoryId ?? ""),
    ).resolves.toBe(false);
    await expect(
      persistence.deleteMemory("client_a", memory?.memoryId ?? ""),
    ).resolves.toBe(true);
  });

  it("filters expired memories", async () => {
    const persistence = new MemoryPersistence();
    await persistence.createSession("ses_a", "con_a", "client_a");
    await persistence.createMemoryCandidate({
      candidateId: "candidate_expired",
      clientId: "client_a",
      conversationId: "con_a",
      turnId: "turn_a",
      content: "Old preference.",
      confidence: 1,
      sensitivity: "personal",
      createdAt: "2025-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:00:00.000Z",
    });
    await persistence.resolveMemoryCandidate(
      "client_a",
      "candidate_expired",
      "approved",
    );

    await expect(
      persistence.listMemories("client_a", "2026-06-01T00:00:00.000Z"),
    ).resolves.toEqual([]);
  });
});
