import { describe, expectTypeOf, it } from 'vitest';
import { createFlags, defineFlags, type Values } from 'ts-flags';
import { createFlagHooks } from '../src/react';

const flags = defineFlags({
  enabled: { default: false, rules: [{ percentage: 10, value: true }] },
  theme: { default: 'light', variants: ['light', 'dark'] },
  limit: { default: 10 },
  label: { default: 'Buy' },
});

describe('types (checked by `tsc --noEmit`)', () => {
  it('infers widened primitives and variant unions', () => {
    const c = createFlags(flags);
    expectTypeOf(c.get('enabled')).toEqualTypeOf<boolean>();
    expectTypeOf(c.get('theme')).toEqualTypeOf<'light' | 'dark'>();
    expectTypeOf(c.get('limit')).toEqualTypeOf<number>();
    expectTypeOf(c.get('label')).toEqualTypeOf<string>();
    expectTypeOf(c.all()).toEqualTypeOf<Values<typeof flags>>();
    // @ts-expect-error unknown flag name
    c.get('enabld');
  });

  it('rejects definitions whose values disagree with the default', () => {
    defineFlags({
      // @ts-expect-error rule value must be a boolean
      a: { default: false, rules: [{ value: 'yes' }] },
    });
    defineFlags({
      // @ts-expect-error default must be one of the variants
      b: { default: 'blue', variants: ['light', 'dark'] },
    });
    defineFlags({
      // @ts-expect-error rule value must be one of the variants
      c: { default: 'light', variants: ['light', 'dark'], rules: [{ value: 'neon' }] },
    });
  });

  it('types the React hook from the same definitions', () => {
    const { useFlag } = createFlagHooks(flags);
    expectTypeOf<Parameters<typeof useFlag>[0]>().toEqualTypeOf<'enabled' | 'theme' | 'limit' | 'label'>();
    expectTypeOf(useFlag<'theme'>).returns.toEqualTypeOf<'light' | 'dark'>();
  });
});
