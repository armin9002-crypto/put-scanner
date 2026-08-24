import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const baseUrl = process.argv[2] || 'http://127.0.0.1:4173/watchlist';
const label = process.argv[3] || 'account';
const outputMode = process.argv[4] || 'detailed';
const keyboardMode = outputMode === 'keyboard';
const outputDirectory = path.join(os.tmpdir(), 'put-scanner-stage5d1-screenshots');
const viewports = keyboardMode ? [{ width: 390, height: 500 }] : [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 375, height: 667 },
  { width: 844, height: 390 },
  { width: 667, height: 375 },
];

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
    close() {
      socket.close();
    },
  };
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed.');
  return result.result.value;
}

async function waitForAccountSurface(client) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await evaluate(client, `Boolean(document.querySelector('[role="dialog"], button[aria-label="Account"], button[aria-label^="Account:"], button[aria-label^="Sign in to Put Scanner"]'))`);
    if (ready) return;
    await delay(50);
  }
  throw new Error('Account surface did not render.');
}

await mkdir(outputDirectory, { recursive: true });
const profileDirectory = await mkdtemp(path.join(os.tmpdir(), 'put-scanner-stage5d1-chrome-'));
const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-background-networking',
  '--disable-component-update',
  '--disable-crash-reporter',
  '--disable-default-apps',
  '--disable-sync',
  '--metrics-recording-only',
  '--no-first-run',
  '--remote-debugging-port=0',
  `--user-data-dir=${profileDirectory}`,
  'about:blank',
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

  const results = [];
  for (const viewport of viewports) {
    await client.send('Emulation.setDeviceMetricsOverride', {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      mobile: true,
      screenWidth: viewport.width,
      screenHeight: viewport.height,
    });
    await client.send('Page.navigate', { url: baseUrl });
    await delay(900);
    await waitForAccountSurface(client);
    await evaluate(client, `if (!document.querySelector('[role="dialog"]')) document.querySelector('button[aria-label="Account"], button[aria-label^="Account:"], button[aria-label^="Sign in to Put Scanner"]')?.click()`);
    await delay(500);
    if (keyboardMode) {
      await evaluate(client, `document.querySelector('input[type="email"]')?.focus()`);
      await delay(100);
    }
    if (new URL(baseUrl).searchParams.get('account-ui-fixture') === 'restore') {
      await evaluate(client, `document.querySelector('[aria-label="Account Data"]')?.scrollIntoView({ block: 'start' })`);
      await delay(150);
    }

    const metrics = await evaluate(client, `(() => {
      const rect = element => element ? Object.fromEntries(['x','y','width','height','top','right','bottom','left'].map(key => [key, Math.round(element.getBoundingClientRect()[key])])) : null;
      const dialog = document.querySelector('[role="dialog"]');
      const header = document.querySelector('.mobile-page-header');
      const nav = document.querySelector('.mobile-bottom-nav');
      const layer = document.querySelector('.mobile-sheet-layer, .mobile-account-sheet-layer');
      const content = document.querySelector('.mobile-account-sheet__content');
      const close = document.querySelector('.mobile-account-sheet__header button[aria-label="Close Account"]');
      const sync = document.querySelector('[aria-label="Account Sync"]');
      const accountData = document.querySelector('[aria-label="Account Data"]');
      const signOut = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === 'Sign Out');
      const emailInput = document.querySelector('input[type="email"]');
      const signInButton = [...document.querySelectorAll('button')].find(button => button.textContent?.includes('Send Sign-In Link'));
      const parent = layer?.parentElement;
      return {
        viewport: { width: innerWidth, height: innerHeight },
        trigger: rect(document.querySelector('button[aria-label="Account"], button[aria-label^="Account:"], button[aria-label^="Sign in to Put Scanner"]')),
        dialog: rect(dialog),
        layer: rect(layer),
        header: rect(header),
        nav: rect(nav),
        layerParent: parent ? { tag: parent.tagName, className: parent.className } : null,
        close: rect(close),
        accountSync: rect(sync),
        accountData: rect(accountData),
        signOut: rect(signOut),
        emailInput: rect(emailInput),
        signInButton: rect(signInButton),
        contentScroll: content ? { clientHeight: content.clientHeight, scrollHeight: content.scrollHeight, scrollTop: content.scrollTop, horizontalOverflow: content.scrollWidth > content.clientWidth + 1 } : null,
        layerZIndex: layer ? getComputedStyle(layer).zIndex : null,
        headerZIndex: header ? getComputedStyle(header).zIndex : null,
        headerBackdropFilter: header ? getComputedStyle(header).backdropFilter : null,
        navZIndex: nav ? getComputedStyle(nav).zIndex : null,
        dialogTopVisible: dialog ? dialog.getBoundingClientRect().top >= 0 : false,
        closeVisible: close ? close.getBoundingClientRect().top >= 0 && close.getBoundingClientRect().bottom <= innerHeight : false,
        emailFormVisible: emailInput && signInButton ? emailInput.getBoundingClientRect().top >= 0 && signInButton.getBoundingClientRect().bottom <= innerHeight : null,
        pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        dialogText: dialog?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 240) ?? null,
      };
    })()`);

    const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const fileName = `${label}-${viewport.width}x${viewport.height}.png`;
    const filePath = path.join(outputDirectory, fileName);
    await writeFile(filePath, Buffer.from(screenshot.data, 'base64'));
    results.push({ ...metrics, screenshot: filePath });

    await evaluate(client, `document.querySelector('[aria-label^="Close account"], [aria-label^="Close Account"], [aria-label^="Close Put Scanner Account"]')?.click()`);
    await delay(100);
  }

  const fixtureState = new URL(baseUrl).searchParams.get('account-ui-fixture');
  const fixtureNeedsSignedInSections = fixtureState && fixtureState !== 'signed-out';
  const failures = [];
  for (const result of results) {
    const key = `${result.viewport.width}x${result.viewport.height}`;
    if (result.layerParent?.tag !== 'BODY') failures.push(`${key}: overlay is not portaled to BODY`);
    if (!result.dialogTopVisible || result.dialog.bottom > result.viewport.height) failures.push(`${key}: dialog is outside the dynamic viewport`);
    if (!result.closeVisible || result.close?.width < 44 || result.close?.height < 44) failures.push(`${key}: close target is not fully visible and 44px`);
    if (result.pageOverflow || result.contentScroll?.horizontalOverflow) failures.push(`${key}: horizontal overflow detected`);
    if (Number(result.layerZIndex) <= Number(result.navZIndex || 0)) failures.push(`${key}: overlay does not outrank mobile navigation`);
    if (result.trigger && (result.trigger.width < 44 || result.trigger.height < 44)) failures.push(`${key}: Account trigger is smaller than 44px`);
    if (fixtureNeedsSignedInSections && (!result.accountSync || !result.accountData || !result.signOut)) failures.push(`${key}: signed-in Account sections are not reachable`);
    if (keyboardMode && !result.emailFormVisible) failures.push(`${key}: email form is not visible in the reduced dynamic viewport`);
  }
  if (failures.length > 0) throw new Error(`Mobile Account visual checks failed:\n${failures.join('\n')}`);

  client.close();
  const output = outputMode === 'summary'
    ? results.map(result => ({
        viewport: result.viewport,
        dialog: result.dialog,
        layerParent: result.layerParent,
        closeVisible: result.closeVisible,
        sections: {
          accountSync: Boolean(result.accountSync),
          accountData: Boolean(result.accountData),
          signOut: Boolean(result.signOut),
        },
        contentScroll: result.contentScroll,
        layerZIndex: result.layerZIndex,
        navZIndex: result.navZIndex,
        pageOverflow: result.pageOverflow,
        screenshot: result.screenshot,
      }))
    : results;
  console.log(JSON.stringify(output, null, 2));
} finally {
  chrome.kill();
  await Promise.race([once(chrome, 'exit'), delay(2_000)]);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(profileDirectory, { recursive: true, force: true, maxRetries: 2, retryDelay: 100 });
      break;
    } catch (error) {
      if (attempt === 9) throw error;
      await delay(200);
    }
  }
}
