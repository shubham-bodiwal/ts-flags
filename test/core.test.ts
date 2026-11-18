import { describe, expect, it, vi } from 'vitest';
import { bucket, coerce, createFlags, defineFlags, hash, matches, readOverrides } from 'ts-flags';

const flags = defineFlags({
  newCheckout: {
    default: false,
    rules: [
      { users: ['qa-1'], value: true },
      { attributes: { plan: ['pro', 'team'] }, value: true },
      { percentage: 25, value: true },
    ],
  },
  theme: { default: 'light', variants: ['light', 'dark', 'auto'] },
  pageSize: { default: 20, rules: [{ attributes: { country: 'IN' }, value: 50 }] },
  banner: { default: false, rules: [{ from: '2026-12-01T00:00:00Z', until: '2027-01-01T00:00:00Z', value: true }] },
  label: { default: 'Buy' },
});

const ids = (n: number) => Array.from({ length: n }, (_, i) => `user-${i}`);

describe('hashing and rollout', () => {
  it('hash is deterministic and 32-bit unsigned', () => {
    expect(hash('abc')).toBe(hash('abc'));
    expect(hash('abc')).not.toBe(hash('abd'));
    for (const s of ['', 'a', 'x'.repeat(500)]) {
      expect(hash(s)).toBeGreaterThanOrEqual(0);
      expect(hash(s)).toBeLessThan(2 ** 32);
    }
  });

  it('pins known values so bucketing never changes between releases', () => {
    expect([hash(''), hash('newCheckout:user-1'), bucket('newCheckout', 'user-1')]).toMatchInlineSnapshot(`
      [
        2872998923,
        591717318,
        73.18,
      ]
    `);
  });

  it('buckets 20k users evenly (each decile within ±1.5%)', () => {
    const deciles = new Array(10).fill(0);
    for (const id of ids(20_000)) deciles[Math.floor(bucket('f', id) / 10)]++;
    for (const n of deciles) expect(Math.abs(n / 20_000 - 0.1)).toBeLessThan(0.015);
  });

  it.each([1, 10, 25, 50, 90])('%i%% rollout lands within 1.5 points of target', (pct) => {
    const c = createFlags(defineFlags({ f: { default: false, rules: [{ percentage: pct, value: true }] } }));
    let on = 0;
    for (const userId of ids(20_000)) {
      c.setContext({ userId });
      if (c.get('f')) on++;
    }
    expect(Math.abs((on / 20_000) * 100 - pct)).toBeLessThan(1.5);
  });

  it('raising the percentage only adds users, never removes them', () => {
    const inAt = (pct: number) => new Set(ids(5000).filter((id) => bucket('f', id) < pct));
    const at10 = inAt(10);
    const at30 = inAt(30);
    for (const id of at10) expect(at30.has(id)).toBe(true);
  });

  it('different flags bucket independently; a shared salt buckets identically', () => {
    const a = ids(2000).map((id) => bucket('a', id) < 50);
    const b = ids(2000).map((id) => bucket('b', id) < 50);
    const overlap = a.filter((x, i) => x === b[i]).length / 2000;
    expect(overlap).toBeGreaterThan(0.45);
    expect(overlap).toBeLessThan(0.55);

    const defs = defineFlags({
      x: { default: false, salt: 'exp', rules: [{ percentage: 50, value: true }] },
      y: { default: false, salt: 'exp', rules: [{ percentage: 50, value: true }] },
    });
    const c = createFlags(defs);
    for (const userId of ids(500)) {
      c.setContext({ userId });
      expect(c.get('x')).toBe(c.get('y'));
    }
  });

  it('percentage never matches without a userId (stable on server and client)', () => {
    expect(matches({ value: true, percentage: 100 }, {}, 'f')).toBe(false);
  });
});

describe('rules', () => {
  it('falls back to the default when nothing matches', () => {
    const c = createFlags(flags, { context: { userId: 'nobody-in-rollout-xyz', attributes: { plan: 'free' } } });
    expect(c.get('theme')).toBe('light');
    expect(c.get('pageSize')).toBe(20);
    expect(c.get('label')).toBe('Buy');
  });

  it('matches user ids and attribute lists', () => {
    expect(createFlags(flags, { context: { userId: 'qa-1' } }).get('newCheckout')).toBe(true);
    expect(createFlags(flags, { context: { attributes: { plan: 'team' } } }).get('newCheckout')).toBe(true);
    expect(createFlags(flags, { context: { attributes: { plan: 'free' } } }).get('newCheckout')).toBe(false);
    expect(createFlags(flags, { context: { attributes: { country: 'IN' } } }).get('pageSize')).toBe(50);
    expect(createFlags(flags, { context: { attributes: { country: 'US' } } }).get('pageSize')).toBe(20);
  });

  it('all conditions in one rule must match (AND)', () => {
    const rule = { value: true, users: ['u1'], attributes: { beta: true } };
    expect(matches(rule, { userId: 'u1', attributes: { beta: true } }, 'f')).toBe(true);
    expect(matches(rule, { userId: 'u1', attributes: { beta: false } }, 'f')).toBe(false);
    expect(matches(rule, { userId: 'u2', attributes: { beta: true } }, 'f')).toBe(false);
    expect(matches(rule, { attributes: { beta: true } }, 'f')).toBe(false);
  });

  it('first matching rule wins', () => {
    const defs = defineFlags({
      v: { default: 'a', variants: ['a', 'b', 'c'], rules: [{ users: ['u'], value: 'b' }, { users: ['u'], value: 'c' }] },
    });
    expect(createFlags(defs, { context: { userId: 'u' } }).get('v')).toBe('b');
  });

  it('date windows: from is inclusive, until is exclusive; accepts Date, number and ISO', () => {
    const at = (now: string | number | Date) => createFlags(flags, { context: { now } }).get('banner');
    expect(at('2026-11-30T23:59:59Z')).toBe(false);
    expect(at('2026-12-01T00:00:00Z')).toBe(true);
    expect(at(new Date('2026-12-24T00:00:00Z'))).toBe(true);
    expect(at(Date.parse('2027-01-01T00:00:00Z'))).toBe(false);
  });

  it('date windows use the real clock when no `now` is given', () => {
    vi.useFakeTimers({ now: new Date('2026-12-10T00:00:00Z') });
    expect(createFlags(flags).get('banner')).toBe(true);
    vi.useRealTimers();
  });

  it('until-only window', () => {
    expect(matches({ value: 1, until: 1000 }, { now: 999 }, 'f')).toBe(true);
    expect(matches({ value: 1, until: 1000 }, { now: 1000 }, 'f')).toBe(false);
  });
});

describe('overrides', () => {
  it('beat rules and remote config, and are coerced to the flag type', () => {
    const c = createFlags(flags, {
      context: { userId: 'qa-1' },
      config: { newCheckout: { default: true } },
      overrides: { newCheckout: 'false', theme: 'dark', pageSize: '5' },
    });
    expect(c.all()).toEqual({ newCheckout: false, theme: 'dark', pageSize: 5, banner: false, label: 'Buy' });
  });

  it('invalid overrides are ignored', () => {
    const c = createFlags(flags, { overrides: { newCheckout: 'yes', theme: 'neon', pageSize: 'ten', label: 3 } });
    expect(c.get('newCheckout')).toBe(false);
    expect(c.get('theme')).toBe('light');
    expect(c.get('pageSize')).toBe(20);
    expect(c.get('label')).toBe('Buy');
  });

  it('coerce handles booleans, numbers, strings and variants', () => {
    expect(coerce({ default: false }, '1')).toBe(true);
    expect(coerce({ default: true }, '0')).toBe(false);
    expect(coerce({ default: true }, true)).toBe(true);
    expect(coerce({ default: 0 }, ' ')).toBeUndefined();
    expect(coerce({ default: 0 }, NaN)).toBeUndefined();
    expect(coerce({ default: 0 }, '2.5')).toBe(2.5);
    expect(coerce({ default: 1, variants: [1, 2] }, '3')).toBeUndefined();
    expect(coerce({ default: 'a' }, undefined)).toBeUndefined();
  });
});

describe('remote config', () => {
  it('replaces default and rules, keeps local rules when rules are absent', () => {
    const c = createFlags(flags, { context: { attributes: { country: 'IN' } } });
    c.apply({ pageSize: { default: 30 }, theme: { default: 'dark', rules: [] } });
    expect(c.get('pageSize')).toBe(50);
    expect(c.get('theme')).toBe('dark');
    c.apply({ pageSize: { rules: [{ attributes: { country: 'IN' }, value: 75 }] } });
    expect(c.get('pageSize')).toBe(75);
    expect(c.get('theme')).toBe('light');
  });

  it('drops unknown flags, wrong types and malformed rules', () => {
    const c = createFlags(flags, { context: { userId: 'abc', attributes: { plan: 'pro' } } });
    c.apply({
      nope: { default: 1 },
      theme: { default: 'neon' },
      label: null as never,
      newCheckout: {
        rules: [
          null,
          { value: 'maybe' },
          { users: 'abc', value: true }, // string, not array: would substring-match
          { users: [1], value: true },
          { attributes: 'x', value: true },
          { percentage: '100', value: true },
          { from: {}, value: true },
          { attributes: { plan: 'pro' }, value: true },
        ],
      },
    });
    expect(c.get('theme')).toBe('light');
    expect(c.get('label')).toBe('Buy');
    expect(c.get('newCheckout')).toBe(true);
    c.setContext({ userId: 'abc' });
    expect(c.get('newCheckout')).toBe(false);
    c.apply('garbage' as never);
    expect(c.get('newCheckout')).toBe(bucket('newCheckout', 'abc') < 25);
  });
});

describe('client', () => {
  it('notifies subscribers on every change and stops after unsubscribe', () => {
    const c = createFlags(flags);
    const fn = vi.fn();
    const off = c.subscribe(fn);
    c.setContext({ userId: 'qa-1' });
    c.setOverrides({});
    c.apply({});
    expect(fn).toHaveBeenCalledTimes(3);
    expect(c.context).toEqual({ userId: 'qa-1' });
    off();
    c.setContext({});
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('unknown names at runtime return undefined instead of throwing', () => {
    expect(createFlags(flags).get('missing' as never)).toBeUndefined();
  });
});

describe('server (no window)', () => {
  it('readOverrides is a no-op on the server', () => {
    expect(typeof window).toBe('undefined');
    expect(readOverrides()).toEqual({});
    expect(readOverrides({ search: '?flags=a:1' })).toEqual({ a: '1' });
  });
});
