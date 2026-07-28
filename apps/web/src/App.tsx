import type { ServerEvent } from "@live2d-agent/protocol";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";

import {
  LocalVoiceController,
  type LocalVoiceState,
} from "./features/voice/local-voice.js";
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
  const [voiceState, setVoiceState] = useState<LocalVoiceState>("idle");
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const voiceRef = useRef<LocalVoiceController | undefined>(undefined);
  const voiceEnabledRef = useRef(true);
  const connectionRef = useRef<ConnectionState>("disconnected");

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
    if (voiceProvider === "openai-realtime") {
      setVoiceState("unsupported");
      setError(
        "OpenAI Realtime voice is not enabled until the server has an API key and ephemeral-token endpoint.",
      );
    }
    const voice = new LocalVoiceController({
      onState: setVoiceState,
      onTranscript: sendMessage,
      onError: setError,
    });
    voiceRef.current = voice;
    if (voiceProvider === "local" && !voice.supported) {
      setVoiceState("unsupported");
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
      voice.dispose();
      voiceRef.current = undefined;
    };
  }, [socket, voiceProvider]);

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
    if (event.type === "approval.required") {
      setApprovals((current) =>
        current.some(
          (approval) => approval.payload.approvalId === event.payload.approvalId,
        )
          ? current
          : [...current, event],
      );
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
        <div className="avatar-placeholder">
          <span>Live2D</span>
          <small>Renderer arrives in Phase 5</small>
        </div>
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

        <section className="composer">
          <div className="voice-controls">
            <button
              className={voiceState === "listening" ? "voice-active" : ""}
              disabled={
                connection !== "connected" ||
                voiceState === "unsupported" ||
                voiceProvider !== "local"
              }
              onClick={() => {
                setError(undefined);
                if (voiceState === "listening") {
                  voiceRef.current?.stopListening();
                } else {
                  voiceRef.current?.startListening();
                }
              }}
              type="button"
            >
              {voiceState === "listening" ? "Stop listening" : "Speak"}
            </button>
            <button
              className="secondary"
              onClick={() => {
                setVoiceEnabled((current) => {
                  if (current) {
                    voiceRef.current?.stopSpeaking();
                  }
                  voiceEnabledRef.current = !current;
                  return !current;
                });
              }}
              type="button"
            >
              {voiceEnabled ? "Voice on" : "Voice off"}
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
