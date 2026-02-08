import { HttpApp } from '@effect/platform';
import { describe, expect, it } from 'vitest';

import { HelloRouter } from './hello.js';

describe('HelloRouter', () => {
  it('GET /api/hello returns hello world', async () => {
    const handler = HttpApp.toWebHandler(HelloRouter);
    const response = await handler(new Request('http://localhost/api/hello'));
    const body = (await response.json()) as { message: string };

    expect(body).toEqual({ message: 'hello world' });
  });
});
