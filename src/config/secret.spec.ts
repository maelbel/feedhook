import { inspect } from 'node:util';
import { Secret } from './secret.js';

describe('Secret', () => {
  const value = 'https://discord.com/api/webhooks/123/super-secret-token';
  const secret = new Secret(value);

  it('reveals the value only on explicit request', () => {
    expect(secret.reveal()).toBe(value);
  });

  it.each([
    ['template string', () => `${secret}`],
    ['String()', () => String(secret)],
    ['JSON.stringify', () => JSON.stringify({ secret })],
    ['util.inspect', () => inspect({ secret })],
    ['Object.keys', () => Object.keys(secret).join(',')],
  ])('does not leak through %s', (_, render) => {
    expect(render()).not.toContain('super-secret-token');
  });
});
