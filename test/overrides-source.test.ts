// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonSource, readOverrides } from 'ts-flags';

afterEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('readOverrides', () => {
  it('reads localStorage JSON, then the query string on top', () => {
    localStorage.setItem('flags', JSON.stringify({ a: true, b: 'x' }));
    window.history.replaceState(null, '', '/?flags=b:dark,c:1:2,bad,:x');
    expect(readOverrides()).toEqual({ a: true, b: 'dark', c: '1:2' });
  });

  it('supports custom param/key and explicit inputs', () => {
    const storage = { getItem: (k: string) => (k === 'ff' ? '{"x":"1"}' : null) };
    expect(readOverrides({ search: '?f=y:2', param: 'f', key: 'ff', storage })).toEqual({ x: '1', y: '2' });
    expect(readOverrides({ search: '', storage: null })).toEqual({});
  });

  it('survives bad JSON, non-object JSON and throwing storage', () => {
    localStorage.setItem('flags', '{nope');
    expect(readOverrides()).toEqual({});
    localStorage.setItem('flags', '[1]');
    expect(readOverrides()).toEqual({});
    const storage = { getItem: () => { throw new Error('blocked'); } };
    expect(readOverrides({ storage })).toEqual({});
  });
});

const ok = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data), { status: 200 }));

describe('jsonSource', () => {
  it('caches within the TTL and de-duplicates in-flight requests', async () => {
    const fetch = vi.fn(() => ok({ a: { default: true } }));
    const src = jsonSource('/flags.json', { fetch, ttl: 1000 });
    const [x, y] = await Promise.all([src.load(), src.load()]);
    expect(x).toEqual({ a: { default: true } });
    expect(y).toBe(x);
    await src.load();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refetches after the TTL', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(() => ok({}));
    const src = jsonSource('/f', { fetch, ttl: 1000 });
    await src.load();
    vi.advanceTimersByTime(1001);
    await src.load();
    expect(fetch).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('returns the last good config when a refresh fails, throws when there is none', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response('', { status: 500 })));
    await expect(jsonSource('/f', { fetch }).load()).rejects.toThrow('responded 500');

    fetch.mockImplementationOnce(() => ok({ a: { default: 1 } }));
    const src = jsonSource('/f', { fetch, ttl: 0 });
    await src.load();
    await expect(src.load()).resolves.toEqual({ a: { default: 1 } });
  });

  it('persists to storage and starts from it on the next page load', async () => {
    const fetch = vi.fn(() => ok({ a: { default: 2 } }));
    await jsonSource('/f', { fetch, storage: localStorage }).load();
    const next = jsonSource('/f', { fetch, storage: localStorage });
    await expect(next.load()).resolves.toEqual({ a: { default: 2 } });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('ignores unreadable caches and full storage', async () => {
    localStorage.setItem('ts-flags:/f', '{bad');
    const storage = { getItem: (k: string) => localStorage.getItem(k), setItem: () => { throw new Error('quota'); } };
    const fetch = vi.fn(() => ok({}));
    await expect(jsonSource('/f', { fetch, storage }).load()).resolves.toEqual({});
  });

  it('uses global fetch by default and passes init through', async () => {
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => ok({}));
    await jsonSource('/f', { init: { credentials: 'include' } }).load();
    expect(spy).toHaveBeenCalledWith('/f', { credentials: 'include' });
    spy.mockRestore();
  });
});
