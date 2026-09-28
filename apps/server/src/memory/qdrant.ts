/**
 * Minimal Qdrant client over its REST API (no SDK needed for three calls). Every request has
 * a short timeout: memory is an accelerator, so a slow or missing Qdrant must never hold up a run.
 */

export interface VectorPoint<P> {
  id: string;
  vector: number[];
  payload: P;
}

export interface ScoredPoint<P> {
  id: string;
  score: number;
  payload: P;
}

export interface VectorStore {
  /** Creates the collection (cosine distance) if it does not exist yet. */
  ensureCollection(name: string, size: number): Promise<void>;
  upsert<P>(collection: string, points: VectorPoint<P>[]): Promise<void>;
  search<P>(collection: string, vector: number[], limit: number): Promise<ScoredPoint<P>[]>;
}

export function createQdrant(opts: { url: string; timeoutMs?: number }): VectorStore {
  const timeoutMs = opts.timeoutMs ?? 1_500;

  async function call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; body: T | null }> {
    const res = await fetch(`${opts.url}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const parsed = (await res.json().catch(() => null)) as T | null;
    if (!res.ok && res.status !== 404) throw new Error(`Qdrant ${method} ${path} failed with ${res.status}`);
    return { status: res.status, body: parsed };
  }

  const known = new Set<string>();

  return {
    async ensureCollection(name, size) {
      if (known.has(name)) return;
      const existing = await call("GET", `/collections/${name}`);
      if (existing.status === 404) await call("PUT", `/collections/${name}`, { vectors: { size, distance: "Cosine" } });
      known.add(name);
    },
    async upsert(collection, points) {
      await call("PUT", `/collections/${collection}/points?wait=true`, { points });
    },
    async search<P>(collection: string, vector: number[], limit: number) {
      const { status, body } = await call<{ result: ScoredPoint<P>[] }>("POST", `/collections/${collection}/points/search`, {
        vector,
        limit,
        with_payload: true,
      });
      return status === 404 ? [] : (body?.result ?? []);
    },
  };
}
