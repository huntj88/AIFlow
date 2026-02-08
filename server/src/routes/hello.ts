import { HttpRouter, HttpServerResponse } from '@effect/platform';

export const HelloRouter = HttpRouter.empty.pipe(
  HttpRouter.get('/api/hello', HttpServerResponse.json({ message: 'hello world' })),
);
