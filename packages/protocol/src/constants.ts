export const PROTOCOL_VERSION = "1.0" as const;

export const PROTOCOL_LIMITS = {
  idLength: 128,
  textLength: 32_000,
  errorMessageLength: 2_000,
  durationMs: 30_000,
} as const;

export const agentStates = [
  "idle",
  "listening",
  "user_speaking",
  "thinking",
  "executing_tool",
  "speaking",
  "interrupted",
  "error",
] as const;

export const emotions = [
  "neutral",
  "happy",
  "sad",
  "angry",
  "surprised",
  "thinking",
] as const;

export const gestures = [
  "idle",
  "nod",
  "wave",
  "explain",
  "shrug",
] as const;

export const turnCompletionReasons = [
  "completed",
  "cancelled",
  "failed",
  "interrupted",
] as const;
