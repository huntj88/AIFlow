import { FetchHttpClient, HttpClient } from '@effect/platform';
import { Effect } from 'effect';

const makeRequest = (path: string) =>
  Effect.gen(function* () {
    const client = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
    const response = yield* client.get(path);
    return yield* response.json;
  }).pipe(
    Effect.scoped,
    Effect.provide(FetchHttpClient.layer),
    Effect.tap((res) => Effect.log('API response received', { path, response: res })),
    Effect.withLogSpan(`api.GET ${path}`),
  );

export const apiClient = {
  hello: () => makeRequest('/api/hello') as Effect.Effect<{ message: string }, Error>,
};
