// Opens every admin page logged in (fake Auth0 inside Playwright only), clicks through, screenshots, and
// fails on any page crash / console error. Needs: admin dev server on :5173 and qa-server on :8788.
// Usage: node qa/admin-pages.mjs <outdir>
import { createRequire } from 'node:module';
const { chromium } = createRequire('/opt/homebrew/lib/node_modules/')('playwright');

const OUT = process.argv[2] ?? '.';
const AUTH0 = 'https://dev-geomark.jp.auth0.com';
const CLIENT_ID = 'XBdoMKG3kteo2Z0ld3xxEpnjcF5Ndlnn';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
page.setDefaultTimeout(10_000); // fail fast: a page that hasn't rendered in 10 s is broken
const problems = [];
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !/Failed to load resource|ERR_|404/.test(m.text())) problems.push(`console: ${m.text()}`);
});

// --- fake Auth0 (only inside this Playwright browser) ---
let nonce = '';
await page.route(`${AUTH0}/authorize**`, (route) => {
  const u = new URL(route.request().url());
  nonce = u.searchParams.get('nonce');
  route.fulfill({ status: 302, headers: { location: `${u.searchParams.get('redirect_uri')}?code=qa&state=${encodeURIComponent(u.searchParams.get('state'))}` } });
});
await page.route(`${AUTH0}/oauth/token`, async (route) => {
  const t = await (await fetch('http://127.0.0.1:8788/__qa/token?sub=qa|admin&roles=admin')).json();
  const now = Math.floor(Date.now() / 1000);
  const idToken = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: `${AUTH0}/`, aud: CLIENT_ID, sub: 'qa|admin', name: t.name, email: t.email, nonce, iat: now, exp: now + 3600 })}.qa`;
  route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
    body: JSON.stringify({ access_token: t.access_token, id_token: idToken, refresh_token: 'qa', expires_in: 3600, token_type: 'Bearer', scope: 'openid profile email offline_access' }) });
});
// --- real API code, QA instance ---
await page.route('http://localhost:8787/**', (route) => route.continue({ url: route.request().url().replace('localhost:8787', '127.0.0.1:8788') }));
// R2 photo links point at fake keys in QA; serve a grey placeholder so thumbnails render.
await page.route('**/*.r2.cloudflarestorage.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml',
  body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400"><rect width="100%" height="100%" fill="#9fb2a8"/><circle cx="150" cy="150" r="60" fill="#e3f1ea"/><rect x="70" y="230" width="160" height="140" rx="70" fill="#e3f1ea"/></svg>' }));

// QA_NO_MAPPLS=1: block the Mappls SDK to prove the OpenStreetMap fallback works.
if (process.env.QA_NO_MAPPLS) await page.route('https://sdk.mappls.com/**', (route) => route.abort());

const shot = async (name) => {
  await page.waitForTimeout(900); // let tiles/fonts settle
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  console.log(`  📸 ${name}`);
};
const step = async (name, fn) => {
  const before = problems.length;
  try {
    await fn();
    console.log(`${problems.length === before ? '✅' : '❌'} ${name}${problems.length === before ? '' : `\n     ${problems.slice(before).join('\n     ')}`}`);
  } catch (e) {
    console.log(`❌ ${name}: ${e.message.split('\n')[0]}`);
    problems.push(`${name}: ${e.message}`);
    await page.screenshot({ path: `${OUT}/FAIL-${name.replace(/\W+/g, '-')}.png`, fullPage: true }).catch(() => {});
  }
};
const noCrash = async () => {
  if (await page.getByText('This page hit a problem').count()) throw new Error('PageGuard shown: page crashed');
};

await step('log in (fake Auth0)', async () => {
  await page.goto('http://localhost:5173/');
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 15000 });
});
await step('Dashboard', async () => {
  await page.getByText('of', { exact: false }).first().waitFor();
  await page.getByRole('cell', { name: /Asha Patil/ }).waitFor();
  await noCrash(); await shot('1-dashboard');
});
await step('Dashboard tiles filter + search', async () => {
  await page.getByRole('button', { name: /HR check/ }).first().click();
  await page.getByRole('cell', { name: /Meena Iyer/ }).waitFor();
  if (await page.getByRole('cell', { name: /Asha Patil/ }).count()) throw new Error('HR check tile did not filter');
  await page.getByRole('button', { name: /HR check/ }).first().click(); // toggle back
  await page.getByLabel('Search check-ins').fill('ravi');
  await page.getByRole('cell', { name: /Ravi Shah/ }).waitFor();
  if (await page.getByRole('cell', { name: /Asha Patil/ }).count()) throw new Error('search did not filter');
  await page.getByLabel('Search check-ins').fill('');
  await noCrash(); await shot('1b-dashboard-tiles');
});
await step('Dashboard → View panel steps with Next / ← → keys', async () => {
  await page.getByRole('row', { name: /Asha Patil/ }).getByRole('button', { name: 'View' }).click();
  await page.getByRole('dialog', { name: 'Check-in details' }).waitFor();
  const first = await page.getByRole('dialog').getByRole('heading', { level: 2 }).textContent();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(800);
  const second = await page.getByRole('dialog').getByRole('heading', { level: 2 }).textContent();
  if (first === second) throw new Error(`ArrowRight did not move (${first})`);
  await page.getByRole('button', { name: 'Previous check-in' }).click();
  await page.getByRole('dialog').getByRole('heading', { name: first }).waitFor();
  await page.getByRole('button', { name: 'Close details' }).click();
});
await step('Dashboard → one-click Approve on an HR-check row', async () => {
  await page.getByRole('row', { name: /Meena Iyer/ }).getByRole('button', { name: 'Approve' }).click();
  await page.getByRole('row', { name: /Meena Iyer/ }).getByText('Present').waitFor();
});
await step('Dashboard → View panel with map', async () => {
  await page.getByRole('row', { name: /Ravi Shah/ }).getByRole('button', { name: 'View' }).click();
  await page.getByRole('dialog', { name: 'Check-in details' }).waitFor();
  await page.locator('.map[data-map]').first().waitFor();
  // The selfie must actually be VISIBLE (this regressed once: rendered but squashed to 0 px tall).
  const selfieH = await page.evaluate(() => Math.round(document.querySelector('.panel .stamp')?.getBoundingClientRect().height ?? 0));
  if (selfieH < 200) throw new Error(`check-in selfie is only ${selfieH}px tall in the View panel`);
  await noCrash(); await shot('2-view-panel');
  await page.locator('.panel .map').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1200);
  await page.locator('.panel .map').screenshot({ path: `${OUT}/2c-checkin-map.png` });
  await page.getByRole('button', { name: 'Open the selfie full screen' }).click();
  await page.locator('.lightbox img').waitFor();
  await shot('2b-photo-full-screen');
  await page.keyboard.press('Escape');
  await page.locator('.lightbox').waitFor({ state: 'detached' });
  await page.getByRole('dialog', { name: 'Check-in details' }).waitFor(); // Esc closed only the viewer
  await page.getByRole('button', { name: 'Close details' }).click();
});
await step('Review', async () => {
  await page.getByRole('link', { name: /Review/ }).click();
  await page.getByRole('heading', { name: 'Review' }).waitFor();
  await page.getByText(/Nothing to review|Meena Iyer/).first().waitFor(); // Meena was approved above
  await noCrash(); await shot('3-review');
});
await step('Employees', async () => {
  await page.getByRole('link', { name: 'Employees' }).click();
  await page.getByRole('heading', { name: 'Employees' }).waitFor();
  await page.getByText('Imran Khan').waitFor();
  await noCrash(); await shot('4-employees');
});
await step('Employees → filter, select two, bulk-add a place', async () => {
  await page.getByLabel('Filter by designation').selectOption('Field sales');
  await page.getByRole('link', { name: 'Imran Khan' }).waitFor();
  if (await page.getByRole('link', { name: 'Ravi Shah' }).count()) throw new Error('designation filter did not filter');
  await page.getByLabel('Select everyone shown').check();
  await page.getByLabel('Place for selected people').selectOption({ label: 'Andheri branch' });
  await page.getByRole('button', { name: 'Add place' }).click();
  await page.getByText(/Andheri branch added for 2 people/).waitFor();
  await page.getByLabel('Filter by designation').selectOption('');
  await noCrash(); await shot('4b-employees-bulk');
});
await step('Employees → CSV import preview (never creates logins in QA)', async () => {
  await page.getByRole('button', { name: /Import CSV/ }).click();
  await page.getByRole('dialog', { name: 'Import employees' }).waitFor();
  const csv = 'name,email,designation,places\n"Patil, Kiran",kiran@qa.local,Driver,"Dahanukarwadi, Kandivali (W)"\nNo Email,,Driver,\nAsha Again,asha@qa.local,,\nPooja,pooja@qa.local,,Mars office\n';
  await page.locator('input[type=file]').setInputFiles({ name: 'people.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.getByText(/4.*rows.*1.*ready.*3.*with problems/).waitFor();
  await page.getByText('already an employee').waitFor();
  await page.getByText(/unknown place: Mars office/).waitFor();
  await noCrash(); await shot('5b-import-preview');
  await page.getByRole('button', { name: 'Close' }).click();
});
await step('Employees → Add employee panel', async () => {
  await page.getByRole('button', { name: 'Add employee' }).click();
  await page.getByRole('dialog', { name: 'Add employee' }).waitFor();
  await noCrash(); await shot('5-add-employee');
  await page.getByRole('button', { name: 'Close' }).click();
});
await step('Employee profile (Asha)', async () => {
  await page.getByRole('link', { name: 'Asha Patil' }).click();
  await page.getByRole('heading', { name: 'Asha Patil' }).waitFor();
  await page.getByRole('grid', { name: 'Month calendar' }).waitFor();
  await noCrash(); await shot('6-profile');
});
await step('Profile → click a calendar day opens the check-in', async () => {
  await page.locator('button.cal-day').first().click();
  await page.getByRole('dialog', { name: 'Check-in details' }).waitFor();
  await page.locator('.map[data-map]').first().waitFor();
  await page.getByRole('button', { name: 'Close details' }).click();
});
await step('Places', async () => {
  await page.getByRole('link', { name: 'Places' }).click();
  await page.getByRole('heading', { name: 'Places' }).waitFor();
  await page.locator('.map[data-map]').first().waitFor();
  console.log(`  🗺  map engine: ${await page.locator('.map[data-map]').first().getAttribute('data-map')}`);
  await page.waitForTimeout(1500); // let map tiles paint before the screenshot
  await noCrash(); await shot('7-places');
});
await step('Places → Edit place (map picker) + paste coordinates', async () => {
  await page.getByRole('row', { name: /Andheri branch/ }).getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('dialog', { name: 'Edit place' }).waitFor();
  await page.locator('.pick-pin').waitFor();
  await page.getByLabel(/Search address/).fill('19.1200, 72.8470');
  await page.getByLabel(/Search address/).press('Enter');
  await page.getByText('Pin placed from the coordinates.').waitFor();
  await page.getByText('Pin at 19.12000, 72.84700').waitFor();
  await noCrash(); await shot('8-edit-place');
  await page.getByRole('button', { name: 'Close' }).click();
});
await step('Register', async () => {
  await page.getByRole('link', { name: 'Register' }).click();
  await page.getByRole('heading', { name: 'Register' }).waitFor();
  await page.getByRole('rowheader', { name: /Ravi Shah/ }).waitFor();
  await noCrash(); await shot('9-register');
});
await step('Register → CSV download', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Download CSV/ }).click()]);
  const path = `${OUT}/export.csv`;
  await dl.saveAs(path);
  const { readFileSync } = await import('node:fs');
  const lines = readFileSync(path, 'utf8').split('\r\n');
  if (!lines[0].includes('"Date","Employee code","Name"') || lines.length < 20) throw new Error(`CSV looks wrong (${lines.length} lines)`);
  console.log(`  📄 CSV ${lines.length - 1} rows`);
});
await step('Settings', async () => {
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('heading', { name: 'Settings' }).waitFor();
  await page.getByText('Shift and late rule').waitFor();
  await page.getByRole('heading', { name: 'Holidays' }).waitFor();
  await page.getByText('Test Festival').waitFor();
  await noCrash(); await shot('10-settings');
});
await step('Settings → add a holiday + fixed national holidays', async () => {
  await page.getByLabel('Date').last().fill('2026-12-31');
  await page.getByLabel('Name').fill('Year end');
  await page.getByRole('button', { name: 'Add holiday' }).click();
  await page.getByText('Year end added').waitFor();
  await page.getByRole('button', { name: /Add fixed national holidays/ }).click();
  await page.getByText(/Added .*Christmas|already in the list/).waitFor();
  await page.getByRole('cell', { name: 'Christmas' }).waitFor();
  await noCrash(); await shot('11-holidays');
});
await step('Sidebar: collapse to icons and back', async () => {
  await page.goto('http://localhost:5173/#/');
  await page.getByRole('heading', { name: 'Today' }).waitFor({ timeout: 15000 });
  await page.screenshot({ path: `${OUT}/12-sidebar-open.png`, clip: { x: 0, y: 0, width: 300, height: 900 } });
  await page.getByRole('button', { name: 'Collapse menu' }).click();
  await page.getByRole('button', { name: 'Expand menu' }).waitFor();
  if (await page.locator('.brand-full').isVisible()) throw new Error('wordmark still visible when collapsed');
  await page.screenshot({ path: `${OUT}/13-sidebar-collapsed.png`, clip: { x: 0, y: 0, width: 300, height: 900 } });
  await page.getByRole('button', { name: 'Expand menu' }).click();
  await page.getByRole('button', { name: 'Collapse menu' }).waitFor();
  console.log('  📸 12-sidebar-open, 13-sidebar-collapsed');
});
await step('Deep link reload keeps the page (#/places)', async () => {
  await page.goto('http://localhost:5173/#/places');
  await page.getByRole('heading', { name: 'Places' }).waitFor({ timeout: 15000 });
});

await browser.close();
console.log(problems.length ? `\n${problems.length} problem(s) found` : '\nAll admin pages OK');
process.exitCode = problems.length ? 1 : 0;
