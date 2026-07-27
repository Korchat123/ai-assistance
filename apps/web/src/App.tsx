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

type Approval = Extract<ServerEvent, { type: "approval.required" }>;

export function App() {
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

  useEffect(() => {
    const onState = (event: Event) => {
      setConnection((event as CustomEvent<ConnectionState>).detail);
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
    };
  }, [socket]);

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
    </main>
  );
}
