export interface ConcurrencyOptions {
  signal?: AbortSignal;
  onActiveChange?: (active: number) => void;
}

export declare function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number, signal?: AbortSignal) => Promise<R> | R,
  options?: ConcurrencyOptions,
): Promise<PromiseSettledResult<R>[]>;
