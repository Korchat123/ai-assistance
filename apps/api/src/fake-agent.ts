export interface FakeAgentChunk {
  delta: string;
}

export async function* streamFakeReply(
  userText: string,
  signal: AbortSignal,
): AsyncGenerator<FakeAgentChunk> {
  const reply = `You said: ${userText}`;
  const chunks = reply.match(/\S+\s*/g) ?? [reply];

  for (const delta of chunks) {
    if (signal.aborted) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 35);
    });

    yield { delta };
  }
}
