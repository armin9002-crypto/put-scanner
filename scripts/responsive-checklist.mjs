const viewports = [
  ['iPhone SE portrait', 375, 667],
  ['iPhone SE landscape', 667, 375],
  ['iPhone 14 portrait', 390, 844],
  ['iPhone 14 landscape', 844, 390],
  ['iPhone Pro Max portrait', 430, 932],
  ['iPhone Pro Max landscape', 932, 430],
  ['iPad portrait', 768, 1024],
  ['iPad landscape', 1024, 768],
  ['Desktop', 1440, 900],
];

const routes = [
  '/',
  '/options/TQQQ',
  '/options/HIBL',
  '/screener',
  '/watchlist',
  '/portfolio',
  '/pulse',
  '/cockpit',
];

console.log('Responsive / orientation QA matrix\n');
console.log('Viewports:');
for (const [label, width, height] of viewports) {
  console.log(`  - ${label}: ${width} x ${height}`);
}

console.log('\nRoutes:');
for (const route of routes) {
  console.log(`  - ${route}`);
}

console.log('\nBrowser setup:');
console.log("  localStorage.setItem('put_scanner_debug_layout', 'true')");
console.log("  localStorage.setItem('put_scanner_debug_network', 'true')");

console.log('\nConsole overflow snippet:');
console.log(`  (() => {
    const root = document.documentElement;
    const offenders = [...document.querySelectorAll('body *')]
      .filter(el => el.scrollWidth > el.clientWidth + 1)
      .slice(0, 20)
      .map(el => ({ tag: el.tagName, className: el.className, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    return {
      pageOverflow: root.scrollWidth > root.clientWidth + 1,
      rootScrollWidth: root.scrollWidth,
      rootClientWidth: root.clientWidth,
      offenders,
    };
  })()`);

console.log('\nPass criteria: no page-level horizontal overflow; sorting/resizing/hovering creates zero API calls; only explicit refresh/load/scan actions fetch.');
