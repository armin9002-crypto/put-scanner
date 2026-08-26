import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const baseUrl = process.argv[2] || 'http://127.0.0.1:4173';
const outputDirectory = path.join(os.tmpdir(), 'put-scanner-focused-ux-screenshots');
const fixtureYear = new Date().getUTCFullYear() + 1;
const requestedIso = `${fixtureYear}-05-21`;
const shortestIso = `${fixtureYear}-01-15`;
const soldIso = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
const requestedTimestamp = Date.parse(`${requestedIso}T00:00:00Z`) / 1_000;
const shortestTimestamp = Date.parse(`${shortestIso}T00:00:00Z`) / 1_000;

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForFile(filePath, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      return await readFile(filePath, 'utf8');
    } catch {
      await delay(50);
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

async function waitForJson(url, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
    } catch {
      // Chrome is still starting.
    }
    await delay(50);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function createCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 0;
  const ready = new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  return {
    async send(method, params = {}) {
      await ready;
      const id = ++nextId;
      const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return response;
    },
    close: () => socket.close(),
  };
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result.value;
}

async function waitFor(client, expression, label, timeoutMs = 10_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(client, expression)) return;
    await delay(50);
  }
  const state = await evaluate(client, `({
    location: location.href,
    readyState: document.readyState,
    text: document.body?.innerText?.slice(0, 800),
    requests: window.__focusedUxRequests,
  })`);
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(state)}`);
}

async function navigate(client, url) {
  await client.send('Page.navigate', { url });
  await waitFor(client, 'document.readyState === "interactive" || document.readyState === "complete"', url, 30_000);
}

async function setViewport(client, width, height, mobile) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
}

async function screenshot(client, name) {
  const capture = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const filePath = path.join(outputDirectory, `${name}.png`);
  await writeFile(filePath, Buffer.from(capture.data, 'base64'));
  return filePath;
}

const injectedFixture = `(() => {
  const shortest = ${shortestTimestamp};
  const requested = ${requestedTimestamp};
  const expirations = [shortest, requested];
  localStorage.setItem('scanner_option_expirations_v1', JSON.stringify({
    TQQQ: { dates: expirations, updatedAt: new Date().toISOString() }
  }));
  localStorage.setItem('put_scanner_portfolio_trades', JSON.stringify([{
    id: 'focused-ux-trade', ticker: 'TQQQ', optionType: 'put', strike: 50,
    expiration: '${shortestIso}', contracts: 2, soldPrice: 1.25, soldDate: '${soldIso}',
    status: 'open', notes: 'Focused UX fixture', entryVixClose: 16.5,
    entryVixDate: '${soldIso}', entryVixSource: 'historical_close',
    createdAt: '${soldIso}T14:00:00.000Z', updatedAt: '${soldIso}T14:00:00.000Z',
    entrySnapshot: { underlyingPrice: 60, bid: 1.2, ask: 1.3, last: 1.25, iv: 0.45, delta: -0.2 },
    latestMarketData: { underlyingPrice: 62, optionBid: 0.8, optionAsk: 0.9, optionLast: 0.85, iv: 0.4, delta: -0.18, volume: 50, openInterest: 500 }
  }]));
  window.__focusedUxRequests = [];
  window.__focusedUxDurableWrites = [];
  const nativeSetItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    if (this === localStorage && ['put_scanner_portfolio_trades', 'put_scanner_watchlist', 'put_scanner_preferences'].includes(String(key))) {
      window.__focusedUxDurableWrites.push(String(key));
    }
    return nativeSetItem.call(this, key, value);
  };
  const nativeFetch = window.fetch.bind(window);
  const json = value => Promise.resolve(new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const optionPayload = date => {
    const selected = expirations.includes(date) ? date : shortest;
    const iso = new Date(selected * 1000).toISOString().slice(2, 10).replaceAll('-', '');
    return { optionChain: { result: [{
      quote: { regularMarketPrice: 62 }, expirationDates: expirations,
      options: [{ expirationDate: selected, calls: [], puts: [{
        contractSymbol: 'TQQQ' + iso + 'P00050000', strike: 50, lastPrice: 0.85,
        bid: 0.8, ask: 0.9, impliedVolatility: 0.4, volume: 50, openInterest: 500,
        lastTradeDate: Math.floor(Date.now() / 1000)
      }] }]
    }] } };
  };
  window.fetch = (input, init) => {
    const raw = typeof input === 'string' ? input : input.url;
    const url = new URL(raw, location.origin);
    if (!url.pathname.startsWith('/api/')) return nativeFetch(input, init);
    window.__focusedUxRequests.push(url.pathname + url.search);
    if (url.pathname === '/api/options') return json(optionPayload(Number(url.searchParams.get('date')) || null));
    if (url.pathname === '/api/price') return json({ price: 62, change: 1, changePct: 1.64, fiveDay: 2, oneMonth: 4, threeMonth: 8, fiftyTwoWeekHighPct: -5, previousClose: 61, sparkline: [60, 61, 62] });
    if (url.pathname === '/api/ivrank') return json({ currentIV: 0.4, ivRank: 50, ivPercentile: 55 });
    if (url.pathname === '/api/prices') {
      const tickers = (url.searchParams.get('tickers') || 'TQQQ').split(',');
      return json(Object.fromEntries(tickers.map(ticker => [ticker, { price: 62, change: 1, changePct: 1.64, fiveDay: 2, oneMonth: 4, threeMonth: 8, fiftyTwoWeekHighPct: -5, high52w: 70, low52w: 30 }] )));
    }
    if (url.pathname === '/api/fund-metadata') return json({});
    return json({});
  };
})();`;

await mkdir(outputDirectory, { recursive: true });
const profileDirectory = await mkdtemp(path.join(os.tmpdir(), 'put-scanner-focused-ux-chrome-'));
const chrome = spawn(chromePath, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-background-networking',
  '--disable-component-update', '--disable-crash-reporter', '--disable-default-apps', '--disable-sync',
  '--metrics-recording-only', '--no-first-run', '--remote-debugging-port=0',
  `--user-data-dir=${profileDirectory}`, 'about:blank',
], { stdio: 'ignore', windowsHide: true });

try {
  const activePort = await waitForFile(path.join(profileDirectory, 'DevToolsActivePort'));
  const [port] = activePort.trim().split(/\r?\n/);
  const targets = await waitForJson(`http://127.0.0.1:${port}/json`);
  const page = targets.find(target => target.type === 'page');
  if (!page) throw new Error('Chrome did not expose a page target.');
  const client = createCdpClient(page.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Page.addScriptToEvaluateOnNewDocument', { source: injectedFixture });

  await setViewport(client, 1440, 900, false);
  await navigate(client, `${baseUrl}/?q=TQQQ&expiry=${requestedIso}`);
  await waitFor(client, `Boolean(document.querySelector('a[aria-label="Open TQQQ options"]'))`, 'Scanner TQQQ link');
  const scanner = await evaluate(client, `(() => {
    const link = document.querySelector('a[aria-label="Open TQQQ options"]');
    const before = window.__focusedUxRequests.filter(value => value.startsWith('/api/options')).length;
    link.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const after = window.__focusedUxRequests.filter(value => value.startsWith('/api/options')).length;
    return { href: link.getAttribute('href'), before, after };
  })()`);
  if (scanner.href !== `/options/TQQQ?expiry=${requestedIso}` || scanner.before !== 0 || scanner.after !== 0) {
    throw new Error(`Scanner expiry/request regression: ${JSON.stringify(scanner)}`);
  }
  await evaluate(client, `document.querySelector('a[aria-label="Open TQQQ options"]').click()`);
  await waitFor(client, `location.pathname === '/options/TQQQ' && document.body.innerText.includes('Pre-selected from Scanner') && Boolean([...document.querySelectorAll('button')].find(button => /May 21.*DTE/.test(button.textContent ?? '')))`, 'requested TQQQ expiry');
  const exact = await evaluate(client, `(() => ({
    url: location.pathname + location.search,
    selected: [...document.querySelectorAll('button')].find(button => /May 21.*DTE/.test(button.textContent ?? ''))?.textContent,
    optionRequests: window.__focusedUxRequests.filter(value => value.startsWith('/api/options')),
  }))()`);
  if (!exact.selected?.includes('May') || exact.optionRequests.length !== 1 || !exact.optionRequests[0].includes(`date=${requestedTimestamp}`)) {
    throw new Error(`Exact expiry selection/request regression: ${JSON.stringify(exact)}`);
  }
  const optionsScreenshot = await screenshot(client, 'scanner-requested-expiry-1440x900');

  await client.send('Page.reload');
  await waitFor(client, `document.readyState !== 'loading' && document.body.innerText.includes('Pre-selected from Scanner') && Boolean([...document.querySelectorAll('button')].find(button => /May 21.*DTE/.test(button.textContent ?? '')))`, 'refreshed requested expiry');
  const refreshed = await evaluate(client, `[...document.querySelectorAll('button')].find(button => /May 21.*DTE/.test(button.textContent ?? ''))?.textContent`);
  if (!refreshed?.includes('May')) throw new Error(`Refresh did not preserve requested expiry: ${refreshed}`);

  await navigate(client, `${baseUrl}/?q=TQQQ&expiry=lte_30dte`);
  await waitFor(client, `Boolean(document.querySelector('a[aria-label="Open TQQQ options"]'))`, 'short-dated Scanner link');
  const bucketHref = await evaluate(client, `document.querySelector('a[aria-label="Open TQQQ options"]')?.getAttribute('href')`);
  if (bucketHref !== '/options/TQQQ') throw new Error(`Short-dated bucket leaked an expiry: ${bucketHref}`);

  const portfolioResults = [];
  for (const viewport of [
    { label: 'desktop-1440x900', width: 1440, height: 900, mobile: false },
    { label: 'ipad-768x1024', width: 768, height: 1024, mobile: true },
    { label: 'iphone-390x844', width: 390, height: 844, mobile: true },
    { label: 'landscape-844x390', width: 844, height: 390, mobile: true },
  ]) {
    await setViewport(client, viewport.width, viewport.height, viewport.mobile);
    await navigate(client, `${baseUrl}/portfolio`);
    await waitFor(client, `Boolean(document.querySelector('button[aria-controls="portfolio-analytics-content"]'))`, `${viewport.label} analytics toggle`);
    const before = await evaluate(client, `(() => {
      const button = document.querySelector('button[aria-controls="portfolio-analytics-content"]');
      const content = document.querySelector('#portfolio-analytics-content');
      const schedule = [...document.querySelectorAll('h2')].find(item => item.textContent?.includes('Schedule of Positions')) ?? [...document.querySelectorAll('h2')].find(item => item.textContent?.includes('Open Positions'));
      return { expanded: button?.getAttribute('aria-expanded'), content: content?.textContent?.trim(), scheduleTop: schedule?.getBoundingClientRect().top, writes: [...window.__focusedUxDurableWrites] };
    })()`);
    await evaluate(client, `document.querySelector('button[aria-controls="portfolio-analytics-content"]')?.click()`);
    await delay(100);
    const expanded = await evaluate(client, `(() => {
      const button = document.querySelector('button[aria-controls="portfolio-analytics-content"]');
      const content = document.querySelector('#portfolio-analytics-content');
      const schedule = [...document.querySelectorAll('h2')].find(item => item.textContent?.includes('Schedule of Positions')) ?? [...document.querySelectorAll('h2')].find(item => item.textContent?.includes('Open Positions'));
      const headers = [...document.querySelectorAll('table thead tr')].at(-1)?.children.length ?? null;
      const rowCells = document.querySelector('table tr[data-trade-id]')?.children.length ?? null;
      return { expanded: button?.getAttribute('aria-expanded'), content: content?.textContent?.trim(), scheduleTop: schedule?.getBoundingClientRect().top, buttonRect: button ? { width: button.getBoundingClientRect().width, height: button.getBoundingClientRect().height } : null, headers, rowCells, hasRiskHeader: [...document.querySelectorAll('th')].some(item => item.textContent?.includes('Net Capital at Risk')), pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, writes: [...window.__focusedUxDurableWrites] };
    })()`);
    const image = await screenshot(client, `portfolio-analytics-${viewport.label}`);
    await evaluate(client, `document.querySelector('button[aria-controls="portfolio-analytics-content"]')?.click()`);
    await delay(100);
    const collapsedAgain = await evaluate(client, `(() => {
      const content = document.querySelector('#portfolio-analytics-content');
      const schedule = [...document.querySelectorAll('h2')].find(item => item.textContent?.includes('Schedule of Positions')) ?? [...document.querySelectorAll('h2')].find(item => item.textContent?.includes('Open Positions'));
      return { content: content?.textContent?.trim(), scheduleTop: schedule?.getBoundingClientRect().top, writes: [...window.__focusedUxDurableWrites] };
    })()`);
    const isPhoneLayout = viewport.width <= 430 || (viewport.height <= 520 && viewport.width <= 950);
    if (before.expanded !== 'false' || before.content || expanded.expanded !== 'true' || !expanded.content || collapsedAgain.content) throw new Error(`${viewport.label}: analytics toggle state failed`);
    if (!isPhoneLayout && !(expanded.scheduleTop > before.scheduleTop && Math.abs(collapsedAgain.scheduleTop - before.scheduleTop) <= 2)) throw new Error(`${viewport.label}: desktop/tablet space was not reclaimed`);
    if (isPhoneLayout && (expanded.buttonRect?.height ?? 0) < 44) throw new Error(`${viewport.label}: analytics target is under 44px`);
    if (expanded.pageOverflow || expanded.hasRiskHeader || (expanded.headers != null && expanded.rowCells != null && expanded.headers !== expanded.rowCells)) throw new Error(`${viewport.label}: schedule layout regression`);
    if (before.writes.length || expanded.writes.length || collapsedAgain.writes.length) throw new Error(`${viewport.label}: analytics toggle wrote durable storage`);
    portfolioResults.push({ viewport, before, expanded, collapsedAgain, screenshot: image });
  }

  client.close();
  console.log(JSON.stringify({ scanner, exact, refreshed, bucketHref, optionsScreenshot, portfolioResults }, null, 2));
} finally {
  chrome.kill();
  await Promise.race([once(chrome, 'exit'), delay(2_000)]);
  await rm(profileDirectory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
}
