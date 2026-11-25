export type SyncPage<T> = { data: T[] | null; error?: unknown };

/** Drain every page; estimates and failed pages must never masquerade as completion. */
export async function collectSyncPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<SyncPage<T>>,
  requestedSize = 1000,
): Promise<T[]> {
  async function read(from: number, size: number): Promise<T[]> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const result = await fetchPage(from, from + size - 1);
        if (result.error) throw result.error;
        if (!Array.isArray(result.data)) throw new Error('Missing sync page');
        return result.data;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  const first = await read(0, requestedSize);
  if (first.length === 0) return [];
  // Respect a server-side response cap smaller than our requested page size.
  const pageSize = first.length;
  const rows = [...first];
  let offset = pageSize;
  while (true) {
    const pages = await Promise.all(Array.from({ length: 4 }, (_, index) => read(offset + index * pageSize, pageSize)));
    for (const page of pages) rows.push(...page);
    if (pages.some(page => page.length < pageSize)) return rows;
    offset += pageSize * 4;
  }
}

/**
 * Keyset pagination ordered by primary key `id ASC`.
 * Drains every bounded page in O(N) using the primary-key index (no OFFSET scan),
 * preventing PostgreSQL 57014 statement timeouts on 50k+ row tables.
 */
export async function collectKeysetPages<T extends { id?: unknown }>(
  fetchPage: (lastId: string | null, limit: number) => PromiseLike<SyncPage<T>>,
  pageSize = 1000,
): Promise<T[]> {
  async function read(lastId: string | null, limit: number): Promise<T[]> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const result = await fetchPage(lastId, limit);
        if (result.error) throw result.error;
        if (!Array.isArray(result.data)) throw new Error('Missing sync page');
        return result.data;
      } catch (error) {
        lastError = error;
        if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw lastError;
  }

  const rows: T[] = [];
  let lastId: string | null = null;

  while (true) {
    const page = await read(lastId, pageSize);
    if (page.length === 0) return rows;
    rows.push(...page);
    if (page.length < pageSize) return rows;
    const nextLastId = String(page[page.length - 1]?.id ?? '');
    if (!nextLastId || nextLastId === lastId) return rows;
    lastId = nextLastId;
  }
}