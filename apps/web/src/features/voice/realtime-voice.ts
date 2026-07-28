export type RealtimeVoiceState =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "unsupported"
  | "error";

type RealtimeVoiceCallbacks = {
  onState(state: RealtimeVoiceState): void;
  onUserTranscript(itemId: string, text: string): void;
  onAssistantTranscript(itemId: string, text: string, completed: boolean): void;
  onAudioLevel(rms: number, deltaMs: number): void;
  onError(message: string): void;
};

type ClientSecret = {
  value: string;
  expiresAt: number;
};

type RealtimeEvent = {
  type?: string;
  item_id?: string;
  response_id?: string;
  transcript?: string;
  delta?: string;
  error?: {
    message?: string;
  };
};

export class RealtimeVoiceController {
  private peer: RTCPeerConnection | undefined;
  private channel: RTCDataChannel | undefined;
  private stream: MediaStream | undefined;
  private audio: HTMLAudioElement | undefined;
  private audioContext: AudioContext | undefined;
  private audioFrame: number | undefined;
  private assistantTranscripts = new Map<string, string>();

  public constructor(
    private readonly tokenUrl: string,
    private readonly callbacks: RealtimeVoiceCallbacks,
  ) {}

  public get supported(): boolean {
    return (
      typeof RTCPeerConnection !== "undefined" &&
      navigator.mediaDevices?.getUserMedia !== undefined
    );
  }

  public get connected(): boolean {
    return this.peer?.connectionState === "connected";
  }

  public async connect(): Promise<void> {
    if (!this.supported) {
      this.callbacks.onState("unsupported");
      this.callbacks.onError("Realtime voice requires WebRTC microphone support.");
      return;
    }

    this.disconnect();
    this.callbacks.onState("connecting");

    try {
      const tokenResponse = await fetch(this.tokenUrl, { method: "POST" });
      if (!tokenResponse.ok) {
        const detail = await readError(tokenResponse);
        throw new Error(detail);
      }
      const secret = (await tokenResponse.json()) as ClientSecret;
      if (typeof secret.value !== "string" || secret.value === "") {
        throw new Error("The server returned an invalid Realtime client secret.");
      }

      const peer = new RTCPeerConnection();
      this.peer = peer;
      const audio = document.createElement("audio");
      audio.autoplay = true;
      this.audio = audio;
      peer.addEventListener("track", (event) => {
        const remoteStream = event.streams[0];
        audio.srcObject = remoteStream ?? null;
        if (remoteStream !== undefined) {
          this.startAudioAnalysis(remoteStream);
        }
      });
      peer.addEventListener("connectionstatechange", () => {
        if (this.peer !== peer) {
          return;
        }
        if (peer.connectionState === "connected") {
          this.callbacks.onState("listening");
        } else if (
          peer.connectionState === "failed" ||
          peer.connectionState === "disconnected"
        ) {
          this.callbacks.onState("error");
          this.callbacks.onError("The Realtime voice connection was lost.");
        }
      });

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.stream = stream;
      for (const track of stream.getAudioTracks()) {
        peer.addTrack(track, stream);
      }

      const channel = peer.createDataChannel("oai-events");
      this.channel = channel;
      channel.addEventListener("message", (event) => {
        this.consumeEvent(String(event.data));
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (offer.sdp === undefined) {
        throw new Error("The browser did not create a WebRTC session offer.");
      }
      const sdpResponse = await fetch(
        "https://api.openai.com/v1/realtime/calls",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${secret.value}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
        },
      );
      if (!sdpResponse.ok) {
        throw new Error(
          `OpenAI rejected the WebRTC session (${sdpResponse.status}).`,
        );
      }
      await peer.setRemoteDescription({
        type: "answer",
        sdp: await sdpResponse.text(),
      });
    } catch (error) {
      this.disconnect(false);
      this.callbacks.onState("error");
      this.callbacks.onError(
        error instanceof Error
          ? error.message
          : "Unable to start Realtime voice.",
      );
    }
  }

  public interrupt(): void {
    if (this.channel?.readyState === "open") {
      this.channel.send(JSON.stringify({ type: "response.cancel" }));
    }
    this.callbacks.onState("listening");
  }

  public setMuted(muted: boolean): void {
    for (const track of this.stream?.getAudioTracks() ?? []) {
      track.enabled = !muted;
    }
    if (!muted && this.connected) {
      this.callbacks.onState("listening");
    }
  }

  public disconnect(updateState = true): void {
    this.channel?.close();
    this.channel = undefined;
    this.peer?.close();
    this.peer = undefined;
    for (const track of this.stream?.getTracks() ?? []) {
      track.stop();
    }
    this.stream = undefined;
    if (this.audioFrame !== undefined) {
      cancelAnimationFrame(this.audioFrame);
      this.audioFrame = undefined;
    }
    if (this.audioContext !== undefined) {
      void this.audioContext.close();
      this.audioContext = undefined;
    }
    this.callbacks.onAudioLevel(0, 0);
    if (this.audio !== undefined) {
      this.audio.pause();
      this.audio.srcObject = null;
    }
    this.audio = undefined;
    this.assistantTranscripts.clear();
    if (updateState) {
      this.callbacks.onState("idle");
    }
  }

  private consumeEvent(raw: string): void {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(raw) as RealtimeEvent;
    } catch {
      return;
    }

    if (event.type === "input_audio_buffer.speech_started") {
      this.callbacks.onState("listening");
      return;
    }
    if (event.type === "response.output_audio.started") {
      this.callbacks.onState("speaking");
      return;
    }
    if (
      event.type === "conversation.item.input_audio_transcription.completed" &&
      event.item_id !== undefined &&
      event.transcript?.trim()
    ) {
      this.callbacks.onUserTranscript(event.item_id, event.transcript.trim());
      return;
    }
    if (
      event.type === "response.output_audio_transcript.delta" &&
      event.delta !== undefined
    ) {
      const id = event.item_id ?? event.response_id ?? "realtime-assistant";
      const transcript = (this.assistantTranscripts.get(id) ?? "") + event.delta;
      this.assistantTranscripts.set(id, transcript);
      this.callbacks.onAssistantTranscript(id, transcript, false);
      this.callbacks.onState("speaking");
      return;
    }
    if (event.type === "response.output_audio_transcript.done") {
      const id = event.item_id ?? event.response_id ?? "realtime-assistant";
      const transcript =
        event.transcript ?? this.assistantTranscripts.get(id) ?? "";
      this.assistantTranscripts.delete(id);
      this.callbacks.onAssistantTranscript(id, transcript, true);
      return;
    }
    if (event.type === "response.done") {
      this.callbacks.onState("listening");
      return;
    }
    if (event.type === "error") {
      this.callbacks.onState("error");
      this.callbacks.onError(
        event.error?.message ?? "The Realtime session reported an error.",
      );
    }
  }

  private startAudioAnalysis(stream: MediaStream): void {
    if (this.audioFrame !== undefined) {
      cancelAnimationFrame(this.audioFrame);
    }
    if (this.audioContext !== undefined) {
      void this.audioContext.close();
    }
    const context = new AudioContext();
    this.audioContext = context;
    void context.resume();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    context.createMediaStreamSource(stream).connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let previousTime = performance.now();

    const sample = (time: number) => {
      if (this.audioContext !== context) {
        return;
      }
      analyser.getFloatTimeDomainData(samples);
      let sumSquares = 0;
      for (const value of samples) {
        sumSquares += value * value;
      }
      this.callbacks.onAudioLevel(
        Math.sqrt(sumSquares / samples.length),
        time - previousTime,
      );
      previousTime = time;
      this.audioFrame = requestAnimationFrame(sample);
    };
    this.audioFrame = requestAnimationFrame(sample);
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error ?? `Realtime session failed (${response.status}).`;
  } catch {
    return `Realtime session failed (${response.status}).`;
  }
}
