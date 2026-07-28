import { describe, expect, it } from "vitest";

import { MemoryPersistence } from "./persistence.js";

describe("artifact retention", () => {
  it("returns expired storage references for physical cleanup", async () => {
    const persistence = new MemoryPersistence();
    await persistence.createSession("ses_1", "con_1");
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
