import { vi } from "vitest";
import type { Pool, PoolClient } from "pg";

type QueryResponse = { rows: Record<string, unknown>[]; rowCount?: number | null };

export function makeClient(queryResponses: QueryResponse[]): PoolClient {
  let callIndex = 0;
  return {
    query: vi.fn().mockImplementation(() => {
      const resp = queryResponses[callIndex] ?? { rows: [] };
      callIndex++;
      return Promise.resolve(resp);
    }),
    release: vi.fn(),
  } as unknown as PoolClient;
}

export function makePool(client: PoolClient): Pool {
  return {
    connect: vi.fn().mockResolvedValue(client),
  } as unknown as Pool;
}

export function mockFetchOk(content: string) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
