export type SyncQueueRunResult = 'complete' | 'retry_later' | 'blocked';

export interface SyncNamespaceQueueOptions {
  debounceMs: number;
  run: () => Promise<SyncQueueRunResult>;
  setTimer?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

/** One coalescing, single-flight queue. Coordinators create one per namespace. */
export class SyncNamespaceQueue {
  private readonly debounceMs: number;
  private readonly runner: () => Promise<SyncQueueRunResult>;
  private readonly setTimer: NonNullable<SyncNamespaceQueueOptions['setTimer']>;
  private readonly clearTimer: NonNullable<SyncNamespaceQueueOptions['clearTimer']>;
  private mutationVersion = 0;
  private handledVersion = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<SyncQueueRunResult> | null = null;
  private disposed = false;

  constructor(options: SyncNamespaceQueueOptions) {
    if (!Number.isFinite(options.debounceMs) || options.debounceMs < 0) {
      throw new Error('Sync queue debounce must be a non-negative duration.');
    }
    this.debounceMs = options.debounceMs;
    this.runner = options.run;
    this.setTimer = options.setTimer ?? ((callback, milliseconds) => setTimeout(callback, milliseconds));
    this.clearTimer = options.clearTimer ?? (timer => clearTimeout(timer));
  }

  markMutation(): void {
    if (this.disposed) return;
    this.mutationVersion += 1;
    if (this.inFlight || this.timer) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.drain(false);
    }, this.debounceMs);
  }

  async flush(): Promise<SyncQueueRunResult> {
    if (this.disposed) return 'blocked';
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    if (this.inFlight) await this.inFlight;
    return this.drain(true);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null;
    this.mutationVersion = this.handledVersion;
  }

  getState(): { pending: boolean; inFlight: boolean } {
    return {
      pending: this.mutationVersion > this.handledVersion || this.timer !== null,
      inFlight: this.inFlight !== null,
    };
  }

  private drain(force: boolean): Promise<SyncQueueRunResult> {
    if (this.disposed) return Promise.resolve('blocked');
    if (this.inFlight) return this.inFlight;

    const operation = (async () => {
      let forceRun = force;
      let lastResult: SyncQueueRunResult = 'complete';
      while (!this.disposed && (forceRun || this.mutationVersion > this.handledVersion)) {
        forceRun = false;
        const targetVersion = this.mutationVersion;
        lastResult = await this.runner();
        if (lastResult !== 'complete') {
          // Pending state is retained by coordinator metadata. A future mutation
          // or explicit flush may start a new bounded attempt sequence.
          this.handledVersion = this.mutationVersion;
          break;
        }
        this.handledVersion = targetVersion;
      }
      return lastResult;
    })();

    this.inFlight = operation;
    void operation.finally(() => {
      if (this.inFlight === operation) this.inFlight = null;
    });
    return operation;
  }
}
