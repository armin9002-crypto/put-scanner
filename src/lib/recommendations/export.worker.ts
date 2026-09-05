/// <reference lib="webworker" />

import type { RecommendationRun } from './types.ts';

self.onmessage = (event: MessageEvent<{ run: RecommendationRun }>) => {
  const json = `${JSON.stringify(event.data.run, null, 2)}\n`;
  self.postMessage(new Blob([json], { type: 'application/json' }));
};

export {};
