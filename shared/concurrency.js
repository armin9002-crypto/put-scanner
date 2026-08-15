function abortError() {
  const error = new Error('Operation aborted');
  error.name = 'AbortError';
  return error;
}

export async function mapWithConcurrency(items, limit, worker, options = {}) {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('Concurrency limit must be a positive integer');
  const results = new Array(items.length);
  let cursor = 0;
  let active = 0;

  async function runWorker() {
    while (true) {
      const index = cursor;
      if (index >= items.length) return;
      cursor += 1;

      if (options.signal?.aborted) {
        results[index] = { status: 'rejected', reason: abortError() };
        continue;
      }

      active += 1;
      options.onActiveChange?.(active);
      try {
        const value = await worker(items[index], index, options.signal);
        results[index] = { status: 'fulfilled', value };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      } finally {
        active -= 1;
        options.onActiveChange?.(active);
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}
