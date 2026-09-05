/// <reference lib="webworker" />

import { runRecommendationEngine } from './engine.ts';
import type { RecommendationSnapshot } from './types.ts';

type EngineWorkerRequest = { snapshot: RecommendationSnapshot };
type EngineWorkerResponse = { run: ReturnType<typeof runRecommendationEngine> } | { error: string };

self.onmessage = (event: MessageEvent<EngineWorkerRequest>) => {
  try {
    self.postMessage({ run: runRecommendationEngine(event.data.snapshot) } satisfies EngineWorkerResponse);
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Recommendation analysis failed.' } satisfies EngineWorkerResponse);
  }
};

export {};
