/**
 * Redis Client
 * ============
 *
 * Unified Redis connection management, supporting local Redis and Upstash.
 *
 * Environment variables:
 *   REDIS_URL - Redis connection URL
 *     Local: redis://localhost:6379
 *     Upstash: redis://default:xxx@xxx.upstash.io:6379
 *
 * Usage:
 *   import { getRedis, closeRedis } from "./redis-client";
 *   const redis = await getRedis();
 *   await redis.set("key", "value");
 */

import Redis from "ioredis";

// Redis instance (singleton)
let redisInstance: Redis | null = null;

// Connection state
let isConnecting = false;
let connectionPromise: Promise<Redis> | null = null;

/**
 * Get a Redis client instance.
 *
 * Reads the connection URL from environment variables. Supports:
 * - Local Redis: redis://localhost:6379
 * - Upstash: redis://default:xxx@xxx.upstash.io:6379
 * - Other Redis providers
 */
export async function getRedis(): Promise<Redis | null> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return null;
  }

  // If an instance exists and is ready, return it
  if (redisInstance && redisInstance.status === "ready") {
    return redisInstance;
  }

  // If a connection is in progress, wait for it
  if (isConnecting && connectionPromise) {
    return connectionPromise;
  }

  // Start a new connection
  isConnecting = true;
  connectionPromise = createRedisConnection();

  try {
    redisInstance = await connectionPromise;
    return redisInstance;
  } finally {
    isConnecting = false;
    connectionPromise = null;
  }
}

/**
 * Create a Redis connection.
 */
async function createRedisConnection(): Promise<Redis> {
  const redisUrl = process.env.REDIS_URL as string;

  console.log(`🔗 Connecting to Redis: ${redisUrl.replace(/\/\/.*@/, "//***@")}`); // Hide password

  const redis = new Redis(redisUrl, {
    // Reconnect strategy
    retryStrategy(times: number) {
      if (times > 10) {
        console.error("❌ Too many Redis reconnect attempts; giving up");
        return null; // Stop reconnecting
      }
      const delay = Math.min(times * 100, 3000);
      console.log(`🔄 Reconnecting to Redis... (attempt ${times}, retry in ${delay}ms)`);
      return delay;
    },

    // Connection timeout
    connectTimeout: 10000,

    // Command timeout
    commandTimeout: 5000,

    // Lazy connect (connect on first use)
    lazyConnect: false,

    // Max retries per request
    maxRetriesPerRequest: 3,
  });

  // Listen to connection events
  redis.on("connect", () => {
    console.log("✅ Redis connected");
  });

  redis.on("ready", () => {
    console.log("✅ Redis ready");
  });

  redis.on("error", (err: unknown) => {
    console.error("❌ Redis error:", err instanceof Error ? err.message : err);
  });

  redis.on("close", () => {
    console.log("🔒 Redis connection closed");
  });

  redis.on("reconnecting", () => {
    console.log("🔄 Redis reconnecting...");
  });

  // Wait for ready
  await new Promise<void>((resolve, reject) => {
    if (redis.status === "ready") {
      resolve();
      return;
    }

    const onReady = () => {
      redis.off("error", onError);
      resolve();
    };

    const onError = (err: unknown) => {
      redis.off("ready", onReady);
      reject(err);
    };

    redis.once("ready", onReady);
    redis.once("error", onError);
  });

  return redis;
}

/**
 * Close the Redis connection.
 */
export async function closeRedis(): Promise<void> {
  if (redisInstance) {
    console.log("🔒 Closing Redis connection...");
    await redisInstance.quit();
    redisInstance = null;
  }
}

/**
 * Check whether Redis is available.
 */
export async function isRedisAvailable(): Promise<boolean> {
  try {
    const redis = await getRedis();
    if (!redis) return false;
    const pong = await redis.ping();
    return pong === "PONG";
  } catch {
    return false;
  }
}

/**
 * Get the Redis connection status.
 */
export function getRedisStatus(): string {
  if (!redisInstance) {
    return "disconnected";
  }
  return redisInstance.status;
}

// ============================================================================
// Distributed lock
// ============================================================================

/**
 * Distributed lock.
 *
 * A simple distributed lock implemented with Redis SET NX to prevent concurrent operations.
 *
 * Example:
 *   const lock = new DistributedLock("analytics:flush");
 *   if (await lock.acquire()) {
 *     try {
 *       // Run work that must be locked
 *     } finally {
 *       await lock.release();
 *     }
 *   }
 */
export class DistributedLock {
  private lockKey: string;
  private ttlMs: number;
  private lockValue: string;

  /**
   * Create a distributed lock.
   * @param lockKey Unique identifier for the lock
   * @param ttlMs Lock TTL in milliseconds (default: 30s)
   */
  constructor(lockKey: string, ttlMs: number = 30000) {
    this.lockKey = `lock:${lockKey}`;
    this.ttlMs = ttlMs;
    this.lockValue = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  /**
   * Try to acquire the lock.
   * @returns Whether the lock was acquired
   */
  async acquire(): Promise<boolean> {
    try {
      const redis = await getRedis();
      if (!redis) return false;
      const result = await redis.set(
        this.lockKey,
        this.lockValue,
        "PX",
        this.ttlMs,
        "NX"
      );
      return result === "OK";
    } catch (error) {
      console.error("❌ Failed to acquire distributed lock:", error);
      return false;
    }
  }

  /**
   * Release the lock (only the owner can release).
   */
  async release(): Promise<void> {
    try {
      const redis = await getRedis();
      if (!redis) return;
      // Use a Lua script for atomicity: only the current owner can delete the lock
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await redis.eval(script, 1, this.lockKey, this.lockValue);
    } catch (error) {
      console.error("❌ Failed to release distributed lock:", error);
    }
  }

  /**
   * Extend the lock (renew TTL).
   *
   * For long-running operations, call periodically to prevent expiration.
   * Only the current owner can renew the lock.
   *
   * @returns Whether renewal succeeded
   */
  async extend(): Promise<boolean> {
    try {
      const redis = await getRedis();
      if (!redis) return false;
      // Use a Lua script for atomicity: only the current owner can renew the lock
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("pexpire", KEYS[1], ARGV[2])
        else
          return 0
        end
      `;
      const result = await redis.eval(script, 1, this.lockKey, this.lockValue, this.ttlMs);
      return result === 1;
    } catch (error) {
      console.error("❌ Failed to extend distributed lock:", error);
      return false;
    }
  }

  /**
   * Execute a function under the lock (auto acquire/release).
   * @param fn Function to run under the lock
   * @returns Result, or null if lock acquisition fails
   */
  async withLock<T>(fn: () => Promise<T>): Promise<T | null> {
    if (!(await this.acquire())) {
      return null;
    }
    try {
      return await fn();
    } finally {
      await this.release();
    }
  }
}

export default {
  getRedis,
  closeRedis,
  isRedisAvailable,
  getRedisStatus,
  DistributedLock,
};
