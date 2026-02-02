/**
 * Rate limiting
 * =========
 *
 * Redis-based rate limiting to prevent brute-force and DDoS attacks.
 *
 * Example:
 *   const result = await checkRateLimit("login", ip, { maxAttempts: 5, windowMs: 60000 });
 *   if (!result.allowed) {
 *     // Return a 429 error
 *   }
 */

import { getRedis } from "@/server/redis-client";
import type Redis from "ioredis";

// ioredis type extension (some methods are missing from the type definitions)
type RedisClient = Redis & {
  ttl(key: string): Promise<number>;
  incr(key: string): Promise<number>;
  pexpire(key: string, milliseconds: number): Promise<number>;
};

interface RateLimitOptions {
  /** Max attempts within the window */
  maxAttempts: number;
  /** Time window (ms) */
  windowMs: number;
  /** Lockout duration (ms) after exceeding max attempts */
  lockoutMs?: number;
}

interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Remaining attempts */
  remaining: number;
  /** Reset time (Unix timestamp, seconds) */
  resetTime: number;
  /** Whether the identifier is locked out */
  locked: boolean;
  /** Lockout remaining time (seconds) */
  lockoutRemaining?: number;
}

/**
 * Check rate limit.
 *
 * @param prefix Key prefix (e.g. "login", "register")
 * @param identifier Identifier (e.g. IP address, email)
 * @param options Rate limit options
 */
export async function checkRateLimit(
  prefix: string,
  identifier: string,
  options: RateLimitOptions
): Promise<RateLimitResult> {
  const { maxAttempts, windowMs, lockoutMs = windowMs * 2 } = options;

  try {
    const redis = (await getRedis()) as RedisClient | null;
    if (!redis) {
      // Redis not configured/available → allow (graceful degradation)
      return {
        allowed: true,
        remaining: maxAttempts,
        resetTime: Math.floor(Date.now() / 1000) + Math.ceil(windowMs / 1000),
        locked: false,
      };
    }
    const key = `ratelimit:${prefix}:${identifier}`;
    const lockKey = `ratelimit:${prefix}:${identifier}:locked`;

    // Check lockout
    const lockTtl = await redis.ttl(lockKey);
    if (lockTtl > 0) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: Math.floor(Date.now() / 1000) + lockTtl,
        locked: true,
        lockoutRemaining: lockTtl,
      };
    }

    // Get current attempt count
    const current = await redis.get(key);
    const attempts = current ? parseInt(current, 10) : 0;

    // If max attempts exceeded, set lockout
    if (attempts >= maxAttempts) {
      await redis.set(lockKey, "1", "PX", lockoutMs);
      await redis.del(key); // Clear counter

      return {
        allowed: false,
        remaining: 0,
        resetTime: Math.floor(Date.now() / 1000) + Math.ceil(lockoutMs / 1000),
        locked: true,
        lockoutRemaining: Math.ceil(lockoutMs / 1000),
      };
    }

    // Get TTL
    const ttl = await redis.ttl(key);
    const resetTime = ttl > 0
      ? Math.floor(Date.now() / 1000) + ttl
      : Math.floor(Date.now() / 1000) + Math.ceil(windowMs / 1000);

    return {
      allowed: true,
      remaining: maxAttempts - attempts,
      resetTime,
      locked: false,
    };
  } catch (error) {
    console.error("Rate limit check error:", error);
    // If Redis errors, allow by default (graceful degradation)
    return {
      allowed: true,
      remaining: maxAttempts,
      resetTime: Math.floor(Date.now() / 1000) + Math.ceil(windowMs / 1000),
      locked: false,
    };
  }
}

/**
 * Record an attempt (success or failure).
 *
 * @param prefix Key prefix
 * @param identifier Identifier
 * @param options Rate limit options
 * @param success Whether it succeeded (clears counter on success)
 */
export async function recordAttempt(
  prefix: string,
  identifier: string,
  options: RateLimitOptions,
  success: boolean = false
): Promise<void> {
  const { windowMs } = options;

  try {
    const redis = (await getRedis()) as RedisClient | null;
    if (!redis) return;
    const key = `ratelimit:${prefix}:${identifier}`;

    if (success) {
      // Clear counter on success
      await redis.del(key);
    } else {
      // Increment counter on failure
      const exists = await redis.exists(key);
      await redis.incr(key);

      // If it's a new key, set expiration
      if (!exists) {
        await redis.pexpire(key, windowMs);
      }
    }
  } catch (error) {
    console.error("Record attempt error:", error);
  }
}

/**
 * Clear rate limit (manual unlock).
 */
export async function clearRateLimit(
  prefix: string,
  identifier: string
): Promise<void> {
  try {
    const redis = await getRedis();
    if (!redis) return;
    const key = `ratelimit:${prefix}:${identifier}`;
    const lockKey = `ratelimit:${prefix}:${identifier}:locked`;

    // Redis Cluster / MemoryDB: multi-key DEL can fail with CROSSSLOT.
    await redis.del(key);
    await redis.del(lockKey);
  } catch (error) {
    console.error("Clear rate limit error:", error);
  }
}

// Predefined rate limit configs
export const RATE_LIMITS = {
  /** Login: max 5/min; lock out for 15 minutes after exceeding */
  LOGIN: {
    maxAttempts: 5,
    windowMs: 60 * 1000, // 1 minute
    lockoutMs: 15 * 60 * 1000, // 15 minutes
  },
  /** Register: max 3/hour */
  REGISTER: {
    maxAttempts: 3,
    windowMs: 60 * 60 * 1000, // 1 hour
    lockoutMs: 60 * 60 * 1000, // 1 hour
  },
};
