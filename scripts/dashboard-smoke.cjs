const { chromium } = require('../service-agent/node_modules/playwright');

const base = process.env.DASHBOARD_BASE_URL || 'http://127.0.0.1:5000';

async function main() {
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL || 'admin@carshineredsea.com',
      password: process.env.ADMIN_PASSWORD || 'ChangeMe123!'
    })
  });

  if (!login.ok) {
    throw new Error(`Login failed: ${login.status} ${await login.text()}`);
  }

  const { token } = await login.json();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  const badResponses = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      badResponses.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });

  await page.goto(`${base}/dashboard-v2`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((value) => localStorage.setItem('carshine_admin_token', value), token);
  await page.reload({ waitUntil: 'networkidle' });

  const navs = await page.$$eval('.nav-item[data-page]', (els) =>
    els.map((el) => ({
      page: el.dataset.page,
      text: el.textContent.trim().replace(/\s+/g, ' ')
    }))
  );

  const results = [];
  for (const nav of navs) {
    await page.click(`.nav-item[data-page="${nav.page}"]`);
    await page.waitForTimeout(350);
    const title = await page.$eval('#page-title', (el) => el.textContent.trim()).catch(() => 'NO_TITLE');
    const contentNodes = await page
      .$$eval('.card, .table-wrap, .empty, .metric, tbody tr, form, .board-card, .status-pill', (els) => els.length)
      .catch(() => 0);
    results.push({ ...nav, title, contentNodes });
  }

  console.log(JSON.stringify({ base, navCount: navs.length, results, errors, badResponses }, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
