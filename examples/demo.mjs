// Run after `pnpm build`: node examples/demo.mjs
import { defineFlags, createFlags } from '../dist/index.js';

const flags = defineFlags({
  newCheckout: {
    default: false,
    rules: [
      { users: ['qa-1'], value: true },
      { attributes: { plan: ['pro', 'team'] }, value: true },
      { percentage: 20, value: true },
    ],
  },
  theme: { default: 'light', variants: ['light', 'dark', 'auto'] },
  pageSize: { default: 20, rules: [{ attributes: { country: 'IN' }, value: 50 }] },
});

const users = [
  { userId: 'qa-1', attributes: { plan: 'free' } },
  { userId: 'u-42', attributes: { plan: 'pro', country: 'IN' } },
  { userId: 'u-7', attributes: { plan: 'free', country: 'US' } },
  { userId: 'u-1001', attributes: { plan: 'free' } },
];
for (const context of users) {
  console.log(context.userId.padEnd(7), JSON.stringify(createFlags(flags, { context }).all()));
}

let on = 0;
for (let i = 0; i < 10000; i++) {
  if (createFlags(flags, { context: { userId: `user-${i}` } }).get('newCheckout')) on++;
}
console.log(`\n20% rollout over 10,000 users: ${on} enabled`);

const client = createFlags(flags, { context: users[2], overrides: { newCheckout: 'true', theme: 'dark', pageSize: 'oops' } });
console.log('overrides newCheckout="true" theme="dark" pageSize="oops" ->', JSON.stringify(client.all()));

client.setOverrides({});
client.apply({ newCheckout: { rules: [{ percentage: 100, value: true }] }, theme: { default: 'neon' } });
console.log('remote config (theme "neon" is not a variant, dropped) ->', JSON.stringify(client.all()));
