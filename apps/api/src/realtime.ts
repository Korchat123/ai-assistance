import { z } from "zod";

const ClientSecretResponseSchema = z
  .object({
    value: z.string().min(1),
    expires_at: z.number().int().positive(),
  })
  .passthrough();

export type RealtimeConfig = {
  apiKey: string;
  model: string;
  voice: string;
};

export type RealtimeClientSecret = {
  value: string;
  expiresAt: number;
};

export async function createRealtimeClientSecret(
  config: RealtimeConfig,
  fetcher: typeof fetch = fetch,
): Promise<RealtimeClientSecret> {
  const response = await fetcher(
    "https://api.openai.com/v1/realtime/client_secrets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        expires_after: {
          anchor: "created_at",
          seconds: 600,
        },
        session: {
          type: "realtime",
          model: config.model,
          instructions:
            "You are a concise, friendly voice assistant. Never claim that you completed an external action. Ask the user to use the text interface for tools or account changes.",
          output_modalities: ["audio"],
          audio: {
            input: {
              transcription: {
                model: "gpt-4o-mini-transcribe",
              },
              turn_detection: {
                type: "server_vad",
                create_response: true,
                interrupt_response: true,
              },
            },
            output: {
              voice: config.voice,
            },
          },
          tools: [],
          tool_choice: "none",
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`OpenAI Realtime request failed with status ${response.status}.`);
  }

  const secret = ClientSecretResponseSchema.parse(await response.json());
  return {
    value: secret.value,
    expiresAt: secret.expires_at,
  };
}

