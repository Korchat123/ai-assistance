import type {
  AvatarEmotion,
  AvatarGesture,
  AvatarManifest,
} from "./avatar-types.js";

export type AvatarCue = {
  emotion: AvatarEmotion;
  intensity: number;
  gesture?: AvatarGesture;
  durationMs?: number;
};

export type AvatarAdapter = {
  setExpression(id: string): Promise<boolean>;
  playMotion(group: string, index: number): Promise<boolean>;
  focus(x: number, y: number): void;
  setMouthOpen(value: number): void;
};

export class AvatarController {
  private cueSequence = 0;

  public constructor(
    private readonly adapter: AvatarAdapter,
    private readonly manifest: AvatarManifest,
  ) {}

  public async applyCue(cue: AvatarCue): Promise<void> {
    const sequence = ++this.cueSequence;
    const expression = this.manifest.expressions[cue.emotion];
    if (expression !== undefined) {
      await this.adapter.setExpression(expression);
    }
    if (sequence !== this.cueSequence || cue.gesture === undefined) {
      return;
    }
    const motions = this.manifest.motions[cue.gesture] ?? [];
    const motion = motions[0];
    if (motion !== undefined) {
      await this.adapter.playMotion(motion.group, motion.index);
    }
  }

  public focus(normalizedX: number, normalizedY: number): void {
    this.adapter.focus(clamp(normalizedX, -1, 1), clamp(normalizedY, -1, 1));
  }

  public setMouthOpen(value: number): void {
    this.adapter.setMouthOpen(clamp(value, 0, 1));
  }
}

export class LipSyncSmoother {
  private value = 0;

  public update(rms: number, deltaMs: number): number {
    const gated = rms < 0.018 ? 0 : clamp((rms - 0.018) / 0.16, 0, 1);
    const timeConstant = gated > this.value ? 45 : 140;
    const alpha = 1 - Math.exp(-Math.max(deltaMs, 0) / timeConstant);
    this.value += (gated - this.value) * alpha;
    return clamp(this.value, 0, 1);
  }

  public reset(): void {
    this.value = 0;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

