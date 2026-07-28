import type { ServerEvent } from "@live2d-agent/protocol";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import { AvatarView } from "./features/avatar/AvatarView.js";
import {
  LipSyncSmoother,
  type AvatarController,
} from "./features/avatar/avatar-controller.js";
import {
  LocalVoiceController,
  type LocalVoiceState,
} from "./features/voice/local-voice.js";
import {
  RealtimeVoiceController,
  type RealtimeVoiceState,
} from "./features/voice/realtime-voice.js";
import {
  AgentSocket,
  type ConnectionState,
} from "./transports/agent-socket.js";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type Approval = Extract<ServerEvent, { type: "approval.required" }>;
type MemoryCandidate = Extract<ServerEvent, { type: "memory.candidate" }>;
type MemoryItem = Extract<
  ServerEvent,
  { type: "memory.list" }
>["payload"]["items"][number];
type VoiceState = LocalVoiceState | RealtimeVoiceState;

export function App() {
  const voiceProvider = import.meta.env.VITE_VOICE_PROVIDER ?? "local";
  const socket = useMemo(
    () => new AgentSocket(import.meta.env.VITE_AGENT_WS_URL ?? "ws://127.0.0.1:8000/ws"),
    [],
  );
  const [connection, setConnection] =
    useState<ConnectionState>("disconnected");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string>();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [memoryCandidates, setMemoryCandidates] = useState<MemoryCandidate[]>([]);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [voiceState, setVoiceState] = useState<VoiceState>("idle");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const voiceRef = useRef<LocalVoiceController | undefined>(undefined);
  const realtimeVoiceRef = useRef<RealtimeVoiceController | undefined>(
    undefined,
  );
  const voiceEnabledRef = useRef(true);
  const connectionRef = useRef<ConnectionState>("disconnected");
  const avatarRef = useRef<AvatarController | undefined>(undefined);
  const lipSyncRef = useRef(new LipSyncSmoother());
  const setAvatarController = useCallback(
    (controller: AvatarController | undefined) => {
      avatarRef.current = controller;
    },
    [],
  );

  function sendMessage(text: string): void {
    const normalized = text.trim();
    if (normalized === "" || connectionRef.current !== "connected") {
      return;
    }
    const turnId = socket.sendText(normalized);
    setMessages((current) => [
      ...current,
      { id: `${turnId}:user`, role: "user", text: normalized },
    ]);
  }

  useEffect(() => {
    let localVoice: LocalVoiceController | undefined;
    let realtimeVoice: RealtimeVoiceController | undefined;
    if (voiceProvider === "local") {
      localVoice = new LocalVoiceController({
        onState: (state) => {
          setVoiceState(state);
          avatarRef.current?.setMouthOpen(state === "speaking" ? 0.35 : 0);
        },
        onTranscript: sendMessage,
        onError: setError,
      });
      voiceRef.current = localVoice;
      if (!localVoice.supported) {
        setVoiceState("unsupported");
      }
    } else {
      realtimeVoice = new RealtimeVoiceController(
        import.meta.env.VITE_REALTIME_TOKEN_URL ??
          "http://127.0.0.1:8000/realtime/client-secret",
        {
          onState: setVoiceState,
          onUserTranscript: (itemId, text) => {
            upsertRealtimeMessage(`realtime:user:${itemId}`, "user", text);
          },
          onAssistantTranscript: (itemId, text) => {
            upsertRealtimeMessage(
              `realtime:assistant:${itemId}`,
              "assistant",
              text,
            );
          },
          onAudioLevel: (rms, deltaMs) => {
            if (deltaMs === 0) {
              lipSyncRef.current.reset();
              avatarRef.current?.setMouthOpen(0);
              return;
            }
            avatarRef.current?.setMouthOpen(
              lipSyncRef.current.update(rms, deltaMs),
            );
          },
          onError: setError,
        },
      );
      realtimeVoiceRef.current = realtimeVoice;
      if (!realtimeVoice.supported) {
        setVoiceState("unsupported");
      }
    }

    const onState = (event: Event) => {
      const next = (event as CustomEvent<ConnectionState>).detail;
      connectionRef.current = next;
      setConnection(next);
    };
    const onServerEvent = (event: Event) => {
      consumeServerEvent((event as CustomEvent<ServerEvent>).detail);
    };
    const onProtocolError = (event: Event) => {
      setError((event as CustomEvent<string>).detail);
    };

    socket.addEventListener("state", onState);
    socket.addEventListener("server-event", onServerEvent);
    socket.addEventListener("protocol-error", onProtocolError);
    socket.connect();

    return () => {
      socket.removeEventListener("state", onState);
      socket.removeEventListener("server-event", onServerEvent);
      socket.removeEventListener("protocol-error", onProtocolError);
      socket.disconnect();
      localVoice?.dispose();
      realtimeVoice?.disconnect(false);
      voiceRef.current = undefined;
      realtimeVoiceRef.current = undefined;
    };
  }, [socket, voiceProvider]);

  function upsertRealtimeMessage(
    id: string,
    role: Message["role"],
    text: string,
  ): void {
    setMessages((current) => {
      const existing = current.findIndex((message) => message.id === id);
      if (existing === -1) {
        return [...current, { id, role, text }];
      }
      return current.map((message, index) =>
        index === existing ? { ...message, text } : message,
      );
    });
  }

  function consumeServerEvent(event: ServerEvent): void {
    if (event.type === "turn.started") {
      setMessages((current) => {
        const id = event.turnId ?? event.eventId;
        return current.some((message) => message.id === id)
          ? current
          : [...current, { id, role: "assistant", text: "" }];
      });
    }

    if (event.type === "assistant.text.delta") {
      setMessages((current) =>
        current.map((message) =>
          message.id === event.turnId
            ? { ...message, text: message.text + event.payload.delta }
            : message,
        ),
      );
    }

    if (event.type === "assistant.text.completed") {
      if (voiceProvider === "local" && voiceEnabledRef.current) {
        voiceRef.current?.speak(event.payload.text);
      }
      setMessages((current) =>
        current.map((message) =>
          message.id === event.turnId
            ? { ...message, text: event.payload.text }
            : message,
        ),
      );
    }

    if (event.type === "server.error") {
      setError(event.payload.message);
    }
    if (event.type === "avatar.cue") {
      void avatarRef.current?.applyCue({
        emotion: event.payload.emotion,
        intensity: event.payload.intensity,
        ...(event.payload.gesture === undefined
          ? {}
          : { gesture: event.payload.gesture }),
        ...(event.payload.durationMs === undefined
          ? {}
          : { durationMs: event.payload.durationMs }),
      });
    }
    if (event.type === "agent.state.changed") {
      const cue =
        event.payload.state === "thinking"
          ? { emotion: "thinking" as const, intensity: 0.65, gesture: "explain" as const }
          : event.payload.state === "speaking"
            ? { emotion: "happy" as const, intensity: 0.4, gesture: "idle" as const }
            : { emotion: "neutral" as const, intensity: 0.2, gesture: "idle" as const };
      void avatarRef.current?.applyCue(cue);
    }
    if (event.type === "approval.required") {
      setApprovals((current) =>
        current.some(
          (approval) => approval.payload.approvalId === event.payload.approvalId,
        )
          ? current
          : [...current, event],
      );
    }
    if (event.type === "memory.candidate") {
      setMemoryCandidates((current) =>
        current.some(
          (candidate) =>
            candidate.payload.candidateId === event.payload.candidateId,
        )
          ? current
          : [...current, event],
      );
    }
    if (event.type === "memory.list") {
      setMemories([...event.payload.items]);
    }
    if (event.type === "memory.changed") {
      if (event.payload.candidateId !== undefined) {
        setMemoryCandidates((current) =>
          current.filter(
            (candidate) =>
              candidate.payload.candidateId !== event.payload.candidateId,
          ),
        );
      }
      if (
        event.payload.action === "deleted" &&
        event.payload.memoryId !== undefined
      ) {
        setMemories((current) =>
          current.filter(
            (memory) => memory.memoryId !== event.payload.memoryId,
          ),
        );
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = input.trim();
    if (text.length === 0 || connection !== "connected") {
      return;
    }
    sendMessage(text);
    setInput("");
  }

  return (
    <main className="shell">
      <section className="avatar-panel" aria-label="Live2D avatar placeholder">
        <AvatarView onController={setAvatarController} />
      </section>

      <section className="chat-panel">
        <header>
          <div>
            <p className="eyebrow">Agentic assistant</p>
            <h1>Conversation prototype</h1>
          </div>
          <span className={`status status-${connection}`}>{connection}</span>
        </header>

        <div className="messages" aria-live="polite">
          {error !== undefined ? <p className="error">{error}</p> : null}
          {messages.length === 0 ? (
            <p className="empty">Send a message to test protocol 1.0 streaming.</p>
          ) : (
            messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <span>{message.role}</span>
                <p>{message.text || "..."}</p>
              </article>
            ))
          )}
        </div>

        {approvals.map((approval) => (
          <section className="approval" key={approval.payload.approvalId}>
            <p>{approval.payload.summary}</p>
            <button
              onClick={() => {
                socket.resolveApproval(approval.payload.approvalId, "approved");
                setApprovals((current) => current.filter((item) => item !== approval));
              }}
              type="button"
            >
              Approve
            </button>
            <button
              onClick={() => {
                socket.resolveApproval(approval.payload.approvalId, "denied");
                setApprovals((current) => current.filter((item) => item !== approval));
              }}
              type="button"
            >
              Deny
            </button>
          </section>
        ))}

        {memoryCandidates.map((candidate) => (
          <section className="approval memory-card" key={candidate.payload.candidateId}>
            <p>Save this memory?</p>
            <strong>{candidate.payload.content}</strong>
            <small>
              {candidate.payload.sensitivity} · expires{" "}
              {candidate.payload.expiresAt === undefined
                ? "never"
                : new Date(candidate.payload.expiresAt).toLocaleDateString()}
            </small>
            <div>
              <button
                onClick={() =>
                  socket.resolveMemory(candidate.payload.candidateId, "approved")
                }
                type="button"
              >
                Save memory
              </button>
              <button
                className="secondary"
                onClick={() =>
                  socket.resolveMemory(candidate.payload.candidateId, "denied")
                }
                type="button"
              >
                Deny
              </button>
            </div>
          </section>
        ))}

        {memories.length > 0 ? (
          <details className="memory-list">
            <summary>Saved memories ({memories.length})</summary>
            {memories.map((memory) => (
              <article key={memory.memoryId}>
                <p>{memory.content}</p>
                <small>{memory.sensitivity}</small>
                <button
                  className="secondary"
                  onClick={() => sendMessage(`/forget ${memory.memoryId}`)}
                  type="button"
                >
                  Delete
                </button>
              </article>
            ))}
          </details>
        ) : null}

        <section className="composer">
          <div className="voice-controls">
            <button
              className={
                voiceState === "listening" || voiceState === "speaking"
                  ? "voice-active"
                  : ""
              }
              disabled={
                connection !== "connected" ||
                voiceState === "unsupported" ||
                voiceState === "connecting"
              }
              onClick={() => {
                setError(undefined);
                if (voiceProvider === "local" && voiceState === "listening") {
                  voiceRef.current?.stopListening();
                } else if (voiceProvider === "local") {
                  voiceRef.current?.startListening();
                } else if (voiceState === "speaking") {
                  realtimeVoiceRef.current?.interrupt();
                } else if (realtimeVoiceRef.current?.connected) {
                  realtimeVoiceRef.current.disconnect();
                } else {
                  void realtimeVoiceRef.current?.connect();
                }
              }}
              type="button"
            >
              {voiceProvider === "local"
                ? voiceState === "listening"
                  ? "Stop listening"
                  : "Speak"
                : voiceState === "connecting"
                  ? "Connecting..."
                  : voiceState === "speaking"
                    ? "Interrupt"
                    : voiceState === "listening"
                      ? "End voice"
                      : "Start voice"}
            </button>
            <button
              className="secondary"
              onClick={() => {
                setVoiceEnabled((current) => {
                  if (voiceProvider === "local" && current) {
                    voiceRef.current?.stopSpeaking();
                  } else if (voiceProvider === "openai-realtime") {
                    realtimeVoiceRef.current?.setMuted(current);
                  }
                  voiceEnabledRef.current = !current;
                  return !current;
                });
              }}
              type="button"
            >
              {voiceProvider === "local"
                ? voiceEnabled
                  ? "Voice on"
                  : "Voice off"
                : voiceEnabled
                  ? "Mic on"
                  : "Mic off"}
            </button>
            <span className="voice-status">{voiceState.replace("_", " ")}</span>
          </div>
          <form onSubmit={submit}>
            <input
              aria-label="Message"
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask the assistant..."
              value={input}
            />
            <button disabled={connection !== "connected"} type="submit">
              Send
            </button>
          </form>
        </section>
      </section>
    </main>
  );
}
