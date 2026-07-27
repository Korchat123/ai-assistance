import type { ServerEvent } from "@live2d-agent/protocol";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";

import {
  AgentSocket,
  type ConnectionState,
} from "./transports/agent-socket.js";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

export function App() {
  const socket = useMemo(
    () => new AgentSocket(import.meta.env.VITE_AGENT_WS_URL ?? "ws://127.0.0.1:8000/ws"),
    [],
  );
  const [connection, setConnection] =
    useState<ConnectionState>("disconnected");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");

  useEffect(() => {
    const onState = (event: Event) => {
      setConnection((event as CustomEvent<ConnectionState>).detail);
    };
    const onServerEvent = (event: Event) => {
      consumeServerEvent((event as CustomEvent<ServerEvent>).detail);
    };

    socket.addEventListener("state", onState);
    socket.addEventListener("server-event", onServerEvent);
    socket.connect();

    return () => {
      socket.removeEventListener("state", onState);
      socket.removeEventListener("server-event", onServerEvent);
      socket.disconnect();
    };
  }, [socket]);

  function consumeServerEvent(event: ServerEvent): void {
    if (event.type === "turn.started") {
      setMessages((current) => [
        ...current,
        { id: event.turnId ?? event.eventId, role: "assistant", text: "" },
      ]);
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
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = input.trim();
    if (text.length === 0 || connection !== "connected") {
      return;
    }

    const turnId = socket.sendText(text);
    setMessages((current) => [
      ...current,
      { id: `${turnId}:user`, role: "user", text },
    ]);
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
          {messages.length === 0 ? (
            <p className="empty">Send a message to test protocol 1.0 streaming.</p>
          ) : (
            messages.map((message) => (
              <article className={`message ${message.role}`} key={message.id}>
                <span>{message.role}</span>
                <p>{message.text || "…"}</p>
              </article>
            ))
          )}
        </div>

        <form onSubmit={submit}>
          <input
            aria-label="Message"
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask the assistant…"
            value={input}
          />
          <button disabled={connection !== "connected"} type="submit">
            Send
          </button>
        </form>
      </section>
    </main>
  );
}
