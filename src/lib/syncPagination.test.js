import { describe, expect, test } from 'bun:test';
import { collectSyncPages } from './syncPagination';

describe('complete device sync', () => {
  for (const count of [52000, 100000]) {
    test(`loads all ${count} records without an estimated-count cutoff`, async () => {
      const source = Array.from({ length: count }, (_, id) => ({ id }));
      const rows = await collectSyncPages(async (from, to) => ({ data: source.slice(from, to + 1) }));
      expect(rows.length).toBe(count);
      expect(new Set(rows.map(row => row.id)).size).toBe(count);
      expect(rows.at(-1)?.id).toBe(count - 1);
    });
  }
  test('drains more than 250 changed bills, including equal timestamps', async () => {
    const source = Array.from({ length: 1800 }, (_, id) => ({ id, updated_at: '2026-10-19T08:00:00Z' }));
    const rows = await collectSyncPages(async (from, to) => ({ data: source.slice(from, to + 1) }), 250);
    expect(rows.length).toBe(1800);
    expect(rows.at(-1)?.id).toBe(1799);
  });
  test('honors smaller server response caps', async () => {
    const source = Array.from({ length: 5200 }, (_, id) => id);
    const rows = await collectSyncPages(async (from, to) => ({ data: source.slice(from, Math.min(to + 1, from + 500)) }));
    expect(rows).toEqual(source);
  });
  test('retries a transient page error without skipping that page', async () => {
    let attempts = 0;
    const source = Array.from({ length: 2500 }, (_, id) => id);
    const rows = await collectSyncPages(async (from, to) => {
      if (from === 1000 && attempts++ === 0) return { data: null, error: new Error('network') };
      return { data: source.slice(from, to + 1) };
    });
    expect(rows).toEqual(source);
    expect(attempts).toBe(2);
  });
  test('rejects incomplete sync instead of committing partial data', async () => {
    await expect(collectSyncPages(async from => from === 0
      ? { data: Array.from({ length: 1000 }, (_, id) => id) }
      : { data: null, error: new Error('offline') })).rejects.toThrow('offline');
  });
});