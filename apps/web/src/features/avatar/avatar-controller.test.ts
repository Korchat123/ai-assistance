import { describe, expect, it, vi } from "vitest";

import {
  AvatarController,
  LipSyncSmoother,
  type AvatarAdapter,
} from "./avatar-controller.js";
import type { AvatarManifest } from "./avatar-types.js";

const manifest: AvatarManifest = {
  coreUrl: "/core.js",
  modelUrl: "/model.model3.json",
  parameters: { mouthOpen: "ParamMouthOpenY" },
  expressions: { happy: "smile" },
  motions: { nod: [{ group: "Nod", index: 0 }] },
};

function adapter() {
  const setExpression = vi.fn(() => Promise.resolve(true));
  const playMotion = vi.fn(() => Promise.resolve(true));
  const focus = vi.fn();
  const setMouthOpen = vi.fn();
  const target: AvatarAdapter = {
    setExpression,
    playMotion,
    focus,
    setMouthOpen,
  };
  return { target, setExpression, playMotion, focus, setMouthOpen };
}

describe("AvatarController", () => {
  it("maps semantic cues through only declared capabilities", async () => {
    const { target, setExpression, playMotion } = adapter();
    const controller = new AvatarController(target, manifest);

    await controller.applyCue({
      emotion: "happy",
      intensity: 0.8,
      gesture: "nod",
    });
    await controller.applyCue({
      emotion: "sad",
      intensity: 0.5,
      gesture: "wave",
    });

    expect(setExpression).toHaveBeenCalledOnce();
    expect(setExpression).toHaveBeenCalledWith("smile");
    expect(playMotion).toHaveBeenCalledOnce();
    expect(playMotion).toHaveBeenCalledWith("Nod", 0);
  });

  it("clamps focus and mouth values", () => {
    const { target, focus, setMouthOpen } = adapter();
    const controller = new AvatarController(target, manifest);

    controller.focus(4, -3);
    controller.setMouthOpen(2);

    expect(focus).toHaveBeenCalledWith(1, -1);
    expect(setMouthOpen).toHaveBeenCalledWith(1);
  });
});

describe("LipSyncSmoother", () => {
  it("gates noise and releases more slowly than it attacks", () => {
    const smoother = new LipSyncSmoother();
    expect(smoother.update(0.01, 16)).toBe(0);
    const attack = smoother.update(0.15, 45);
    const release = smoother.update(0, 45);
    expect(attack).toBeGreaterThan(0);
    expect(release).toBeGreaterThan(0);
    expect(release).toBeLessThan(attack);
  });
});
