export type LocalVoiceState =
  | "idle"
  | "listening"
  | "speaking"
  | "unsupported"
  | "error";

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}

interface SpeechRecognitionEventLike extends Event {
  readonly results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: string;
}

interface SpeechSynthesisErrorEventLike extends Event {
  readonly error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type SpeechWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

export interface LocalVoiceCallbacks {
  onState(state: LocalVoiceState): void;
  onTranscript(text: string): void;
  onError(message: string): void;
}

export class LocalVoiceController {
  private recognition: SpeechRecognitionLike | undefined;
  private utterance: SpeechSynthesisUtterance | undefined;
  private listening = false;

  public constructor(private readonly callbacks: LocalVoiceCallbacks) {}

  public get supported(): boolean {
    const speechWindow = window as SpeechWindow;
    return (
      (speechWindow.SpeechRecognition ??
        speechWindow.webkitSpeechRecognition) !== undefined &&
      "speechSynthesis" in window
    );
  }

  public startListening(language = navigator.language): void {
    if (!this.supported) {
      this.callbacks.onState("unsupported");
      this.callbacks.onError(
        "Local voice requires a browser with Web Speech support, such as Chrome or Edge.",
      );
      return;
    }

    this.stopSpeaking();
    this.recognition?.abort();
    const speechWindow = window as SpeechWindow;
    const Recognition =
      speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (Recognition === undefined) {
      return;
    }

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = language;
    recognition.addEventListener("result", (event) => {
      const resultEvent = event as SpeechRecognitionEventLike;
      const transcript = Array.from(resultEvent.results)
        .filter((result) => result.isFinal)
        .map((result) => result[0].transcript)
        .join(" ")
        .trim();
      if (transcript !== "") {
        this.callbacks.onTranscript(transcript);
      }
    });
    recognition.addEventListener("error", (event) => {
      if (this.recognition !== recognition) {
        return;
      }
      const errorEvent = event as SpeechRecognitionErrorEventLike;
      this.listening = false;
      this.callbacks.onState("error");
      this.callbacks.onError(`Microphone recognition failed: ${errorEvent.error}.`);
    });
    recognition.addEventListener("end", () => {
      if (this.recognition !== recognition) {
        return;
      }
      this.listening = false;
      this.recognition = undefined;
      if (this.utterance === undefined) {
        this.callbacks.onState("idle");
      }
    });

    this.recognition = recognition;
    this.listening = true;
    this.callbacks.onState("listening");
    recognition.start();
  }

  public stopListening(): void {
    if (this.listening) {
      this.recognition?.stop();
    }
  }

  public speak(text: string, language = navigator.language): void {
    if (!this.supported || text.trim() === "") {
      return;
    }

    this.recognition?.abort();
    this.recognition = undefined;
    this.listening = false;
    this.stopSpeaking();
    const utterance = new SpeechSynthesisUtterance(text);
    this.utterance = utterance;
    utterance.lang = language;
    utterance.addEventListener("start", () => {
      if (this.utterance !== utterance) {
        return;
      }
      this.callbacks.onState("speaking");
    });
    utterance.addEventListener("end", () => {
      if (this.utterance !== utterance) {
        return;
      }
      this.utterance = undefined;
      this.callbacks.onState("idle");
    });
    utterance.addEventListener("error", (event) => {
      if (this.utterance !== utterance) {
        return;
      }
      this.utterance = undefined;
      const { error } = event as SpeechSynthesisErrorEventLike;
      if (error === "canceled" || error === "interrupted") {
        this.callbacks.onState("idle");
        return;
      }
      this.callbacks.onState("error");
      this.callbacks.onError(`Speech playback failed: ${error || "unknown error"}.`);
    });
    window.speechSynthesis.speak(utterance);
  }

  public stopSpeaking(): void {
    const wasSpeaking = this.utterance !== undefined;
    this.utterance = undefined;
    window.speechSynthesis?.cancel();
    if (wasSpeaking) {
      this.callbacks.onState("idle");
    }
  }

  public dispose(): void {
    this.recognition?.abort();
    this.recognition = undefined;
    this.listening = false;
    this.utterance = undefined;
    window.speechSynthesis?.cancel();
  }
}
