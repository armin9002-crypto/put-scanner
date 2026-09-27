import { readFile, readdir } from 'node:fs/promises';

// Summarize opt-in browser measurements without imposing machine-specific limits.
const directory = new URL('../e2e-artifacts/performance/', import.meta.url);
const labels = process.argv.slice(2);
if (!labels.length) throw new Error('Usage: node scripts/performance-summary.mjs <before-label> [after-label]');
const files = await readdir(directory);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const summaries = [];
for (const label of labels) {
  for (const route of ['portfolio', 'options', 'watchlist', 'screener', 'pulse', 'recommendations']) {
    const selected = files.filter(file => file.startsWith(`${label}-`) && file.endsWith(`-${route}.json`));
    const samples = await Promise.all(selected.map(async file => JSON.parse(await readFile(new URL(file, directory), 'utf8'))));
    if (!samples.length) continue;
    const largestTasks = samples.map(sample => Math.max(0, ...sample.longTasks.filter(task => task.start >= sample.navigationStart).map(task => task.duration)));
    const requests = samples.map(sample => Object.fromEntries(Object.entries(sample.after).map(([endpoint, count]) => [endpoint, count - (sample.before[endpoint] || 0)]).filter(([, count]) => count).sort(([a], [b]) => a.localeCompare(b))));
    summaries.push({ label, route, samples: samples.length, medianNavigationMs: Math.round(median(samples.map(sample => sample.mountMs))), minNavigationMs: Math.round(Math.min(...samples.map(sample => sample.mountMs))), maxNavigationMs: Math.round(Math.max(...samples.map(sample => sample.mountMs))), medianLargestTaskMs: median(largestTasks), rows: samples[0].rows, requests });
  }
}
console.log(JSON.stringify(summaries, null, 2));
if (labels.length === 2) {
  for (const before of summaries.filter(summary => summary.label === labels[0])) {
    const after = summaries.find(summary => summary.label === labels[1] && summary.route === before.route);
    if (!after || before.rows !== after.rows || [...before.requests, ...after.requests].some(requests => JSON.stringify(requests) !== JSON.stringify(before.requests[0]))) {
      throw new Error(`Row population or navigation request counts changed for ${before.route}`);
    }
  }
  console.error('Before/after row populations and navigation request counts match.');
}
