import { digest, hex, passwordHash, same } from './auth-crypto.mjs';
import { field, HttpError, rateLimit, readText, requireThat } from './request.mjs';
import { page, text } from './market-ui.mjs';
import { icon } from '../public/icons.js';

const hours = 8 * 3600;
const slugPattern = /^[a-z0-9][a-z0-9-]{0,47}$/;
const statusLabels = { pending: 'รอตรวจสอบ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ' };

function sessionCookie(url, role, token, maxAge) {
  const secure = url.protocol === 'https:';
  return `${cookieName(url, role)}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

function cookieName(url, role) {
  return (url.protocol === 'https:' ? '__Host-' : '') + 'market_' + role;
}

function redirect(path, cookie) {
  const headers = { Location: path, 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return new Response(null, { status: 303, headers });
}

async function startSession(db, url, role, tenantId) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM market_sessions WHERE expires <= ?').bind(now),
    db.prepare('DELETE FROM login_attempts WHERE bucket < ?').bind(Math.floor(now / 900_000) - 2),
    db.prepare('INSERT INTO market_sessions VALUES (?, ?, ?, ?)').bind(await digest(token), tenantId, role, now + hours * 1000)
  ]);
  return redirect(`/${role}/`, sessionCookie(url, role, token, hours));
}

async function getSession(db, request, url, role) {
  const token = request.headers.get('Cookie')?.match(new RegExp(
    '(?:^|;\\s*)' + cookieName(url, role) + '=([a-f0-9]{64})(?:;|$)'
  ))?.[1];
  if (!token) return null;
  return db.prepare(`SELECT token, tenant_id FROM market_sessions
    WHERE token = ? AND role = ? AND expires > ?`).bind(await digest(token), role, Date.now()).first();
}

function input(label, name, attrs) {
  return `<label>${label}<input name="${name}" required ${attrs}></label>`;
}

function logoutForm(role) {
  return `<form method="post" action="/${role}/logout/"><button class="secondary">${icon('exit')} ออกจากระบบ</button></form>`;
}

function loginPage(role, message = '', status = 200) {
  const admin = role === 'admin';
  const title = admin ? 'ผู้ดูแลตลาด' : 'พื้นที่ผู้เช่าร้าน';
  return page(title, `<section class="account-card">
    <span class="tile-icon">${icon(admin ? 'shield' : 'user')}</span>
    <p class="eyebrow">${admin ? 'MARKET ADMIN' : 'TENANT PORTAL'}</p><h1>${title}</h1>
    <p>${admin ? 'ตรวจใบสมัครและผูกร้านให้ผู้เช่า' : 'เข้าสู่ระบบเพื่อติดตามใบสมัครและเปิด POS ของร้านที่ได้รับ'}</p>
    ${message ? `<p class="form-error" role="alert">${text(message)}</p>` : ''}
    <form method="post" action="/${role}/login/" class="account-form">
      ${admin ? '' : input('อีเมล', 'email', 'type="email" maxlength="120" autocomplete="username"')}
      ${input(admin ? 'รหัสผู้ดูแลตลาด' : 'รหัสผ่าน', 'password', 'type="password" maxlength="128" autocomplete="current-password"')}
      <button class="primary">${icon('key')} เข้าสู่ระบบ</button>
    </form>
    ${admin ? '' : '<p>ยังไม่มีบัญชีใช่ไหม <a href="/tenant/register/">สมัครเป็นผู้เช่าร้าน</a></p>'}
    </section>`, status, role);
}

function registration(message = '', status = 200) {
  return page('สมัครเป็นผู้เช่าร้าน', `<section class="account-card">
    <span class="tile-icon">${icon('market')}</span><p class="eyebrow">TENANT REGISTRATION</p>
    <h1>สมัครเป็นผู้เช่าร้าน</h1><p>สร้างบัญชีและส่งข้อมูลให้ผู้ดูแลตลาดตรวจสอบ</p>
    ${message ? `<p class="form-error" role="alert">${text(message)}</p>` : ''}
    <form method="post" action="/tenant/register/" class="account-form">
      ${input('ชื่อผู้สมัคร', 'name', 'maxlength="80" autocomplete="name"')}
      ${input('ชื่อร้านที่ต้องการเปิด', 'shop_name', 'maxlength="100" autocomplete="organization"')}
      ${input('อีเมลสำหรับเข้าระบบ', 'email', 'type="email" maxlength="120" autocomplete="email"')}
      ${input('รหัสผ่าน (อย่างน้อย 12 ตัวอักษร)', 'password', 'type="password" minlength="12" maxlength="128" autocomplete="new-password"')}
      <label>แนะนำร้านและสินค้าของคุณ <small>(ไม่บังคับ)</small><textarea name="note" rows="3" maxlength="800"></textarea></label>
      <button class="primary">${icon('plus')} สมัครและส่งใบสมัคร</button>
    </form><p>มีบัญชีแล้ว <a href="/tenant/">เข้าสู่ระบบ</a></p></section>`, status, 'tenant');
}

function badge(status) {
  return `<span class="badge ${status}">${statusLabels[status]}</span>`;
}

function tenantPage(tenant, shops) {
  const { status, shop_slug: slug } = tenant;
  const shop = slug && Object.hasOwn(shops, slug) ? shops[slug] : null;
  const open = shop?.enabled && Date.parse(shop.expiresAt) > Date.now();
  const detail = {
    pending: 'ผู้ดูแลตลาดได้รับใบสมัครแล้ว คุณกลับมาดูผลได้ที่หน้านี้',
    approved: 'ใช้บัญชีเจ้าของร้านหรือพนักงานที่ได้รับจากผู้ดูแลเพื่อเข้าสู่ POS',
    rejected: 'ผู้ดูแลตลาดปิดการพิจารณาใบสมัครนี้แล้ว'
  }[status];
  return page('บัญชีผู้เช่าร้าน', `<section class="workspace-head">
    <div><p class="eyebrow">${icon('user')} พื้นที่ผู้เช่าร้าน</p><h1>สวัสดี ${text(tenant.name)}</h1></div>${logoutForm('tenant')}
    </section><section class="details"><div class="section-heading"><h2>${text(tenant.shop_name)}</h2>${badge(status)}</div>
    <p>${detail}</p>${open && slugPattern.test(slug) ? `<div class="cta-row"><a class="primary" href="/shops/${slug}/pos/">${icon('cart')} เข้าสู่ POS</a>
      <a class="secondary" href="/shops/${slug}/">${icon('market')} ดูหน้าร้าน</a></div>` : ''}
    ${shop && !open ? '<p>ร้านถูกพักหรือหมดระยะเวลาเช่า</p>' : ''}
    </section>`, 200, 'tenant');
}

const thaiDate = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' });

async function adminPage(db, shops, url, message = '', status = 200) {
  const filter = Object.hasOwn(statusLabels, url.searchParams.get('status')) ? url.searchParams.get('status') : 'pending';
  const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
  const [applications, assigned] = await db.batch([
    db.prepare(`SELECT id, name, email, shop_name, note, status, shop_slug, created FROM tenants
      WHERE status = ? AND id < ? ORDER BY id DESC LIMIT 31`).bind(filter, before),
    db.prepare('SELECT shop_slug FROM tenants WHERE shop_slug IS NOT NULL')
  ]);
  const used = new Set(assigned.results.map(row => row.shop_slug));
  const choices = Object.entries(shops).filter(([slug, shop]) => slugPattern.test(slug) && !used.has(slug) &&
    shop.enabled === true && Date.parse(shop.expiresAt) > Date.now())
    .map(([slug, shop]) => `<option value="${slug}">${text(shop.label)} (${slug})</option>`).join('');
  const cards = applications.results.slice(0, 30).map(app => `<article class="application details">
    <div class="section-heading"><h2>${text(app.shop_name)}</h2>${badge(app.status)}</div>
    <p>${text(app.name)} · ${text(app.email)} · ${thaiDate.format(app.created)}</p>
    ${app.note ? `<p class="preserve">${text(app.note)}</p>` : ''}
    ${app.shop_slug ? `<p>ร้านที่ผูกไว้ <strong>${text(app.shop_slug)}</strong></p>` : ''}
    ${app.status === 'pending' ? `<div class="review-actions">
      ${choices ? `<form method="post" action="/admin/decision/" class="account-form">
        <input type="hidden" name="id" value="${app.id}"><input type="hidden" name="decision" value="approved">
        <label>ร้านที่เตรียมไว้<select name="slug" required><option value="">เลือกร้าน</option>${choices}</select></label>
        <button class="primary">${icon('shield')} อนุมัติและผูกร้าน</button></form>` : '<p>เตรียมร้านใน Cloudflare ก่อนอนุมัติ</p>'}
      <form method="post" action="/admin/decision/">
        <input type="hidden" name="id" value="${app.id}"><input type="hidden" name="decision" value="rejected">
        <button class="secondary">ไม่อนุมัติ</button></form></div>` : ''}
    </article>`).join('');
  return page('จัดการใบสมัคร', `<section class="workspace-head">
    <div><p class="eyebrow">${icon('shield')} ผู้ดูแลตลาด</p><h1>จัดการใบสมัคร</h1>
    <p>ตรวจคำขอเช่าและเลือกผูกร้านที่เตรียมไว้ให้ผู้สมัคร</p></div>${logoutForm('admin')}</section>
    <nav class="filter-nav" aria-label="สถานะใบสมัคร">${Object.entries(statusLabels).map(([key, label]) =>
      `<a href="/admin/?status=${key}" ${key === filter ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
    ${message ? `<p class="form-error" role="alert">${text(message)}</p>` : ''}
    ${cards || '<section class="details">ยังไม่มีใบสมัครในสถานะนี้</section>'}
    ${applications.results.length > 30 ? `<p><a href="/admin/?status=${filter}&amp;before=${applications.results[29].id}">ดูใบสมัครถัดไป</a></p>` : ''}
    `, status, 'admin');
}

function emailField(value) {
  const email = field(value, 120, 3).toLowerCase();
  requireThat(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'กรอกอีเมลให้ถูกต้อง');
  return email;
}

async function processForm(db, request, url, env, role, session) {
  requireThat(request.headers.get('Origin') === url.origin, 'ต้นทางคำขอไม่ถูกต้อง', 403);
  requireThat(request.headers.get('Content-Type')?.split(';')[0] === 'application/x-www-form-urlencoded', 'รูปแบบข้อมูลไม่ถูกต้อง', 415);
  const form = new URLSearchParams(await readText(request, 12_000));
  const ip = request.headers.get('CF-Connecting-IP') || 'local';
  if (url.pathname === `/${role}/logout/`) {
    if (session) await db.prepare('DELETE FROM market_sessions WHERE token = ?').bind(session.token).run();
    return redirect(`/${role}/`, sessionCookie(url, role, '', 0));
  }
  if (url.pathname === '/tenant/register/') {
    requireThat(!session, 'คุณเข้าสู่ระบบอยู่แล้ว', 409);
    await rateLimit(db, 'register:' + ip, 8);
    const email = emailField(form.get('email'));
    const password = field(form.get('password'), 128, 12);
    const name = field(form.get('name'), 80, 1);
    const shopName = field(form.get('shop_name'), 100, 1);
    const note = field(form.get('note') ?? '', 800);
    const tenant = await db.prepare(`INSERT INTO tenants (email, password, name, shop_name, note, created)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING RETURNING id`)
      .bind(email, await passwordHash(password), name, shopName, note, Date.now()).first();
    requireThat(tenant, 'มีบัญชีสำหรับอีเมลนี้แล้ว กรุณาเข้าสู่ระบบ', 409);
    return startSession(db, url, role, tenant.id);
  }
  if (url.pathname === `/${role}/login/`) {
    await rateLimit(db, 'login:' + role + ':' + ip, role === 'admin' ? 10 : 25);
    const password = field(form.get('password'), 128, 1);
    if (role === 'admin') {
      requireThat(typeof env.MARKET_ADMIN_KEY === 'string' && env.MARKET_ADMIN_KEY.length >= 32,
        'ผู้ติดตั้งยังไม่ได้ตั้งรหัสผู้ดูแลตลาด', 503);
      requireThat(same(await digest(password), await digest(env.MARKET_ADMIN_KEY)), 'รหัสผู้ดูแลตลาดไม่ถูกต้อง', 401);
      return startSession(db, url, role, null);
    }
    const email = emailField(form.get('email'));
    await rateLimit(db, 'tenant:' + ip + ':' + await digest(email), 8);
    const tenant = await db.prepare('SELECT id, password FROM tenants WHERE email = ?').bind(email).first();
    const hash = await passwordHash(password, tenant?.password.split('.')[0] || '00000000000000000000000000000000');
    requireThat(tenant && same(hash, tenant.password), 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', 401);
    return startSession(db, url, role, tenant.id);
  }
  if (url.pathname === '/admin/decision/') {
    requireThat(session, 'กรุณาเข้าสู่ระบบผู้ดูแลตลาด', 403);
    const id = Number(form.get('id'));
    const decision = form.get('decision');
    requireThat(Number.isSafeInteger(id) && id > 0 && ['approved', 'rejected'].includes(decision));
    const slug = decision === 'approved' ? field(form.get('slug'), 48, 1) : null;
    if (slug) {
      const shops = env.SHOPS ?? {};
      const shop = Object.hasOwn(shops, slug) && shops[slug];
      requireThat(slugPattern.test(slug) && shop?.enabled === true && Date.parse(shop.expiresAt) > Date.now() &&
        typeof env[shop.binding]?.fetch === 'function', 'เลือกร้านที่พร้อมเปิดใช้งาน');
    }
    const saved = await db.prepare(`UPDATE tenants SET status = ?, shop_slug = ?
      WHERE id = ? AND status = 'pending'
      AND (? IS NULL OR NOT EXISTS (SELECT 1 FROM tenants WHERE shop_slug = ?))`)
      .bind(decision, slug, id, slug, slug).run();
    requireThat(saved.meta.changes === 1, 'ใบสมัครถูกดำเนินการแล้วหรือร้านถูกผูกกับบัญชีอื่น', 409);
    return redirect('/admin/?status=' + decision);
  }
  throw new HttpError(404, 'ไม่พบหน้านี้');
}

export async function accountRoute(request, env, url) {
  const role = url.pathname.split('/')[1];
  const db = env.MARKET_DB;
  let session;
  try {
    requireThat(db, 'ยังไม่ได้เชื่อมฐานข้อมูลตลาด', 503);
    session = await getSession(db, request, url, role);
    if (request.method === 'POST') return await processForm(db, request, url, env, role, session);
    requireThat(request.method === 'GET' || request.method === 'HEAD', 'วิธีส่งคำขอไม่ถูกต้อง', 405);
    if (url.pathname === '/tenant/register/') return session ? redirect('/tenant/') : registration();
    requireThat(url.pathname === `/${role}/`, 'ไม่พบหน้านี้', 404);
    if (!session) return loginPage(role);
    if (role === 'admin') return await adminPage(db, env.SHOPS ?? {}, url);
    const tenant = await db.prepare('SELECT name, shop_name, status, shop_slug FROM tenants WHERE id = ?')
      .bind(session.tenant_id).first();
    return tenant ? tenantPage(tenant, env.SHOPS ?? {}) : loginPage(role);
  } catch (error) {
    if (!(error instanceof HttpError)) console.error('Market account route failed', url.pathname, error.message);
    const status = error instanceof HttpError ? error.status : 500;
    const message = status === 500 ? 'ระบบขัดข้องชั่วคราว กรุณาลองอีกครั้ง' : error.message;
    if (url.pathname === '/tenant/register/') return registration(message, status);
    if (session && role === 'admin' && status < 500) return adminPage(db, env.SHOPS ?? {}, url, message, status);
    return loginPage(role, message, status);
  }
}
