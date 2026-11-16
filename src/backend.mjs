import { HttpError, requireThat, field, readText, rateLimit } from './request.mjs';
import { hex, digest, same, passwordHash } from './auth-crypto.mjs';

const HOUR = 3_600_000;
const LOGO_BYTES = 256 * 1024;
const REQUEST_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

function integer(value, min, max) {
  requireThat(Number.isSafeInteger(value) && value >= min && value <= max, 'จำนวนหรือยอดเงินไม่ถูกต้อง');
  return value;
}

function username(value) {
  const result = field(value, 32, 3).toLowerCase();
  requireThat(/^[a-z0-9_.-]+$/.test(result), 'ชื่อผู้ใช้ใช้ a-z, 0-9, จุด, ขีด หรือขีดล่าง');
  return result;
}

function validPassword(value) {
  requireThat(typeof value === 'string' && value.length >= 12 && value.length <= 128,
    'รหัสผ่านต้องมี 12–128 ตัวอักษร');
  return value;
}

async function jsonBody(request, limit = 24_000) {
  requireThat(request.headers.get('Content-Type')?.split(';')[0] === 'application/json', 'ต้องส่งข้อมูล JSON', 415);
  const value = await readText(request, limit);
  let data;
  try { data = JSON.parse(value); }
  catch { throw new HttpError(400, 'ข้อมูล JSON ไม่ถูกต้อง'); }
  requireThat(data && typeof data === 'object' && !Array.isArray(data));
  return data;
}

function response(data, status = 200, headers = {}) {
  return Response.json(data, {
    status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex', ...headers }
  });
}

function cookieName(url) {
  const slug = url.pathname.split('/')[2];
  return (url.protocol === 'https:' ? '__Host-' : '') + 'pos_session_' + slug;
}

function cookie(value, age, url) {
  const secure = url.protocol === 'https:';
  return `${cookieName(url)}=${value}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
}

async function authenticate(db, request, url) {
  const name = cookieName(url);
  const token = request.headers.get('Cookie')?.match(new RegExp('(?:^|; )' + name + '=([a-f0-9]{64})(?:;|$)'))?.[1];
  if (!token) return null;
  const session = await digest(token);
  return db.prepare(`
    SELECT u.id, u.name, u.username, u.role, s.token AS session FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires > ? AND u.active = 1
  `).bind(session, Date.now()).first();
}

async function login(db, body, request, url) {
  const handle = username(body.username);
  requireThat(typeof body.password === 'string' && body.password.length <= 128, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 401);
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  await rateLimit(db, 'ip:' + ip, 25);
  await rateLimit(db, 'pair:' + ip + ':' + handle, 8);
  const user = await db.prepare('SELECT * FROM users WHERE username = ?').bind(handle).first();
  const hash = await passwordHash(body.password, user?.password.split('.')[0] || '00000000000000000000000000000000');
  requireThat(same(hash, user?.password || '') && user.active === 1, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 401);
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires <= ?').bind(now),
    db.prepare('DELETE FROM login_attempts WHERE bucket < ?').bind(Math.floor(now / (15 * 60_000)) - 2),
    db.prepare('DELETE FROM login_attempts WHERE key = ?').bind('pair:' + ip + ':' + handle),
    db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').bind(await digest(token), user.id, now + 12 * HOUR)
  ]);
  return response({ ok: true }, 200, { 'Set-Cookie': cookie(token, 43_200, url) });
}

async function setup(env, body, request) {
  const db = env.DB;
  requireThat(!(await db.prepare("SELECT id FROM users WHERE role = 'owner'").first()), 'ร้านนี้ตั้งค่าแล้ว', 409);
  requireThat(typeof env.SETUP_KEY === 'string' && env.SETUP_KEY.length >= 24,
    'ผู้ติดตั้งต้องกำหนด SETUP_KEY ที่ยาวอย่างน้อย 24 ตัวอักษร', 503);
  await rateLimit(db, 'setup:' + (request.headers.get('CF-Connecting-IP') || 'local'), 10);
  requireThat(same(field(body.key, 256, 1), env.SETUP_KEY), 'รหัสตั้งค่าไม่ถูกต้อง', 403);
  const handle = username(body.username);
  const name = field(body.name, 80, 1);
  const shop = field(body.shop, 100, 1);
  const password = await passwordHash(validPassword(body.password));
  await db.batch([
    db.prepare("INSERT INTO users (username, name, password, role) VALUES (?, ?, ?, 'owner')").bind(handle, name, password),
    db.prepare('UPDATE settings SET name = ? WHERE id = 1').bind(shop)
  ]);
  return response({ ok: true }, 201);
}

async function catalog(db, owner) {
  const [products, categories, settings] = await db.batch([
    db.prepare('SELECT * FROM products' + (owner ? '' : ' WHERE active = 1') + ' ORDER BY name, id'),
    db.prepare('SELECT * FROM categories ORDER BY id'),
    db.prepare(`SELECT name, address, phone, promptpay, paper, logo_id, tagline, email, line_id, receipt_footer, published, theme, photo_id, description, hours, website
      FROM settings WHERE id = 1`)
  ]);
  return response({ products: products.results, categories: categories.results, settings: settings.results[0] });
}

async function saleDetails(db, id, user) {
  const sale = await db.prepare(`
    SELECT id, user_id, cashier, created, method, paid, total, payment_reference,
      status, void_reason, void_at, shop FROM sales WHERE id = ?
  `).bind(id).first();
  requireThat(sale && (user.role === 'owner' || user.id === sale.user_id), 'ไม่พบใบเสร็จ', 404);
  const lines = await db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY rowid').bind(id).all();
  return { ...sale, shop: JSON.parse(sale.shop), items: lines.results };
}

async function sell(db, body, user) {
  requireThat(typeof body.request_id === 'string' && REQUEST_ID.test(body.request_id));
  requireThat(Array.isArray(body.items) && body.items.length > 0 && body.items.length <= 80, 'เลือกสินค้า 1–80 รายการต่อบิล');
  const items = body.items.map(item => {
    requireThat(item && typeof item === 'object');
    return {
      id: integer(item.id, 1, Number.MAX_SAFE_INTEGER),
      price: integer(item.price, 0, 99_999_999),
      quantity: integer(item.quantity, 1, 9999)
    };
  });
  requireThat(new Set(items.map(item => item.id)).size === items.length, 'พบสินค้าซ้ำ');
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  requireThat(total <= 1_000_000_000, 'ยอดบิลเกิน 10 ล้านบาท');
  const method = body.method;
  requireThat(method === 'cash' || method === 'promptpay', 'กรุณาเลือกวิธีชำระเงิน');
  const paid = method === 'cash' ? integer(body.paid, total, 1_000_000_000) : total;
  requireThat(method === 'cash' || body.confirmed === true, 'กรุณายืนยันยอดโอน');
  const reference = method === 'promptpay' ? field(body.reference ?? '', 80) : '';
  const cart = JSON.stringify(items);
  const hash = await digest(JSON.stringify([items, method, paid, reference]));
  let inserted;
  try {
    inserted = await db.prepare(`
      INSERT INTO sales (request_id, request_hash, user_id, cashier, method, paid, total, payment_reference, cart, shop)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, json_object(
        'name', name, 'address', address, 'phone', phone, 'paper', paper,
        'logo_id', logo_id, 'email', email, 'line_id', line_id, 'receipt_footer', receipt_footer
      )
      FROM settings WHERE id = 1
      ON CONFLICT(request_id) DO NOTHING RETURNING id
    `).bind(body.request_id, hash, user.id, user.name, method, paid, total, reference, cart).first();
  } catch (error) {
    if (error.message.includes('CART_CHANGED')) {
      throw new HttpError(409, 'ราคา สถานะ หรือสต็อกสินค้าเปลี่ยน กรุณาตรวจตะกร้าใหม่');
    }
    throw error;
  }
  if (inserted) return response(await saleDetails(db, inserted.id, user), 201);
  const previous = await db.prepare('SELECT id, user_id, request_hash FROM sales WHERE request_id = ?').bind(body.request_id).first();
  requireThat(previous && previous.user_id === user.id && previous.request_hash === hash, 'รหัสรายการซ้ำ กรุณาตรวจสอบประวัติบิล', 409);
  return response(await saleDetails(db, previous.id, user));
}

function bounds(day) {
  requireThat(/^\d{4}-\d{2}-\d{2}$/.test(day || ''), 'กรุณาเลือกวันที่');
  const date = new Date(day + 'T00:00:00Z');
  requireThat(!Number.isNaN(+date) && date.toISOString().slice(0, 10) === day, 'วันที่ไม่ถูกต้อง');
  return [new Date(+date - 7 * HOUR).toISOString(), new Date(+date + 17 * HOUR).toISOString()];
}

async function salesList(db, params, user) {
  const [start, end] = bounds(params.get('date'));
  const before = params.has('before') ? integer(Number(params.get('before')), 1, Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
  const access = user.role === 'owner' ? '' : ' AND user_id = ?';
  const args = user.role === 'owner' ? [start, end] : [start, end, user.id];
  const filter = ' FROM sales WHERE created >= ? AND created < ?' + access;
  const [rows, summary] = await db.batch([
    db.prepare('SELECT id, cashier, created, method, total, status' + filter + ' AND id < ? ORDER BY id DESC LIMIT 51').bind(...args, before),
    db.prepare(`SELECT COUNT(CASE WHEN status = 'paid' THEN 1 END) AS bills,
      COUNT(CASE WHEN status = 'void' THEN 1 END) AS voids,
      COALESCE(SUM(CASE WHEN status = 'paid' THEN total END), 0) AS total,
      COALESCE(SUM(CASE WHEN status = 'paid' AND method = 'cash' THEN total END), 0) AS cash,
      COALESCE(SUM(CASE WHEN status = 'paid' AND method = 'promptpay' THEN total END), 0) AS promptpay` + filter).bind(...args)
  ]);
  const sales = rows.results.slice(0, 50);
  return response({ sales, summary: summary.results[0], next: rows.results.length > 50 ? sales.at(-1).id : null });
}

async function saveProduct(db, id, body) {
  const values = [
    integer(body.category_id, 1, Number.MAX_SAFE_INTEGER), field(body.name, 100, 1), field(body.sku, 48, 1),
    field(body.barcode ?? '', 64) || null, field(body.unit, 24, 1), integer(body.price, 0, 99_999_999),
    integer(body.low_stock, 0, 1_000_000_000), body.active === false ? 0 : 1
  ];
  const row = id
    ? await db.prepare(`UPDATE products SET category_id = ?, name = ?, sku = ?, barcode = ?,
        unit = ?, price = ?, low_stock = ?, active = ? WHERE id = ? RETURNING id`).bind(...values, id).first()
    : await db.prepare(`INSERT INTO products (category_id, name, sku, barcode, unit, price, low_stock, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`).bind(...values).first();
  requireThat(row, 'ไม่พบสินค้า', 404);
  return response(row, id ? 200 : 201);
}

async function storeImage(db, value, statements) {
  if (value === null || value === undefined) return null;
  requireThat(typeof value === 'string' && value.length <= 4 * Math.ceil(LOGO_BYTES / 3),
    'รูปภาพมีขนาดใหญ่เกิน 256 KB', 413);
  let bytes;
  try { bytes = Uint8Array.fromBase64(value, { lastChunkHandling: 'strict' }); }
  catch { throw new HttpError(400, 'ไฟล์รูปภาพไม่ถูกต้อง'); }
  requireThat(bytes.length <= LOGO_BYTES, 'รูปภาพมีขนาดใหญ่เกิน 256 KB', 413);
  requireThat(bytes.length >= 45, 'ไฟล์รูปภาพ PNG ไม่ถูกต้อง');
  const png = new DataView(bytes.buffer);
  requireThat(png.getUint32(0) === 0x89504e47 && png.getUint32(4) === 0x0d0a1a0a &&
    png.getUint32(8) === 13 && png.getUint32(12) === 0x49484452 &&
    png.getUint32(bytes.length - 12) === 0 && png.getUint32(bytes.length - 8) === 0x49454e44 &&
    png.getUint32(bytes.length - 4) === 0xae426082, 'ไฟล์รูปภาพ PNG ไม่ถูกต้อง');
  integer(png.getUint32(16), 1, 512);
  integer(png.getUint32(20), 1, 512);
  const id = hex(await crypto.subtle.digest('SHA-256', bytes));
  statements.push(db.prepare('INSERT INTO shop_logos (id, image) VALUES (?, ?) ON CONFLICT(id) DO NOTHING')
    .bind(id, bytes));
  return id;
}

async function saveProfile(db, body) {
  const name = field(body.name, 100, 1);
  const tagline = field(body.tagline, 100);
  const address = field(body.address, 300);
  const phone = field(body.phone, 40);
  const email = field(body.email, 120);
  requireThat(!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'รูปแบบอีเมลไม่ถูกต้อง');
  const line = field(body.line_id, 60);
  const footer = field(body.receipt_footer, 200);
  const published = body.published;
  const theme = body.theme;
  requireThat(published === undefined || typeof published === 'boolean');
  requireThat(theme === undefined || ['leaf', 'ocean', 'clay'].includes(theme));
  const description = body.description === undefined ? null : field(body.description, 800);
  const hours = body.hours === undefined ? null : field(body.hours, 140);
  const website = body.website === undefined ? null : field(body.website, 220);
  if (website) {
    let url;
    try { url = new URL(website); } catch { throw new HttpError(400, 'กรอกลิงก์เว็บไซต์ให้ถูกต้อง'); }
    requireThat(['https:', 'http:'].includes(url.protocol) && !url.username && !url.password,
      'ลิงก์เว็บไซต์ต้องขึ้นต้นด้วย https:// หรือ http://');
  }
  const statements = [];
  const logoId = await storeImage(db, body.logo, statements);
  const photoId = await storeImage(db, body.photo, statements);
  statements.push(db.prepare(`
    UPDATE settings SET name = ?, tagline = ?, address = ?, phone = ?, email = ?, line_id = ?,
      receipt_footer = ?, logo_id = CASE WHEN ? THEN ? ELSE logo_id END,
      published = COALESCE(?, published), theme = COALESCE(?, theme),
      photo_id = CASE WHEN ? THEN ? ELSE photo_id END,
      description = COALESCE(?, description), hours = COALESCE(?, hours), website = COALESCE(?, website)
    WHERE id = 1
  `).bind(name, tagline, address, phone, email, line, footer, body.logo === undefined ? 0 : 1, logoId,
    published === undefined ? null : Number(published), theme ?? null,
    body.photo === undefined ? 0 : 1, photoId, description, hours, website));
  await db.batch(statements);
  return response({ ok: true });
}

async function adminRoute(db, method, path, body, user) {
  if (method === 'POST' && path === '/api/categories') {
    return response(await db.prepare('INSERT INTO categories (name) VALUES (?) RETURNING id')
      .bind(field(body.name, 64, 1)).first(), 201);
  }
  if (method === 'POST' && path === '/api/products') return saveProduct(db, null, body);
  const product = path.match(/^\/api\/products\/(\d+)(\/stock)?$/);
  if (product && !product[2] && method === 'PUT') return saveProduct(db, Number(product[1]), body);
  if (product && product[2] && method === 'POST') {
    const quantity = integer(body.quantity, -1_000_000, 1_000_000);
    requireThat(quantity !== 0, 'จำนวนปรับสต็อกต้องไม่เป็นศูนย์');
    const productId = Number(product[1]);
    const reason = 'adjust:' + field(body.reason, 120, 1);
    requireThat(typeof body.request_id === 'string' && REQUEST_ID.test(body.request_id));
    const row = await db.prepare(`
      INSERT INTO stock_movements (product_id, user_id, quantity, reason, request_id) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(request_id) DO NOTHING RETURNING id
    `).bind(productId, user.id, quantity, reason, body.request_id).first();
    if (!row) {
      const previous = await db.prepare('SELECT product_id, user_id, quantity, reason FROM stock_movements WHERE request_id = ?')
        .bind(body.request_id).first();
      requireThat(previous?.product_id === productId && previous.user_id === user.id &&
        previous.quantity === quantity && previous.reason === reason, 'รายการนี้ถูกบันทึกแล้ว กรุณาตรวจสอบประวัติสต็อก', 409);
    }
    return response({ ok: true }, row ? 201 : 200);
  }
  if (product && product[2] && method === 'GET') {
    return response((await db.prepare(`
      SELECT m.id, m.quantity, m.reason, m.created, m.sale_id, u.name
      FROM stock_movements m JOIN users u ON m.user_id = u.id
      WHERE m.product_id = ? ORDER BY m.id DESC LIMIT 100
    `).bind(Number(product[1])).all()).results);
  }
  const voidMatch = path.match(/^\/api\/sales\/(\d+)\/void$/);
  if (voidMatch && method === 'POST') {
    const id = Number(voidMatch[1]);
    const reason = field(body.reason, 160, 1);
    const row = await db.prepare(`
      UPDATE sales SET status = 'void', void_reason = ?, void_by = ?,
        void_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND status = 'paid' RETURNING id
    `).bind(reason, user.id, id).first();
    if (!row) {
      const sale = await saleDetails(db, id, user);
      requireThat(sale.void_reason === reason, 'บิลนี้ถูกยกเลิกแล้ว', 409);
      return response(sale);
    }
    return response(await saleDetails(db, id, user));
  }
  if (path === '/api/settings' && method === 'PUT') {
    const promptpay = field(body.promptpay ?? '', 13);
    requireThat(!promptpay || /^(\d{10}|\d{13})$/.test(promptpay), 'กรุณาระบุเบอร์ PromptPay 10 หลัก หรือรหัสผู้รับ 13 หลัก');
    const paper = integer(body.paper, 58, 80);
    requireThat(paper === 58 || paper === 80, 'เลือกกระดาษ 58 หรือ 80 มม.');
    if (body.name === undefined) {
      await db.prepare('UPDATE settings SET promptpay = ?, paper = ? WHERE id = 1').bind(promptpay, paper).run();
    } else {
      await db.prepare('UPDATE settings SET name = ?, address = ?, phone = ?, promptpay = ?, paper = ? WHERE id = 1')
        .bind(field(body.name, 100, 1), field(body.address, 300), field(body.phone, 40), promptpay, paper).run();
    }
    return response({ ok: true });
  }
  if (path === '/api/staff' && method === 'GET') {
    return response((await db.prepare("SELECT id, username, name, active FROM users WHERE role = 'cashier' ORDER BY id").all()).results);
  }
  if (path === '/api/staff' && method === 'POST') {
    return response(await db.prepare("INSERT INTO users (username, name, password, role) VALUES (?, ?, ?, 'cashier') RETURNING id")
      .bind(username(body.username), field(body.name, 80, 1), await passwordHash(validPassword(body.password))).first(), 201);
  }
  const staff = path.match(/^\/api\/staff\/(\d+)$/);
  if (staff && method === 'PUT') {
    const id = Number(staff[1]);
    const account = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'cashier'").bind(id).first();
    requireThat(account, 'ไม่พบบัญชีพนักงาน', 404);
    const password = body.password ? await passwordHash(validPassword(body.password)) : null;
    await db.batch([
      db.prepare('UPDATE users SET name = ?, active = ?, password = COALESCE(?, password) WHERE id = ?')
        .bind(field(body.name, 80, 1), body.active === true ? 1 : 0, password, id),
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND ? = 1').bind(id, password || !body.active ? 1 : 0)
    ]);
    return response({ ok: true });
  }
  throw new HttpError(404, 'ไม่พบรายการ');
}

function logoResponse(image) {
  return new Response(new Uint8Array(image), { headers: {
    'Content-Type': 'image/png',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Robots-Tag': 'noindex'
  } });
}

async function api(request, env, url, path) {
  const { searchParams } = url;
  const method = request.method;
  if (method !== 'GET') {
    requireThat(request.headers.get('Origin') === url.origin, 'ต้นทางคำขอไม่ถูกต้อง', 403);
  }
  const db = env.DB;
  if (path === '/api/public-profile' && method === 'GET') {
    const shop = await db.prepare(`SELECT name, tagline, address, phone, email, line_id, logo_id, theme, photo_id, description, hours, website
      FROM settings WHERE id = 1 AND published = 1`).first();
    return response(shop, shop ? 200 : 404);
  }
  if (['/api/public-logo', '/api/public-photo'].includes(path) && method === 'GET') {
    const imageColumn = path.endsWith('photo') ? 'photo_id' : 'logo_id';
    const logo = await db.prepare(`SELECT image FROM shop_logos
      JOIN settings ON settings.${imageColumn} = shop_logos.id WHERE settings.id = 1 AND published = 1`).first();
    return logo ? logoResponse(logo.image) : response(null, 404);
  }
  if (path === '/api/profile' && method === 'PUT') {
    const user = await authenticate(db, request, url);
    requireThat(user, 'กรุณาเข้าสู่ระบบ', 401);
    requireThat(user.role === 'owner', 'รายการนี้สำหรับเจ้าของร้าน', 403);
    return saveProfile(db, await jsonBody(request, 720_000));
  }
  const body = ['POST', 'PUT'].includes(method) ? await jsonBody(request) : null;
  if (path === '/api/setup' && method === 'POST') return setup(env, body, request);
  if (path === '/api/login' && method === 'POST') return login(db, body, request, url);
  const user = await authenticate(db, request, url);
  if (path === '/api/session' && method === 'GET') {
    const initialized = user || await db.prepare("SELECT id FROM users WHERE role = 'owner'").first();
    return response({ initialized: Boolean(initialized), user: user ? { id: user.id, name: user.name, role: user.role } : null });
  }
  requireThat(user, 'กรุณาเข้าสู่ระบบ', 401);
  if (path === '/api/logout' && method === 'POST') {
    await db.prepare('DELETE FROM sessions WHERE token = ?').bind(user.session).run();
    return response({ ok: true }, 200, { 'Set-Cookie': cookie('', 0, url) });
  }
  if (path === '/api/password' && method === 'POST') {
    await rateLimit(db, 'password:' + user.id, 8);
    const row = await db.prepare('SELECT password FROM users WHERE id = ?').bind(user.id).first();
    requireThat(typeof body.current === 'string' && body.current.length <= 128 &&
      same(await passwordHash(body.current, row.password.split('.')[0]), row.password), 'รหัสผ่านเดิมไม่ถูกต้อง', 400);
    const hash = await passwordHash(validPassword(body.password));
    const [changed] = await db.batch([
      db.prepare('UPDATE users SET password = ? WHERE id = ? AND password = ?').bind(hash, user.id, row.password),
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').bind(user.id, user.session)
    ]);
    requireThat(changed.meta.changes === 1, 'รหัสผ่านถูกเปลี่ยนไปแล้ว', 409);
    return response({ ok: true });
  }
  const logo = path.match(/^\/api\/profile\/logos\/([a-f0-9]{64})$/);
  if (logo && method === 'GET') {
    const row = await db.prepare('SELECT image FROM shop_logos WHERE id = ?').bind(logo[1]).first();
    requireThat(row, 'ไม่พบโลโก้', 404);
    return logoResponse(row.image);
  }
  if (path === '/api/catalog' && method === 'GET') return catalog(db, user.role === 'owner');
  if (path === '/api/sales' && method === 'POST') return sell(db, body, user);
  if (path === '/api/sales' && method === 'GET') return salesList(db, searchParams, user);
  const receipt = path.match(/^\/api\/sales\/(\d+)$/);
  if (receipt && method === 'GET') return response(await saleDetails(db, Number(receipt[1]), user));
  requireThat(user.role === 'owner', 'รายการนี้สำหรับเจ้าของร้าน', 403);
  return adminRoute(db, method, path, body, user);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const route = url.pathname.match(/^\/shops\/([a-z0-9][a-z0-9-]{0,47})\/pos(\/api\/.*)$/);
    if (!route || route[1] !== env.SHOP_SLUG) return response({ error: 'ไม่พบรายการ' }, 404);
    try {
      return await api(request, env, url, route[2]);
    } catch (error) {
      if (error instanceof HttpError) return response({ error: error.message }, error.status);
      if (/UNIQUE constraint failed/.test(error.message)) return response({ error: 'ข้อมูลซ้ำ เช่น ชื่อผู้ใช้ ชื่อหมวด SKU หรือบาร์โค้ด' }, 409);
      if (/CHECK constraint failed: stock/.test(error.message)) return response({ error: 'สต็อกคงเหลือไม่พอสำหรับการปรับออก' }, 409);
      if (/FOREIGN KEY constraint failed/.test(error.message)) return response({ error: 'ไม่พบสินค้าหรือหมวดที่เลือก' }, 409);
      console.error('POS request failed', request.method, url.pathname, error.message);
      return response({ error: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่' }, 500);
    }
  }
};
