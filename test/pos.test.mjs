import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import frontend from '../src/frontend.mjs';

const base = process.env.POS_TEST_URL || 'http://127.0.0.1:8798';
const pos = '/shops/demo/pos';
const setupKey = process.env.POS_TEST_SETUP_KEY;
assert.ok(setupKey, 'Set POS_TEST_SETUP_KEY and point POS_TEST_URL to an empty local test database.');
assert.match(base, /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/, 'Use a local test database only.');

async function request(path, { body, cookie, method = body ? 'POST' : 'GET', origin = base } = {}) {
  const response = await fetch(base + pos + '/api' + path, {
    method,
    headers: {
      ...(body ? { Origin: origin, 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}

function status(result, expected) {
  assert.equal(result.status, expected, JSON.stringify(result.data));
  return result.data;
}

test('cash, PromptPay, inventory, receipt, reports, permissions, shop profile, retries and reversals', async () => {
  const shopPage = base + '/shops/demo/';
  assert.equal((await fetch(base + pos + '/')).status, 200);
  assert.match(await (await fetch(base)).text(), /href="\/shops\/demo\/"/);
  assert.equal((await fetch(shopPage)).status, 404);
  const init = { key: setupKey, username: 'owner', name: 'Owner', shop: 'ครัวตัวอย่าง', password: 'integration-test-owner' };
  assert.equal(status(await request('/session'), 200).initialized, false);
  status(await request('/setup', { body: { ...init, key: 'wrong' } }), 403);
  status(await request('/setup', { body: init }), 201);
  status(await request('/setup', { body: init }), 409);
  const ownerLogin = await request('/login', { body: init });
  status(ownerLogin, 200);
  const owner = ownerLogin.cookie;
  const staff = { username: 'cashier', name: 'Cashier', password: 'integration-test-cashier' };
  const staffId = status(await request('/staff', { cookie: owner, body: staff }), 201).id;
  const staffLogin = await request('/login', { body: staff });
  status(staffLogin, 200);
  const cashier = staffLogin.cookie;
  status(await request('/staff', { cookie: cashier }), 403);
  status(await request('/categories', { cookie: owner, body: { name: 'Foreign origin' }, origin: 'https://example.org' }), 403);

  const product = { name: 'ข้าวผัด', sku: 'FOOD-01', barcode: '10001', category_id: 1, unit: 'จาน', price: 5500, low_stock: 2 };
  status(await request('/products', { cookie: cashier, body: product }), 403);
  const id = status(await request('/products', { cookie: owner, body: product }), 201).id;
  const secondId = status(await request('/products', {
    cookie: owner, body: { ...product, name: 'เค้ก', sku: 'CAKE-01', barcode: '10002', category_id: 2, price: 3500 }
  }), 201).id;
  const adjustment = { request_id: randomUUID(), quantity: 1, reason: 'รับเข้า' };
  status(await request('/products/' + id + '/stock', { cookie: owner, body: adjustment }), 201);
  status(await request('/products/' + id + '/stock', { cookie: owner, body: adjustment }), 200);
  status(await request('/products/' + secondId + '/stock', { cookie: owner, body: { ...adjustment, request_id: randomUUID() } }), 201);
  status(await request('/products/' + id + '/stock', {
    cookie: owner, body: { ...adjustment, request_id: randomUUID(), quantity: -2 }
  }), 409);

  const cash = { request_id: randomUUID(), method: 'cash', paid: 10000, items: [{ id, price: 5500, quantity: 1 }] };
  status(await request('/sales', { cookie: cashier, body: { ...cash, paid: 1 } }), 400);
  status(await request('/sales', { cookie: cashier, body: { ...cash, items: [{ id, price: 1, quantity: 1 }] } }), 409);
  const submissions = [cash, { ...cash, request_id: randomUUID() }];
  const contested = await Promise.all(submissions.map(body =>
    request('/sales', { cookie: cashier, body })));
  assert.deepEqual(contested.map(r => r.status).sort(), [201, 409]);
  const winner = contested.findIndex(r => r.status === 201);
  const sale = contested[winner].data;
  const replay = status(await request('/sales', { cookie: cashier, body: submissions[winner] }), 200);
  assert.equal(replay.id, sale.id);
  assert.equal(sale.total, 5500);
  assert.equal(sale.paid - sale.total, 4500);
  assert.equal(sale.shop.name, init.shop);
  assert.equal(sale.items[0].name, product.name);

  const cartWithUnavailableLine = { request_id: randomUUID(), method: 'cash', paid: 10000,
    items: [{ id: secondId, price: 3500, quantity: 1 }, { id, price: 5500, quantity: 1 }] };
  status(await request('/sales', { cookie: cashier, body: cartWithUnavailableLine }), 409);
  const available = status(await request('/catalog', { cookie: cashier }), 200).products;
  assert.equal(available.find(p => p.id === id).stock, 0);
  assert.equal(available.find(p => p.id === secondId).stock, 1);

  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==';
  const profile = { name: 'ครัวชื่อใหม่', tagline: 'ทำสดทุกวัน', address: 'กรุงเทพ', phone: '020000000',
    email: 'shop@example.com', line_id: '@shop', receipt_footer: 'ขอบคุณค่ะ', logo: png };
  status(await request('/profile', { cookie: cashier, method: 'PUT', body: profile }), 403);
  status(await request('/profile', { cookie: owner, method: 'PUT', body: { ...profile, logo: 'aW52YWxpZA==' } }), 400);
  assert.equal(status(await request('/catalog', { cookie: owner }), 200).settings.name, init.shop);
  status(await request('/profile', { cookie: owner, method: 'PUT', body: profile }), 200);
  status(await request('/settings', { cookie: owner, method: 'PUT', body: { paper: 58, promptpay: '' } }), 200);
  const savedProfile = status(await request('/catalog', { cookie: cashier }), 200).settings;
  assert.equal(savedProfile.name, profile.name);
  assert.equal(savedProfile.line_id, profile.line_id);
  assert.equal(savedProfile.paper, 58);
  const logoPath = '/profile/logos/' + savedProfile.logo_id;
  status(await request(logoPath), 401);
  const logo = await fetch(base + pos + '/api' + logoPath, { headers: { Cookie: cashier } });
  assert.equal(logo.headers.get('Content-Type'), 'image/png');
  assert.deepEqual(Buffer.from(await logo.arrayBuffer()), Buffer.from(png, 'base64'));

  assert.equal((await fetch(shopPage + 'logo')).status, 404);
  status(await request('/profile', { cookie: owner, method: 'PUT',
    body: { ...profile, name: '<ร้าน>', published: true, theme: 'ocean', photo: png,
      description: '<รายละเอียด>', hours: 'วันจันทร์ 09.00', website: 'https://example.com/shop' } }), 200);
  const publicPage = await fetch(shopPage);
  assert.equal(publicPage.status, 200);
  const html = await publicPage.text();
  assert.match(html, /&lt;ร้าน&gt;/);
  assert.match(html, /class="profile ocean"/);
  assert.match(html, /shop@example\.com/);
  assert.match(html, /&lt;รายละเอียด&gt;/);
  assert.match(html, /วันจันทร์ 09.00/);
  assert.match(html, /href="https:\/\/example\.com\/shop"/);
  assert.match(html, /src="\/shops\/demo\/photo"/);
  assert.equal((await fetch(shopPage + 'photo')).headers.get('Content-Type'), 'image/png');
  status(await request('/profile', { cookie: owner, method: 'PUT',
    body: { ...profile, website: 'javascript:alert(1)' } }), 400);
  assert.doesNotMatch(html, /ขอบคุณค่ะ/);
  assert.equal((await fetch(shopPage + 'logo')).headers.get('Content-Type'), 'image/png');
  status(await request('/profile', { cookie: owner, method: 'PUT', body: { ...profile, published: false } }), 200);
  assert.equal((await fetch(shopPage)).status, 404);
  assert.equal((await fetch(shopPage + 'logo')).status, 404);
  assert.equal((await fetch(shopPage + 'photo')).status, 404);

  const promptpay = { request_id: randomUUID(), method: 'promptpay', confirmed: false,
    reference: 'TX-001', items: [{ id: secondId, price: 3500, quantity: 1 }] };
  status(await request('/sales', { cookie: cashier, body: promptpay }), 400);
  const transfer = status(await request('/sales', { cookie: cashier, body: { ...promptpay, confirmed: true } }), 201);
  assert.equal(transfer.payment_reference, 'TX-001');
  assert.equal(transfer.shop.name, profile.name);
  assert.equal(transfer.shop.receipt_footer, profile.receipt_footer);
  assert.equal(transfer.shop.logo_id, savedProfile.logo_id);
  status(await request('/profile', { cookie: owner, method: 'PUT', body: { ...profile, name: 'ครัวล่าสุด', logo: null } }), 200);
  assert.equal(status(await request('/catalog', { cookie: owner }), 200).settings.logo_id, null);
  assert.equal(status(await request('/sales/' + sale.id, { cookie: owner }), 200).shop.name, init.shop);
  assert.equal(status(await request('/sales/' + transfer.id, { cookie: owner }), 200).shop.logo_id, savedProfile.logo_id);
  assert.equal((await fetch(base + pos + '/api' + logoPath, { headers: { Cookie: owner } })).status, 200);
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Bangkok', dateStyle: 'short' }).format(new Date(sale.created));
  const report = '/sales?date=' + date;
  assert.equal(status(await request(report, { cookie: owner }), 200).summary.total, 9000);

  const voidPath = '/sales/' + sale.id + '/void';
  const body = { reason: 'ลูกค้าขอยกเลิก' };
  status(await request(voidPath, { cookie: cashier, body }), 403);
  assert.equal(status(await request(voidPath, { cookie: owner, body }), 200).status, 'void');
  status(await request(voidPath, { cookie: owner, body }), 200);
  const ledger = status(await request('/products/' + id + '/stock', { cookie: owner }), 200);
  assert.deepEqual(ledger.map(x => x.quantity), [1, -1, 1]);
  const summary = status(await request(report, { cookie: owner }), 200).summary;
  assert.deepEqual(summary, { bills: 1, voids: 1, total: 3500, cash: 0, promptpay: 3500 });

  status(await request('/staff/' + staffId, { cookie: owner, method: 'PUT', body: { name: staff.name, active: false } }), 200);
  status(await request('/catalog', { cookie: cashier }), 401);
});

test('public SEO landing, canonical redirects, crawler files, and POS noindex', async () => {
  const landing = await fetch(base + '/about/?source=test');
  assert.equal(landing.status, 200);
  assert.equal(landing.headers.get('X-Robots-Tag'), null);
  const html = await landing.text();
  assert.ok(html.includes('<h1>โปรแกรมขายหน้าร้านภาษาไทย</h1>'));
  assert.ok(html.includes('<link rel="canonical" href="' + base + '/about/">'));
  assert.ok(html.includes('property="og:url" content="' + base + '/about/"'));
  assert.ok(html.includes('property="og:image" content="' + base + '/counter-pos-preview.png"'));
  assert.ok(html.includes('href="/">เลือกร้านในตลาด'));
  for (const path of ['/about', '/about/index.html']) {
    const redirect = await fetch(base + path + '?source=test', { redirect: 'manual' });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get('Location'), base + '/about/?source=test');
  }
  const sitemap = await fetch(base + '/sitemap.xml');
  assert.match(sitemap.headers.get('Content-Type'), /^application\/xml/);
  const locations = Array.from((await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/g), m => m[1]);
  assert.deepEqual(locations, [base + '/about/', base + '/']);
  const robots = await fetch(base + '/robots.txt');
  assert.ok((await robots.text()).includes('Sitemap: ' + base + '/sitemap.xml'));
  const root = await fetch(base + pos + '/');
  assert.equal(root.headers.get('X-Robots-Tag'), 'noindex');
  assert.ok((await root.text()).includes('<meta name="robots" content="noindex">'));
  const catalog = await fetch(base + pos + '/api/catalog');
  assert.equal(catalog.status, 401);
  assert.equal(catalog.headers.get('X-Robots-Tag'), 'noindex');
});

test('expired or paused shops cannot reach the POS or its backend', async () => {
  const env = {
    SHOP: { fetch() { assert.fail('inactive shop reached the backend'); } },
    SHOPS: {
      expired: { binding: 'SHOP', enabled: true, expiresAt: '2020-01-01T00:00:00Z' },
      paused: { binding: 'SHOP', enabled: false, expiresAt: '2099-01-01T00:00:00Z' }
    }
  };
  for (const slug of ['expired', 'paused']) {
    for (const suffix of ['/', '/logo', '/pos/', '/pos/api/catalog']) {
      assert.equal((await frontend.fetch(new Request(base + '/shops/' + slug + suffix), env)).status, 404);
    }
  }
  assert.doesNotMatch(await (await frontend.fetch(new Request(base), env)).text(), /\/shops\/(expired|paused)/);
});

test('tenant registration, separate admin session, shop assignment and access controls', async () => {
  const adminKey = process.env.MARKET_TEST_ADMIN_KEY;
  assert.ok(adminKey, 'Set MARKET_TEST_ADMIN_KEY to match the local MARKET_ADMIN_KEY secret.');
  const post = (path, values, cookie, origin = base) => fetch(base + path, {
    method: 'POST', redirect: 'manual',
    headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}) },
    body: new URLSearchParams(values)
  });
  const get = (path, cookie) => fetch(base + path, { headers: cookie ? { Cookie: cookie } : {} });
  const cookieOf = result => result.headers.get('Set-Cookie').split(';')[0];
  for (const path of ['/tenant/register/', '/tenant/', '/admin/']) {
    assert.equal((await get(path)).headers.get('Referrer-Policy'), 'same-origin');
  }
  const registration = { email: 'tenant@example.com', password: 'tenant-test-password',
    name: '<ผู้สมัคร>', shop_name: 'ร้านขนม', note: '<ข้อมูลร้าน>' };
  assert.equal((await post('/tenant/register/', registration, null, 'https://example.org')).status, 403);
  const registered = await post('/tenant/register/', registration);
  assert.equal(registered.status, 303);
  const tenant = cookieOf(registered);
  assert.equal((await post('/tenant/register/', registration)).status, 409);
  assert.match(await (await get('/tenant/', tenant)).text(), /&lt;ผู้สมัคร&gt;/);
  assert.match(await (await get('/tenant/', tenant)).text(), /รอตรวจสอบ/);
  assert.doesNotMatch(await (await get('/admin/', tenant)).text(), /tenant@example\.com/);
  assert.equal((await post('/admin/decision/', { id: 1, decision: 'approved', slug: 'demo' }, tenant)).status, 403);

  assert.equal((await post('/admin/login/', { password: 'wrong-key' })).status, 401);
  const loggedIn = await post('/admin/login/', { password: adminKey });
  assert.equal(loggedIn.status, 303);
  const admin = cookieOf(loggedIn);
  assert.match(admin, /^market_admin=/);
  assert.match(tenant, /^market_tenant=/);
  assert.doesNotMatch(await (await get('/tenant/', admin)).text(), /&lt;ผู้สมัคร&gt;/);
  const adminHtml = await (await get('/admin/', admin)).text();
  assert.match(adminHtml, /tenant@example\.com/);
  assert.match(adminHtml, /&lt;ข้อมูลร้าน&gt;/);
  assert.doesNotMatch(adminHtml, /tenant-test-password/);
  const applicationId = adminHtml.match(/name="id" value="(\d+)"/)?.[1];
  assert.ok(applicationId);
  assert.equal((await post('/admin/decision/', { id: applicationId, decision: 'approved', slug: 'missing' }, admin)).status, 400);
  const decision = { id: applicationId, decision: 'approved', slug: 'demo' };
  assert.equal((await post('/admin/decision/', decision, admin)).status, 303);
  assert.equal((await post('/admin/decision/', decision, admin)).status, 409);
  const tenantHtml = await (await get('/tenant/', tenant)).text();
  assert.match(tenantHtml, /อนุมัติแล้ว/);
  assert.match(tenantHtml, /href="\/shops\/demo\/pos\/"/);
  status(await request('/catalog', { cookie: tenant }), 401);
  status(await request('/catalog', { cookie: admin }), 401);
  assert.equal((await post('/tenant/logout/', {}, tenant)).status, 303);
  assert.doesNotMatch(await (await get('/tenant/', tenant)).text(), /&lt;ผู้สมัคร&gt;/);
  assert.equal((await post('/tenant/login/', { email: registration.email, password: registration.password })).status, 303);
});
