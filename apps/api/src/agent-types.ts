import { z } from "zod";

export const AssistantTurnSchema = z
  .object({
    displayText: z.string().min(1).max(4_000),
    speechText: z.string().min(1).max(4_000),
    affect: z.object({
      emotion: z.enum([
        "neutral",
        "happy",
        "sad",
        "angry",
        "surprised",
        "thinking",
      ]),
      intensity: z.number().min(0).max(1),
    }),
    gesture: z.enum(["idle", "nod", "wave", "explain", "shrug"]).optional(),
    followUp: z.string().max(1_000).optional(),
  })
  .strict();

export type AssistantTurn = z.infer<typeof AssistantTurnSchema>;

export interface ConversationMessage {
  role: "user" | "assistant";
  text: string;
}

export interface AgentProvider {
  readonly name: string;
  createTurn(
    messages: readonly ConversationMessage[],
    signal: AbortSignal,
  ): Promise<AssistantTurn>;
}
