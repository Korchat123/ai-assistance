import { Application, UPDATE_PRIORITY } from "pixi.js";
import type { Live2DModel } from "pixi-live2d-display/cubism4";

import type { AvatarAdapter } from "./avatar-controller.js";
import type { AvatarManifest } from "./avatar-types.js";

type CubismCoreModel = {
  setParameterValueById(id: string, value: number): void;
};

export class Live2DRenderer implements AvatarAdapter {
  private readonly app: Application;
  private readonly resizeObserver: ResizeObserver;
  private model: Live2DModel | undefined;
  private destroyed = false;
  private loadGeneration = 0;
  private mouthOpen = 0;

  public constructor(
    private readonly host: HTMLElement,
    private readonly manifest: AvatarManifest,
  ) {
    this.app = new Application({
      antialias: true,
      autoDensity: true,
      backgroundAlpha: 0,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
    });
    const canvas = this.app.view as HTMLCanvasElement;
    canvas.className = "live2d-canvas";
    canvas.setAttribute("aria-hidden", "true");
    host.appendChild(canvas);

    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
    });
    this.resizeObserver.observe(host);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    canvas.addEventListener("webglcontextlost", this.onContextLost);
    canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    this.app.ticker.add(this.applyLateParameters, this, UPDATE_PRIORITY.LOW);
    this.resize();
  }

  public async load(): Promise<void> {
    const generation = ++this.loadGeneration;
    await loadScript(this.manifest.coreUrl);
    const { Live2DModel } = await import("pixi-live2d-display/cubism4");
    const model = await Live2DModel.from(this.manifest.modelUrl, {
      ticker: this.app.ticker,
      autoFocus: false,
      autoHitTest: false,
    });
    if (this.destroyed || generation !== this.loadGeneration) {
      model.destroy({ children: true });
      return;
    }
    this.model?.destroy({ children: true });
    this.model = model;
    model.anchor.set(0.5, 0.5);
    this.app.stage.addChild(model);
    this.layoutModel();
  }

  public setExpression(id: string): Promise<boolean> {
    return this.model?.expression(id) ?? Promise.resolve(false);
  }

  public playMotion(group: string, index: number): Promise<boolean> {
    return this.model?.motion(group, index) ?? Promise.resolve(false);
  }

  public focus(x: number, y: number): void {
    this.model?.focus(x, y);
  }

  public setMouthOpen(value: number): void {
    this.mouthOpen = value;
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.loadGeneration += 1;
    this.resizeObserver.disconnect();
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    const canvas = this.app.view as HTMLCanvasElement;
    canvas.removeEventListener("webglcontextlost", this.onContextLost);
    canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.app.ticker.remove(this.applyLateParameters, this);
    this.model = undefined;
    this.app.destroy(true, {
      children: true,
      texture: true,
      baseTexture: true,
    });
  }

  private readonly applyLateParameters = () => {
    const parameterId = this.manifest.parameters.mouthOpen;
    const coreModel = this.model?.internalModel.coreModel as
      | CubismCoreModel
      | undefined;
    if (parameterId !== undefined && coreModel !== undefined) {
      coreModel.setParameterValueById(parameterId, this.mouthOpen);
    }
  };

  private resize(): void {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.app.renderer.resize(width, height);
    this.layoutModel();
  }

  private layoutModel(): void {
    const model = this.model;
    if (model === undefined) {
      return;
    }
    model.scale.set(1);
    const scale = Math.min(
      (this.app.screen.width * 0.9) / model.width,
      (this.app.screen.height * 0.9) / model.height,
    );
    model.scale.set(scale);
    model.position.set(this.app.screen.width / 2, this.app.screen.height / 2);
  }

  private readonly onVisibilityChange = () => {
    if (document.hidden) {
      this.app.ticker.stop();
    } else {
      this.app.ticker.start();
    }
  };

  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    this.app.ticker.stop();
  };

  private readonly onContextRestored = () => {
    if (!document.hidden) {
      this.app.ticker.start();
    }
    void this.load();
  };
}

const loadedScripts = new Map<string, Promise<void>>();

function loadScript(url: string): Promise<void> {
  const existing = loadedScripts.get(url);
  if (existing !== undefined) {
    return existing;
  }
  const loading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.addEventListener("load", () => resolve(), { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error(`Unable to load Cubism Core from ${url}.`)),
      { once: true },
    );
    document.head.appendChild(script);
  });
  loadedScripts.set(url, loading);
  void loading.catch(() => {
    loadedScripts.delete(url);
  });
  return loading;
}
