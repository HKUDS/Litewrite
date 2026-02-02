declare module 'ioredis' {
  interface RedisOptions {
    retryStrategy?: (times: number) => number | null | void;
    connectTimeout?: number;
    commandTimeout?: number;
    lazyConnect?: boolean;
    maxRetriesPerRequest?: number;
  }

  interface Pipeline {
    del(key: string): this;
    rpush(key: string, ...values: (string | Buffer)[]): this;
    lpush(key: string, ...values: (string | Buffer)[]): this;
    hset(key: string, field: string, value: string | number): this;
    exec(): Promise<Array<[Error | null, unknown]>>;
  }

  class Redis {
    constructor(url?: string, options?: RedisOptions);
    status: string;
    get(key: string): Promise<string | null>;
    set(key: string, value: string | Buffer, ...args: (string | number)[]): Promise<string | null>;
    del(...keys: string[]): Promise<number>;
    keys(pattern: string): Promise<string[]>;
    expire(key: string, seconds: number): Promise<number>;
    quit(): Promise<string>;
    disconnect(): void;
    on(event: string, listener: (...args: unknown[]) => void): this;
    off(event: string, listener: (...args: unknown[]) => void): this;
    once(event: string, listener: (...args: unknown[]) => void): this;
    rpush(key: string, ...values: (string | Buffer)[]): Promise<number>;
    lpush(key: string, ...values: (string | Buffer)[]): Promise<number>;
    rpop(key: string): Promise<string | null>;
    lpop(key: string): Promise<string | null>;
    lrange(key: string, start: number, stop: number): Promise<string[]>;
    lrangeBuffer(key: string, start: number, stop: number): Promise<Buffer[]>;
    ltrim(key: string, start: number, stop: number): Promise<string>;
    llen(key: string): Promise<number>;
    exists(...keys: string[]): Promise<number>;
    scan(cursor: string | number, ...args: (string | number)[]): Promise<[string, string[]]>;
    ping(): Promise<string>;
    hset(key: string, field: string, value: string | number): Promise<number>;
    hset(key: string, data: Record<string, string | number>): Promise<number>;
    hget(key: string, field: string): Promise<string | null>;
    hgetall(key: string): Promise<Record<string, string>>;
    hincrby(key: string, field: string, increment: number): Promise<number>;
    multi(): Pipeline;
    pipeline(): Pipeline;
    eval(script: string, numKeys: number, ...args: (string | number)[]): Promise<unknown>;
  }

  export default Redis;
  export { Redis, RedisOptions };
}
