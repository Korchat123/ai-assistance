import { describe, expect, it, vi } from "vitest";

import { createRealtimeClientSecret } from "./realtime.js";

describe("Realtime client secrets", () => {
  it("binds a short-lived secret to a speech session without tools", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          value: "ek_test",
          expires_at: 1_800_000_000,
          session: { type: "realtime" },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await expect(
      createRealtimeClientSecret(
        {
          apiKey: "server-secret",
          model: "gpt-realtime-test",
          voice: "marin",
        },
        fetcher,
      ),
    ).resolves.toEqual({
      value: "ek_test",
      expiresAt: 1_800_000_000,
    });

    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/realtime/client_secrets");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer server-secret",
      "Content-Type": "application/json",
    });
    if (typeof init?.body !== "string") {
      throw new Error("Expected a JSON request body.");
    }
    const body = JSON.parse(init.body) as {
      expires_after: { seconds: number };
      session: {
        model: string;
        tools: unknown[];
        tool_choice: string;
        audio: {
          input: {
            turn_detection: {
              create_response: boolean;
              interrupt_response: boolean;
            };
          };
        };
      };
    };
    expect(body.expires_after.seconds).toBe(600);
    expect(body.session).toMatchObject({
      model: "gpt-realtime-test",
      tools: [],
      tool_choice: "none",
    });
    expect(body.session.audio.input.turn_detection).toMatchObject({
      create_response: true,
      interrupt_response: true,
    });
  });

  it("does not expose an upstream response body in errors", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("sensitive upstream detail", { status: 401 }),
    );

    await expect(
      createRealtimeClientSecret(
        { apiKey: "bad-key", model: "model", voice: "voice" },
        fetcher,
      ),
    ).rejects.toThrow("status 401");
  });
});
