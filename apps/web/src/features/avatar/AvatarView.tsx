import { useEffect, useRef, useState } from "react";

import { AvatarController } from "./avatar-controller.js";
import { parseAvatarManifest } from "./avatar-types.js";
import type { Live2DRenderer } from "./live2d-renderer.js";

type AvatarViewProps = {
  manifestUrl?: string;
  onController: (controller: AvatarController | undefined) => void;
};

type AvatarStatus = "loading" | "ready" | "placeholder" | "error";

export function AvatarView({
  manifestUrl = "/live2d/avatar-manifest.json",
  onController,
}: AvatarViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<AvatarStatus>("loading");

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) {
      return;
    }
    const abort = new AbortController();
    let renderer: Live2DRenderer | undefined;

    void (async () => {
      try {
        const response = await fetch(manifestUrl, { signal: abort.signal });
        if (response.status === 404) {
          setStatus("placeholder");
          return;
        }
        if (!response.ok) {
          throw new Error(`Avatar manifest request failed (${response.status}).`);
        }
        if (!response.headers.get("content-type")?.includes("application/json")) {
          setStatus("placeholder");
          return;
        }
        const manifest = parseAvatarManifest(await response.json());
        const { Live2DRenderer } = await import("./live2d-renderer.js");
        renderer = new Live2DRenderer(host, manifest);
        const controller = new AvatarController(renderer, manifest);
        await renderer.load();
        if (!abort.signal.aborted) {
          onController(controller);
          setStatus("ready");
        }
      } catch (error) {
        if (!abort.signal.aborted) {
          console.error(error);
          setStatus("error");
        }
      }
    })();

    return () => {
      abort.abort();
      onController(undefined);
      renderer?.destroy();
    };
  }, [manifestUrl, onController]);

  return (
    <div className="avatar-stage" ref={hostRef}>
      {status !== "ready" ? (
        <div className="avatar-placeholder">
          <span>Live2D</span>
          <small>
            {status === "loading"
              ? "Loading avatar configuration..."
              : status === "error"
                ? "Avatar unavailable—check the manifest and licensed assets."
                : "Add a licensed model to enable the renderer."}
          </small>
        </div>
      ) : null}
    </div>
  );
}
