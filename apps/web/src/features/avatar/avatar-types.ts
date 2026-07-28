export type AvatarEmotion =
  | "neutral"
  | "happy"
  | "sad"
  | "angry"
  | "surprised"
  | "thinking";

export type AvatarGesture = "idle" | "nod" | "wave" | "explain" | "shrug";

export type AvatarMotion = {
  group: string;
  index: number;
};

export type AvatarManifest = {
  coreUrl: string;
  modelUrl: string;
  parameters: {
    mouthOpen?: string;
    eyeX?: string;
    eyeY?: string;
  };
  expressions: Partial<Record<AvatarEmotion, string>>;
  motions: Partial<Record<AvatarGesture, AvatarMotion[]>>;
};

export function parseAvatarManifest(value: unknown): AvatarManifest {
  if (!isRecord(value)) {
    throw new Error("Avatar manifest must be an object.");
  }
  const coreUrl = requireString(value.coreUrl, "coreUrl");
  const modelUrl = requireString(value.modelUrl, "modelUrl");
  const parameters = parseStringRecord(value.parameters, "parameters");
  const expressions = parseStringRecord(value.expressions, "expressions");
  const motions = parseMotions(value.motions);

  return {
    coreUrl,
    modelUrl,
    parameters: {
      ...(parameters.mouthOpen === undefined
        ? {}
        : { mouthOpen: parameters.mouthOpen }),
      ...(parameters.eyeX === undefined ? {} : { eyeX: parameters.eyeX }),
      ...(parameters.eyeY === undefined ? {} : { eyeY: parameters.eyeY }),
    },
    expressions,
    motions,
  };
}

function parseMotions(value: unknown): AvatarManifest["motions"] {
  if (!isRecord(value)) {
    throw new Error("Avatar manifest field motions must be an object.");
  }
  const result: AvatarManifest["motions"] = {};
  for (const [gesture, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) {
      throw new Error(`Avatar motion ${gesture} must be an array.`);
    }
    result[gesture as AvatarGesture] = entries.map((entry) => {
      if (
        !isRecord(entry) ||
        typeof entry.group !== "string" ||
        !Number.isInteger(entry.index) ||
        Number(entry.index) < 0
      ) {
        throw new Error(`Avatar motion ${gesture} is invalid.`);
      }
      return { group: entry.group, index: Number(entry.index) };
    });
  }
  return result;
}

function parseStringRecord(
  value: unknown,
  field: string,
): Record<string, string> {
  if (!isRecord(value)) {
    throw new Error(`Avatar manifest field ${field} must be an object.`);
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string" || entry === "") {
      throw new Error(`Avatar manifest field ${field}.${key} is invalid.`);
    }
    result[key] = entry;
  }
  return result;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`Avatar manifest field ${field} must be a non-empty string.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

