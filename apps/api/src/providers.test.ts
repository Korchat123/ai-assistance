import { describe, expect, it, vi } from "vitest";

import { OllamaAgentProvider } from "./providers.js";

describe("Ollama provider", () => {
  it("requests and validates a structured AssistantTurn", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              displayText: "Hello locally.",
              speechText: "Hello locally.",
              affect: { emotion: "happy", intensity: 0.5 },
              gesture: "wave",
            }),
          },
        }),
        { status: 200 },
      ),
    );
    const provider = new OllamaAgentProvider(
      "local-model",
      "http://localhost:11434",
      fetchMock,
    );

    await expect(
      provider.createTurn(
        [{ role: "user", text: "Hello" }],
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ displayText: "Hello locally." });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/chat",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchMock.mock.calls[0]?.[1];
    if (typeof request?.body !== "string") {
      throw new Error("Expected a JSON request body.");
    }
    const body = JSON.parse(request.body) as {
      format: Record<string, unknown>;
    };
    expect(body.format).toMatchObject({
      type: "object",
      required: ["displayText", "speechText", "affect"],
    });
    expect(JSON.stringify(body.format)).not.toContain("maxLength");
  });

  it("uses display text when Ollama returns empty speech text", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          message: {
            content: JSON.stringify({
              displayText: "A usable response.",
              speechText: "",
              affect: { emotion: "neutral", intensity: 0.2 },
            }),
          },
        }),
        { status: 200 },
      ),
    );
    const provider = new OllamaAgentProvider(
      "local-model",
      "http://localhost:11434",
      fetchMock,
    );

    await expect(
      provider.createTurn(
        [{ role: "user", text: "Hello" }],
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({
      displayText: "A usable response.",
      speechText: "A usable response.",
    });
  });
});
