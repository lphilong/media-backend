export interface CacheGetOptions {
  allowStale?: boolean;
}

export interface CacheSetOptions {
  ttlSeconds: number;
}

export interface CacheAdapter {
  get<T>(key: string, options?: CacheGetOptions): Promise<T | null>;
  set<T>(key: string, value: T, options: CacheSetOptions): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}
