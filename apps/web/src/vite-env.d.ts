interface ImportMetaEnv {
  readonly VITE_AGENT_WS_URL?: string;
  readonly VITE_REALTIME_TOKEN_URL?: string;
  readonly VITE_VOICE_PROVIDER?: "local" | "openai-realtime";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
