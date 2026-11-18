export type Primitive = boolean | number | string;
export type Attribute = string | number | boolean;
export type Time = string | number | Date;

/** Who is asking. Everything is optional; rules that need a missing field simply don't match. */
export interface Context {
  userId?: string;
  attributes?: Record<string, Attribute | undefined>;
  /** Clock used for date windows. Pass it on the server and client to keep SSR output identical. */
  now?: Time;
}

/** A rule matches when every condition it lists matches (AND). The first matching rule wins. */
export interface Rule<T> {
  value: T;
  users?: readonly string[];
  attributes?: Record<string, Attribute | readonly Attribute[]>;
  /** 0–100. Bucketed by a stable hash of `userId`, so a user keeps their answer across sessions. */
  percentage?: number;
  /** Inclusive start of a date window. */
  from?: Time;
  /** Exclusive end of a date window. */
  until?: Time;
}

export interface FlagDef<T extends Primitive = Primitive> {
  default: T;
  /** Allowed values for string (or number) flags. Narrows the flag's type to this union. */
  variants?: readonly T[];
  rules?: readonly Rule<T>[];
  /** Flags sharing a salt bucket users identically. Defaults to the flag's name. */
  salt?: string;
  description?: string;
}

// biome-ignore lint/suspicious/noExplicitAny: each flag has its own value type; `defineFlags` checks them individually
export type Flags = Record<string, FlagDef<any>>;
type Widen<T> = T extends boolean ? boolean : T extends number ? number : T extends string ? string : never;
/** The value type of one flag definition. */
export type ValueOf<F> = F extends { variants: readonly (infer V)[] } ? V : F extends { default: infer T } ? Widen<T> : never;
export type Values<D extends Flags> = { [K in keyof D]: ValueOf<D[K]> };
export type FlagName<D extends Flags> = keyof D & string;

/** Untrusted remote shape: per-flag default and rules. Anything invalid is dropped on `apply`. */
export type RemoteConfig = Record<string, { default?: unknown; rules?: unknown } | undefined>;

/** Define flags once. Returns the input unchanged; it exists to infer and check types. */
export function defineFlags<const D extends Flags>(defs: D & { [K in keyof D]: FlagDef<ValueOf<D[K]>> }): D {
  return defs;
}

/** 32-bit FNV-1a with a murmur3 finaliser for even low bits. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Bucket in [0, 100) with 0.01 resolution. */
export const bucket = (seed: string, userId: string): number => (hash(seed + ':' + userId) % 10000) / 100;

const toTime = (t: Time): number => (t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t));

export function matches(rule: Rule<unknown>, ctx: Context, seed: string): boolean {
  const { userId, attributes } = ctx;
  if (rule.users && (userId === undefined || !rule.users.includes(userId))) return false;
  for (const k in rule.attributes) {
    const want = rule.attributes[k];
    const have = attributes?.[k];
    if (have === undefined || !(Array.isArray(want) ? want.includes(have) : want === have)) return false;
  }
  if (rule.from != null || rule.until != null) {
    const now = toTime(ctx.now ?? Date.now());
    if (rule.from != null && now < toTime(rule.from)) return false;
    if (rule.until != null && now >= toTime(rule.until)) return false;
  }
  if (rule.percentage != null && (userId === undefined || bucket(seed, userId) >= rule.percentage)) return false;
  return true;
}

/** Turn an override/remote value into the flag's type, or `undefined` if it doesn't fit. */
export function coerce<T extends Primitive>(def: FlagDef<T>, raw: unknown): T | undefined {
  const d = def.default;
  let v = raw;
  if (typeof raw === 'string' && typeof d !== 'string') {
    v = typeof d === 'boolean'
      ? raw === 'true' || raw === '1' ? true : raw === 'false' || raw === '0' ? false : undefined
      : raw.trim() === '' ? undefined : Number(raw);
  }
  if (typeof v !== typeof d || Number.isNaN(v)) return undefined;
  if (def.variants && !def.variants.includes(v as T)) return undefined;
  return v as T;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isTime = (x: unknown) => x == null || typeof x === 'string' || typeof x === 'number';

function cleanRule(def: FlagDef, r: unknown): Rule<Primitive> | undefined {
  if (!isObj(r)) return;
  const value = coerce(def, r.value);
  if (value === undefined) return;
  if (r.users != null && !(Array.isArray(r.users) && r.users.every((u) => typeof u === 'string'))) return;
  if (r.attributes != null && !isObj(r.attributes)) return;
  if (r.percentage != null && typeof r.percentage !== 'number') return;
  if (!isTime(r.from) || !isTime(r.until)) return;
  return { ...(r as unknown as Rule<Primitive>), value };
}

export interface FlagClient<D extends Flags> {
  get<K extends FlagName<D>>(name: K): ValueOf<D[K]>;
  all(): Values<D>;
  readonly context: Context;
  setContext(ctx: Context): void;
  /** Raw override values (strings are coerced). Invalid values are ignored. */
  setOverrides(overrides: Record<string, unknown>): void;
  /** Replace the remote layer. Unknown flags, wrong types and malformed rules are dropped. */
  apply(config: RemoteConfig): void;
  subscribe(listener: () => void): () => void;
}

export interface ClientOptions {
  context?: Context;
  overrides?: Record<string, unknown>;
  config?: RemoteConfig;
}

/** Precedence: override > first matching rule > default. Remote config replaces a flag's default and rules. */
export function createFlags<D extends Flags>(defs: D, options: ClientOptions = {}): FlagClient<D> {
  let ctx = options.context ?? {};
  let overrides = options.overrides ?? {};
  let remote: Record<string, FlagDef> = {};
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const l of listeners) l();
  };

  const get = (name: string): Primitive => {
    const def: FlagDef | undefined = defs[name];
    if (!def) return undefined as never;
    const o = coerce(def, overrides[name]);
    if (o !== undefined) return o;
    const eff = remote[name] ?? def;
    for (const rule of eff.rules ?? []) if (matches(rule, ctx, def.salt ?? name)) return rule.value;
    return eff.default;
  };

  const apply = (config: RemoteConfig) => {
    remote = {};
    if (!isObj(config)) return;
    for (const name in config) {
      const def: FlagDef | undefined = defs[name];
      const entry = config[name];
      if (!def || !isObj(entry)) continue;
      remote[name] = {
        ...def,
        default: coerce(def, entry.default) ?? def.default,
        rules: Array.isArray(entry.rules)
          ? entry.rules.map((r) => cleanRule(def, r)).filter((r) => r !== undefined)
          : def.rules,
      };
    }
  };
  if (options.config) apply(options.config);

  return {
    get: get as FlagClient<D>['get'],
    all: () => Object.fromEntries(Object.keys(defs).map((k) => [k, get(k)])) as Values<D>,
    get context() {
      return ctx;
    },
    setContext(c) {
      ctx = c;
      emit();
    },
    setOverrides(o) {
      overrides = o;
      emit();
    },
    apply(config) {
      apply(config);
      emit();
    },
    subscribe(l) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
}

export interface OverrideOptions {
  /** Defaults to `location.search` in the browser. */
  search?: string;
  /** Defaults to `localStorage` in the browser. Pass `null` to skip storage. */
  storage?: Pick<Storage, 'getItem'> | null;
  /** Query parameter, e.g. `?flags=newCheckout:true,theme:dark`. */
  param?: string;
  /** Storage key holding a JSON object, e.g. `{"newCheckout":true}`. */
  key?: string;
}

/** Read dev overrides from localStorage and the query string (query wins). Safe to call on the server. */
export function readOverrides(opts: OverrideOptions = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const browser = typeof window !== 'undefined';
  try {
    const storage = opts.storage === undefined ? (browser ? window.localStorage : null) : opts.storage;
    const saved = JSON.parse(storage?.getItem(opts.key ?? 'flags') ?? 'null');
    if (isObj(saved)) Object.assign(out, saved);
  } catch {
    // Blocked storage or bad JSON: no overrides.
  }
  const search = opts.search ?? (browser ? window.location.search : '');
  const list = new URLSearchParams(search).get(opts.param ?? 'flags');
  for (const pair of list ? list.split(',') : []) {
    const i = pair.indexOf(':');
    if (i > 0) out[pair.slice(0, i)] = pair.slice(i + 1);
  }
  return out;
}

export interface FlagSource {
  load(): Promise<RemoteConfig>;
}

export interface JsonSourceOptions {
  /** How long a fetched config is reused, in ms. Default 60 000. */
  ttl?: number;
  fetch?: typeof globalThis.fetch;
  init?: RequestInit;
  /** Persist the cache (e.g. `localStorage`) so a reload starts with the last config. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  key?: string;
}

/**
 * Fetch a JSON `RemoteConfig` with a TTL cache, in-flight de-duplication,
 * and stale-on-error (a failed refresh returns the last good config).
 */
export function jsonSource(url: string, opts: JsonSourceOptions = {}): FlagSource {
  const { ttl = 60_000, storage, init, key = 'ts-flags:' + url } = opts;
  let cache: { at: number; data: RemoteConfig } | undefined;
  let pending: Promise<RemoteConfig> | undefined;
  try {
    const saved = JSON.parse(storage?.getItem(key) ?? 'null');
    if (isObj(saved) && typeof saved.at === 'number' && isObj(saved.data)) cache = saved as typeof cache;
  } catch {
    // Ignore unreadable cache.
  }
  return {
    load() {
      if (cache && Date.now() - cache.at < ttl) return Promise.resolve(cache.data);
      const doFetch = opts.fetch ?? globalThis.fetch;
      pending ??= doFetch(url, init)
        .then((res) => {
          if (!res.ok) throw new Error(`ts-flags: ${url} responded ${res.status}`);
          return res.json() as Promise<RemoteConfig>;
        })
        .then((data) => {
          cache = { at: Date.now(), data };
          try {
            storage?.setItem(key, JSON.stringify(cache));
          } catch {
            // Quota or blocked storage: keep the in-memory cache.
          }
          return data;
        })
        .catch((err: unknown) => {
          if (cache) return cache.data;
          throw err;
        })
        .finally(() => {
          pending = undefined;
        });
      return pending;
    },
  };
}
