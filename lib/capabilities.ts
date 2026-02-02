export type StorageProvider = "local" | "s3";

export interface StorageCapability {
  provider: StorageProvider;
  s3Configured: boolean;
  missing: string[];
}

export interface Capabilities {
  aiEnabled: boolean;
  aiReason?: string;
  deepResearchEnabled: boolean;
  deepResearchReason?: string;
  redisEnabled: boolean;
  storage: StorageCapability;
}

function hasNonEmpty(value: string | undefined | null): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function parseEnvBool(value: string | undefined | null): boolean | undefined {
  if (value == null) return undefined;
  const v = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "y", "on"].includes(v)) return true;
  if (["false", "0", "no", "n", "off"].includes(v)) return false;
  return undefined;
}

function computeAiEnabled(): { enabled: boolean; reason?: string } {
  const forced = parseEnvBool(process.env.AI_ENABLED);
  if (forced === false) {
    return { enabled: false, reason: "AI is disabled by AI_ENABLED=false." };
  }
  if (forced === true) {
    return { enabled: true };
  }

  const single = process.env.OPENROUTER_API_KEY;
  const multi = process.env.OPENROUTER_API_KEYS;
  const multiHasAny =
    hasNonEmpty(multi) && multi!.split(",").some((k) => k.trim().length > 0);

  const enabled = hasNonEmpty(single) || multiHasAny;
  if (!enabled) {
    return {
      enabled: false,
      reason: "Missing OpenRouter API key(s). Set OPENROUTER_API_KEY or OPENROUTER_API_KEYS.",
    };
  }
  return { enabled: true };
}

function computeDeepResearchEnabled(aiEnabled: boolean): { enabled: boolean; reason?: string } {
  const forced = parseEnvBool(process.env.DEEP_RESEARCH_ENABLED);
  if (forced === false) {
    return { enabled: false, reason: "Deep Research is disabled by DEEP_RESEARCH_ENABLED=false." };
  }
  if (forced === true) {
    return { enabled: true };
  }

  if (!aiEnabled) {
    return { enabled: false, reason: "AI is disabled, so Deep Research is unavailable." };
  }

  const embeddingKey = process.env.EMBEDDING_API_KEY;
  const searchKey = process.env.SERPER_API_KEY;

  const missing: string[] = [];
  if (!hasNonEmpty(embeddingKey)) missing.push("EMBEDDING_API_KEY");
  if (!hasNonEmpty(searchKey)) missing.push("SERPER_API_KEY");

  if (missing.length > 0) {
    return {
      enabled: false,
      reason: `Missing Deep Research dependencies: ${missing.join(", ")}`,
    };
  }

  return { enabled: true };
}

function computeRedisEnabled(): boolean {
  const forced = parseEnvBool(process.env.REDIS_ENABLED);
  if (forced !== undefined) return forced;
  return hasNonEmpty(process.env.REDIS_URL);
}

function computeStorage(): StorageCapability {
  const provider = (process.env.STORAGE_PROVIDER || "local") as StorageProvider;
  if (provider !== "s3") {
    return { provider: "local", s3Configured: false, missing: [] };
  }

  const missing: string[] = [];
  if (!hasNonEmpty(process.env.S3_BUCKET)) missing.push("S3_BUCKET");
  if (!hasNonEmpty(process.env.S3_REGION)) missing.push("S3_REGION");

  // If using static credentials (e.g. MinIO), both keys must be set.
  // If running on AWS with ambient credentials (IRSA/instance role), keys can be omitted.
  const accessKey = process.env.S3_ACCESS_KEY_ID;
  const secretKey = process.env.S3_SECRET_ACCESS_KEY;
  if ((hasNonEmpty(accessKey) && !hasNonEmpty(secretKey)) || (!hasNonEmpty(accessKey) && hasNonEmpty(secretKey))) {
    missing.push("S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY (both or neither)");
  }

  return {
    provider: "s3",
    s3Configured: missing.length === 0,
    missing,
  };
}

export function getServerCapabilities(): Capabilities {
  const ai = computeAiEnabled();
  const deep = computeDeepResearchEnabled(ai.enabled);

  return {
    aiEnabled: ai.enabled,
    aiReason: ai.reason,
    deepResearchEnabled: deep.enabled,
    deepResearchReason: deep.reason,
    redisEnabled: computeRedisEnabled(),
    storage: computeStorage(),
  };
}
