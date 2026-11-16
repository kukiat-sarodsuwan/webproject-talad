import { icon } from './icons.js';

const posPath = location.pathname;
const shopPath = posPath.slice(0, -4);

const app = document.querySelector('#app');
const modal = document.querySelector('#modal');
const notice = document.querySelector('#notice');
const printArea = document.querySelector('#print-area');
const esc = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const amount = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' });
const money = value => amount.format(value / 100);
const timestamp = new Intl.DateTimeFormat('th-TH', {
  dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok'
});
const isoDate = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
});
const today = () => isoDate.format(new Date());
const dateTime = value => timestamp.format(new Date(value));
const bill = id => '#' + String(id).padStart(6, '0');
const payLabel = method => method === 'cash' ? 'เงินสด' : 'PromptPay';
const state = {
  user: null, view: 'pos', products: [], categories: [], settings: {}, cart: new Map(),
  search: '', category: 0, method: 'cash', paid: '', confirmed: false, reference: '',
  pending: null, busy: false, day: today(), sales: [], next: null, summary: {}, staff: []
};

let noticeTimer;
function notify(message, bad = false) {
  notice.textContent = message;
  notice.className = bad ? 'show bad' : 'show';
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { notice.className = ''; }, 6500);
}

class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function api(path, body, method = 'POST') {
  let result;
  try {
    result = await fetch(posPath + 'api' + path, body === undefined ? {} : {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
  } catch {
    throw new ApiError(0, 'ติดต่อระบบไม่ได้ กรุณาตรวจการเชื่อมต่อ');
  }
  const data = await result.json().catch(() => ({}));
  if (!result.ok) throw new ApiError(result.status, data.error || 'ระบบขัดข้อง กรุณาลองใหม่');
  return data;
}

function button(text, action, options = {}) {
  const { cls = '', id = '', disabled = false } = options;
  return `<button type="button" class="btn ${cls}" data-act="${action}" data-id="${id}" ${disabled ? 'disabled' : ''}>${text}</button>`;
}

function input(label, name, value = '', options = {}) {
  const { type = 'text', attrs = '' } = options;
  return `<label>${label}<input type="${type}" name="${name}" value="${esc(value)}" ${attrs}></label>`;
}

function empty(text) {
  return `<div class="empty">${text}</div>`;
}

function form(name, fields, label = 'บันทึก') {
  return `<form class="form" data-form="${name}">${fields}<p class="error" data-error role="alert"></p>
    <button type="submit" class="btn primary wide">${label}</button></form>`;
}

function auth(initialized) {
  const setupFields = initialized ? '' :
    input('รหัสตั้งค่าจากผู้ติดตั้ง', 'key', '', { type: 'password', attrs: 'required maxlength="256" autocomplete="off"' }) +
    input('ชื่อร้าน', 'shop', '', { attrs: 'required maxlength="100"' }) +
    input('ชื่อเจ้าของร้าน', 'name', '', { attrs: 'required maxlength="80"' });
  app.innerHTML = `<main class="auth-wrap">
    <section class="auth-brand"><div class="brand"><span class="mark">C</span><span class="eyebrow">COUNTER POS</span></div>
    <h1>พร้อมขาย<br>ทุกวัน</h1><p>จัดการหน้าร้าน สต็อก และยอดขายได้จากที่เดียว</p></section>
    <section class="auth-form"><h2>${initialized ? 'เข้าสู่ระบบ' : 'ตั้งค่าร้านครั้งแรก'}</h2>
    <p class="muted">${initialized ? 'สำหรับเจ้าของร้านและพนักงานขาย' : 'สร้างบัญชีเจ้าของร้านเพื่อเริ่มใช้งาน'}</p>
    ${form(initialized ? 'login' : 'setup', setupFields +
      input('ชื่อผู้ใช้', 'username', '', { attrs: 'required minlength="3" maxlength="32" autocomplete="username" autocapitalize="none"' }) +
      input('รหัสผ่าน', 'password', '', { type: 'password', attrs: initialized ?
        'required maxlength="128" autocomplete="current-password"' : 'required minlength="12" maxlength="128" autocomplete="new-password"' }),
      initialized ? 'เข้าสู่ระบบ' : 'สร้างร้านและบัญชีเจ้าของ')}
    <p class="auth-links"><a href="${shopPath}">${icon('market')} ดูหน้าร้าน</a><a href="/tenant/">พื้นที่ผู้เช่า</a></p></section></main>`;
}

const salesMenus = [
  ['pos', 'cart', 'หน้าขาย'],
  ['sales', 'receipt', 'ประวัติบิล']
];
const ownerMenus = [
  ['inventory', 'box', 'สินค้าและสต็อก'],
  ['profile', 'image', 'โปรไฟล์ร้าน'],
  ['staff', 'team', 'บัญชีพนักงาน'],
  ['settings', 'settings', 'ตั้งค่าการขาย']
];

function navGroup(label, menus) {
  return `<div class="nav-group"><p class="nav-label">${label}</p>${menus.map(([id, glyph, name]) =>
    `<button type="button" data-act="view" data-id="${id}" class="${id === state.view ? 'current' : ''}"
    ${id === state.view ? 'aria-current="page"' : ''}>${icon(glyph)} ${name}</button>`).join('')}</div>`;
}

function onlineIndicator() {
  return `<span class="online ${navigator.onLine ? '' : 'offline'}">${navigator.onLine ? 'ออนไลน์' : 'ออฟไลน์'}</span>`;
}

function pageHead(title, detail, actions = '') {
  return `<header class="page-head"><div><h1>${title}</h1><p>${detail}</p></div><div class="actions">${actions}</div></header>`;
}

function logoUrl(id) {
  return posPath + 'api/profile/logos/' + encodeURIComponent(id);
}

function render() {
  const views = { pos: posView, inventory: inventoryView, sales: salesView, profile: profileView, staff: staffView, settings: settingsView };
  const shop = state.settings;
  app.innerHTML = `<div class="shell"><aside class="sidebar">
    <div class="brand">${shop.logo_id ? `<img class="mark brand-logo" src="${logoUrl(shop.logo_id)}" alt="">` :
      '<span class="mark" aria-hidden="true">C</span>'}<div><span class="eyebrow">COUNTER POS</span>
    <span class="brand-name">${esc(shop.name)}</span>${shop.tagline ? `<small class="brand-tagline">${esc(shop.tagline)}</small>` : ''}</div></div>
    <nav class="nav" aria-label="เมนูหลัก">
      ${navGroup('งานขายหน้าร้าน', salesMenus)}
      ${state.user.role === 'owner' ? navGroup('จัดการร้าน · เจ้าของร้าน', ownerMenus) : ''}
    </nav>
    <div class="side-actions"><div class="identity">${esc(state.user.name)}<br>
      <small class="role-pill">${icon(state.user.role === 'owner' ? 'shield' : 'user')}
      ${state.user.role === 'owner' ? 'เจ้าของร้าน' : 'พนักงานขาย'}</small></div>
      <a href="${shopPath}">${icon('market')} ดูหน้าร้านสาธารณะ</a>
      <button type="button" data-act="password">${icon('key')} เปลี่ยนรหัสผ่าน</button>
      <button type="button" data-act="logout">${icon('exit')} ออกจากระบบ</button></div>
    </aside><main class="main"><div class="topline"><span class="eyebrow">${state.user.role === 'owner' ? 'พื้นที่เจ้าของร้าน' : 'พื้นที่พนักงานขาย'}</span><div id="connection">${onlineIndicator()}</div></div>
    ${views[state.view]()}</main></div>`;
}

function catalogTiles() {
  const search = state.search.trim().toLowerCase();
  const products = state.products.filter(p => p.active && (!state.category || p.category_id === state.category) &&
    (!search || [p.name, p.sku, p.barcode].some(value => value?.toLowerCase().includes(search))));
  return products.map(p => `<button type="button" class="tile" data-act="add" data-id="${p.id}" ${!p.stock || state.pending ? 'disabled' : ''}>
      <span class="tile-icon" aria-hidden="true">${['◒', '◇', '◉', '▦'][(p.category_id - 1) % 4]}</span>
      <span><small>${esc(p.sku)}</small><br><strong>${esc(p.name)}</strong></span>
      <span class="row"><strong class="tile-price">${money(p.price)}</strong><small>${p.stock ? p.stock + ' ' + esc(p.unit) : 'หมด'}</small></span>
    </button>`).join('') || empty(state.products.some(p => p.active) ? 'ไม่พบสินค้าที่ตรงกับการค้นหา' : 'ยังไม่มีสินค้าเปิดขาย กรุณาเพิ่มสินค้าจากหลังบ้าน');
}

function totalCart() {
  return Array.from(state.cart.values()).reduce((sum, item) => sum + item.price * item.quantity, 0);
}

function cents(value) {
  const text = String(value).trim();
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

function checkout() {
  if (state.pending) {
    return `<div class="stack">
      <p class="warning">มีบิลที่ยังไม่ได้รับผลยืนยัน กดตรวจสอบบิลนี้ก่อนเริ่มขายรายการใหม่</p>
      <div class="row total"><span>ยอดในบิล</span><strong>${money(state.pending.items.reduce((total, p) => total + p.price * p.quantity, 0))}</strong></div>
      ${button('ตรวจสอบและส่งบิลเดิมอีกครั้ง', 'retry', { cls: 'primary wide', disabled: state.busy })}
    </div>`;
  }
  const total = totalCart();
  const lines = Array.from(state.cart.values()).map(p => `<div class="row cart-line">
    <div><strong>${esc(p.name)}</strong><br><small>${money(p.price)} / ${esc(p.unit)}</small></div>
    <div class="quantity">${button('−', 'minus', { id: p.id })}<strong>${p.quantity}</strong>${button('+', 'add', { id: p.id })}</div></div>`).join('');
  return `<div class="panel-head"><h2>ตะกร้าสินค้า</h2>${button('ล้าง', 'clear', { disabled: !state.cart.size })}</div>
    <div class="cart-list">${lines || empty('เลือกสินค้าหรือสแกนบาร์โค้ดเพื่อเริ่มขาย')}</div>
    <div class="row total"><span>ยอดที่ต้องชำระ</span><strong>${money(total)}</strong></div>
    <div class="method">${button('เงินสด', 'method', { id: 'cash', cls: state.method === 'cash' ? 'selected' : '' })}
    ${button('PromptPay', 'method', { id: 'promptpay', cls: state.method === 'promptpay' ? 'selected' : '' })}</div>
    <div class="checkout-actions">${state.method === 'cash' ?
      input('เงินที่รับ (บาท)', 'received', state.paid, { attrs: 'inputmode="decimal" maxlength="12" placeholder="0.00"' }) +
      `<div class="row"><span>เงินทอน</span><strong id="change">${money(Math.max(0, (cents(state.paid) ?? 0) - total))}</strong>
      ${button('พอดี', 'exact', { disabled: !state.cart.size })}</div>` :
      `<p class="muted">${state.settings.promptpay ? 'PromptPay ร้าน ' + esc(state.settings.promptpay) : 'ให้ลูกค้าสแกน QR ของร้าน'}
      · ตรวจยอดจากแอปธนาคารของร้านก่อนยืนยัน</p>` +
      input('เลขอ้างอิง (ถ้ามี)', 'reference', state.reference, { attrs: 'maxlength="80"' }) +
      `<label class="check"><input type="checkbox" name="confirmed" ${state.confirmed ? 'checked' : ''}>ได้รับเงินเข้าครบตามยอดแล้ว</label>`}
      ${button('บันทึกการขาย', 'pay', { cls: 'primary wide', disabled: !state.cart.size || state.busy })}
    </div>`;
}

function posView() {
  return pageHead('หน้าขาย', 'ค้นหา สแกนบาร์โค้ด หรือแตะสินค้าเพื่อเพิ่มลงตะกร้า',
    button('โหลดสินค้าล่าสุด', 'refresh')) + `<div class="pos">
      <section class="catalog" aria-label="รายการสินค้า"><form class="search" data-form="scan">
        <input id="search" name="search" aria-label="ค้นหาสินค้าหรือสแกนบาร์โค้ด" autocomplete="off" maxlength="100"
          placeholder="ค้นหาชื่อสินค้า / SKU / บาร์โค้ด" value="${esc(state.search)}"></form>
        <div class="chips">${[{ id: 0, name: 'ทั้งหมด' }, ...state.categories].map(c =>
          `<button type="button" data-act="category" data-id="${c.id}" aria-pressed="${state.category === c.id}"
           class="chip ${state.category === c.id ? 'selected' : ''}">${esc(c.name)}</button>`).join('')}</div>
        <div class="tiles" id="tiles">${catalogTiles()}</div>
      </section><aside id="checkout" class="panel checkout" aria-label="ตะกร้าและการชำระเงิน">${checkout()}</aside></div>`;
}

function table(headings, rows, message) {
  return rows.length ? `<div class="table-wrap"><table><thead><tr>${headings.map(h => `<th scope="col">${h}</th>`).join('')}</tr>
    </thead><tbody>${rows.map(row => '<tr>' + row.map(cell => '<td>' + cell + '</td>').join('') + '</tr>').join('')}</tbody></table></div>` : empty(message);
}

function inventoryView() {
  const rows = state.products.map(p => [
    `<strong>${esc(p.name)}</strong><br><small>${esc(p.sku)}${p.barcode ? ' · ' + esc(p.barcode) : ''}</small>`,
    esc(state.categories.find(c => c.id === p.category_id)?.name), money(p.price),
    `<span class="badge ${p.stock <= p.low_stock ? 'warn' : ''}">${p.stock} ${esc(p.unit)}</span>`,
    p.active ? 'เปิดขาย' : 'ปิดขาย',
    `<div class="actions">${button('แก้ไข', 'product', { id: p.id })}${button('ปรับสต็อก', 'stock', { id: p.id })}
    ${button('ประวัติ', 'movements', { id: p.id })}</div>`
  ]);
  return pageHead('สินค้าและสต็อก', 'จัดการหมวดหมู่ ราคาขาย สินค้าคงเหลือ และประวัติการเคลื่อนไหว',
    button('+ หมวดหมู่', 'new-category') + button('+ เพิ่มสินค้า', 'product', { cls: 'primary' })) +
    `<section class="panel">${table(['สินค้า / SKU', 'หมวดหมู่', 'ราคา', 'คงเหลือ', 'สถานะ', 'จัดการ'], rows, 'เพิ่มสินค้ารายการแรกเพื่อเริ่มตั้งสต็อก')}</section>`;
}

function salesView() {
  const { total, cash, promptpay, bills, voids } = state.summary;
  const metrics = [['ยอดขายสุทธิ', money(total || 0)], ['เงินสด', money(cash || 0)],
    ['PromptPay', money(promptpay || 0)], ['บิลที่ขาย / ยกเลิก', (bills || 0) + ' / ' + (voids || 0)]];
  const rows = state.sales.map(s => [bill(s.id), dateTime(s.created), esc(s.cashier), payLabel(s.method), money(s.total),
    `<span class="badge ${s.status === 'void' ? 'warn' : ''}">${s.status === 'void' ? 'ยกเลิก' : 'ชำระแล้ว'}</span>`,
    button('ดูบิล', 'receipt', { id: s.id })]);
  return pageHead('ประวัติบิล', state.user.role === 'owner' ?
    'ยอดขายรายวันตามเวลาไทย และรายการบิลของร้าน' : 'ยอดและประวัติบิลที่คุณบันทึก',
    `<input class="date-input" aria-label="วันที่ขาย" type="date" name="report-date" value="${state.day}">${button('อัปเดต', 'refresh')}`) +
    `<div class="stack"><section class="metric-grid">${metrics.map(([label, value]) =>
      `<div class="panel metric"><small>${label}</small><strong>${value}</strong></div>`).join('')}</section>
      <section class="panel">${table(['บิล', 'เวลา', 'ผู้ขาย', 'วิธีชำระ', 'ยอด', 'สถานะ', ''], rows, 'ยังไม่มีบิลในวันที่เลือก')}
      ${state.next ? '<div class="gap-top">' + button('โหลดบิลเพิ่มเติม', 'more-sales') + '</div>' : ''}</section></div>`;
}

function imageField(shop, kind, title, help) {
  const id = shop[kind + '_id'];
  return `<div class="profile-logo profile-upload">
    <div class="logo-preview"><img id="shop-${kind}-preview" alt="ตัวอย่าง${title}"
      ${id ? `src="${logoUrl(id)}"` : 'hidden'}>
      <span id="shop-${kind}-placeholder" ${id ? 'hidden' : ''}>${icon('image')}</span></div>
    <div class="stack"><label>${title}<input type="file" name="${kind}_file"
      accept="image/png,image/jpeg,image/webp" aria-describedby="${kind}-help"></label>
      <small id="${kind}-help">${help} · PNG, JPG หรือ WebP ไม่เกิน 5 MB</small>
      ${id ? `<label class="check"><input type="checkbox" name="remove_${kind}">นำรูปออก</label>` : ''}
    </div></div>`;
}

function profileView() {
  const shop = state.settings;
  return pageHead('โปรไฟล์ร้าน', 'จัดการภาพ ข้อมูลติดต่อ และรายละเอียดที่ลูกค้าเห็น') +
    `<section class="panel profile-panel"><div class="panel-head">
      <h2>${icon('image')} ข้อมูลหน้าร้าน</h2>
      <span class="profile-status ${shop.published ? 'published' : ''}">${shop.published ? 'เผยแพร่แล้ว' : 'ยังไม่เผยแพร่'}</span>
    </div>
    ${form('profile', `<div class="profile-uploads">
      ${imageField(shop, 'photo', 'รูปโปรไฟล์ร้าน', 'แสดงบนหน้าร้านสาธารณะ')}
      ${imageField(shop, 'logo', 'โลโก้ร้าน', 'ใช้กับหน้าร้านและใบเสร็จ')}
      </div>
      <div class="form-cols">
      ${input('ชื่อร้าน', 'name', shop.name, { attrs: 'required maxlength="100"' })}
      ${input('คำโปรยร้าน', 'tagline', shop.tagline, { attrs: 'maxlength="100" placeholder="เช่น อาหารและขนมทำสดทุกวัน"' })}
      ${input('โทรศัพท์ร้าน', 'phone', shop.phone, { type: 'tel', attrs: 'maxlength="40"' })}
      ${input('อีเมลร้าน', 'email', shop.email, { type: 'email', attrs: 'maxlength="120"' })}
      ${input('LINE ID', 'line_id', shop.line_id, { attrs: 'maxlength="60"' })}</div>
      <label>ที่อยู่ร้าน<textarea name="address" rows="2" maxlength="300">${esc(shop.address)}</textarea></label>
      <label>แนะนำร้าน<textarea name="description" rows="4" maxlength="800"
        placeholder="เล่าให้ลูกค้ารู้จักร้านและสินค้าของคุณ">${esc(shop.description)}</textarea></label>
      <div class="form-cols">
      ${input('เวลาเปิดร้าน', 'hours', shop.hours, { attrs: 'maxlength="140" placeholder="เช่น จันทร์–ศุกร์ 09.00–18.00 น."' })}
      ${input('เว็บไซต์ร้าน', 'website', shop.website, { type: 'url', attrs: 'maxlength="220" placeholder="https://"' })}
      </div>
      <label>สีหน้าร้าน<select name="theme">
        ${Object.entries({ leaf: 'เขียวใบไม้', ocean: 'น้ำเงินทะเล', clay: 'ส้มดินเผา' }).map(([value, label]) =>
          `<option value="${value}" ${shop.theme === value ? 'selected' : ''}>${label}</option>`).join('')}
      </select></label>
      <label class="check"><input type="checkbox" name="published" ${shop.published ? 'checked' : ''}>
        เผยแพร่โปรไฟล์ร้านพร้อมข้อมูลติดต่อ</label>
      <p><a class="preview-link" href="${shopPath}" target="_blank" rel="noopener">${icon('link')} เปิดหน้าร้านสาธารณะ</a></p>
      <label>ข้อความท้ายใบเสร็จ<textarea name="receipt_footer" rows="2" maxlength="200"
        placeholder="เช่น ขอบคุณที่อุดหนุนค่ะ">${esc(shop.receipt_footer)}</textarea></label>`, 'บันทึกโปรไฟล์ร้าน')}</section>`;
}

function settingsView() {
  const s = state.settings;
  return pageHead('ตั้งค่าการขาย', 'จัดการวิธีชำระเงินและขนาดกระดาษใบเสร็จ') +
    `<section class="panel"><div class="panel-head"><h2>${icon('settings')} การขายและการพิมพ์</h2></div>
      ${form('settings', `<div class="form-cols">
        ${input('PromptPay ร้าน (ถ้ามี)', 'promptpay', s.promptpay, { attrs: 'inputmode="numeric" maxlength="13"' })}
        <label>ความกว้างกระดาษ<select name="paper">
        <option value="80" ${s.paper === 80 ? 'selected' : ''}>80 มม.</option>
        <option value="58" ${s.paper === 58 ? 'selected' : ''}>58 มม.</option>
        </select></label></div>`, 'บันทึกข้อมูลร้าน')}</section>`;
}

function staffView() {
  const rows = state.staff.map(p => [esc(p.name), esc(p.username), p.active ? 'ใช้งานได้' : 'ปิดใช้งาน',
    button('จัดการ', 'staff', { id: p.id })]);
  return pageHead('บัญชีพนักงาน', 'ให้พนักงานขายและดูประวัติบิลของตนเอง') +
    `<section class="panel"><div class="panel-head"><h2>${icon('team')} พนักงานขาย</h2>
      ${button(icon('plus') + ' เพิ่มพนักงาน', 'staff', { cls: 'primary' })}</div>
      ${table(['ชื่อแสดง', 'ชื่อผู้ใช้', 'สถานะ', 'จัดการ'], rows, 'ยังไม่มีบัญชีพนักงาน')}</section>`;
}

function showModal(title, content) {
  modal.innerHTML = `<div class="panel-head"><h2>${esc(title)}</h2>${button('ปิด', 'close')}</div>${content}`;
  if (!modal.open) modal.showModal();
}

function showProduct(p) {
  showModal(p ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า', form('product', `<div class="form-cols">
    ${input('ชื่อสินค้า', 'name', p?.name, { attrs: 'required maxlength="100"' })}
    ${input('SKU', 'sku', p?.sku, { attrs: 'required maxlength="48"' })}
    ${input('บาร์โค้ด', 'barcode', p?.barcode, { attrs: 'maxlength="64"' })}
    <label>หมวดหมู่<select name="category_id">${state.categories.map(c =>
      `<option value="${c.id}" ${p?.category_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    ${input('หน่วยนับ เช่น จาน / ชิ้น / ขวด', 'unit', p?.unit || 'ชิ้น', { attrs: 'required maxlength="24"' })}
    ${input('ราคาขาย (บาท)', 'price', p ? (p.price / 100).toFixed(2) : '', { attrs: 'required inputmode="decimal" maxlength="12"' })}
    ${input('แจ้งเตือนเมื่อคงเหลือไม่เกิน', 'low_stock', p?.low_stock ?? 5,
      { type: 'number', attrs: 'required min="0" max="1000000000" step="1"' })}
    <label class="check"><input type="checkbox" name="active" ${!p || p.active ? 'checked' : ''}>เปิดขาย</label></div>
    ${p ? '' : '<p class="muted">สินค้าใหม่เริ่มที่สต็อก 0 หลังบันทึกให้ใช้เมนูปรับสต็อกเพื่อรับสินค้าเข้า</p>'}
    <input type="hidden" name="id" value="${p?.id ?? ''}">`));
}

function showStock(p) {
  showModal('ปรับสต็อก · ' + p.name, form('stock', `<p>คงเหลือ ${p.stock} ${esc(p.unit)}</p>
    ${input('จำนวนเพิ่มหรือลด (+ / −)', 'quantity', '', { type: 'number', attrs: 'required min="-1000000" max="1000000" step="1" placeholder="เช่น 20 หรือ -3"' })}
    ${input('เหตุผล', 'reason', '', { attrs: 'required maxlength="120" placeholder="เช่น รับสินค้าเข้า / ของเสีย"' })}
    <input type="hidden" name="id" value="${p.id}"><input type="hidden" name="request_id" value="${crypto.randomUUID()}">`));
}

function showStaff(p) {
  showModal(p ? 'จัดการบัญชีแคชเชียร์' : 'เพิ่มบัญชีแคชเชียร์', form('staff',
    input('ชื่อแสดง', 'name', p?.name, { attrs: 'required maxlength="80"' }) +
    (p ? `<p>ชื่อผู้ใช้ <strong>${esc(p.username)}</strong></p>` :
      input('ชื่อผู้ใช้', 'username', '', { attrs: 'required minlength="3" maxlength="32" autocapitalize="none"' })) +
    input(p ? 'รหัสผ่านใหม่ (เว้นว่างเพื่อใช้รหัสเดิม)' : 'รหัสผ่าน', 'password', '', {
      type: 'password', attrs: `${p ? '' : 'required'} minlength="12" maxlength="128" autocomplete="new-password"`
    }) +
    (p ? `<label class="check"><input type="checkbox" name="active" ${p.active ? 'checked' : ''}>เปิดใช้งานบัญชี</label>` : '') +
    `<input type="hidden" name="id" value="${p?.id ?? ''}">`));
}

function receiptMarkup(s) {
  const shop = s.shop;
  const contacts = [shop.phone, shop.email, shop.line_id ? 'LINE ' + shop.line_id : ''].filter(Boolean);
  return `<article class="receipt"><header>
    ${shop.logo_id ? `<img class="receipt-logo" src="${logoUrl(shop.logo_id)}" alt="">` : ''}
    <h3>${esc(shop.name)}</h3><div class="receipt-text">${esc(shop.address)}</div>
    ${contacts.map(contact => `<div>${esc(contact)}</div>`).join('')}<div>ใบเสร็จรับเงิน ${bill(s.id)}</div>
    <div>${dateTime(s.created)} · ${esc(s.cashier)}</div></header>
    ${s.status === 'void' ? `<p><strong>ยกเลิกแล้ว</strong> · ${esc(s.void_reason)}</p>` : ''}
    <div class="items">${s.items.map(p => `<div class="row"><span>${esc(p.name)}<br>${p.quantity} ${esc(p.unit)} × ${money(p.price)}</span>
      <span>${money(p.quantity * p.price)}</span></div>`).join('')}</div>
    <div class="row"><strong>ยอดรวม</strong><strong>${money(s.total)}</strong></div>
    <div class="row"><span>${payLabel(s.method)}</span><span>${money(s.paid)}</span></div>
    ${s.method === 'cash' ? `<div class="row"><span>เงินทอน</span><span>${money(s.paid - s.total)}</span></div>` : ''}
    ${s.payment_reference ? `<div>เลขอ้างอิง ${esc(s.payment_reference)}</div>` : ''}
    ${shop.receipt_footer ? `<div class="receipt-footer receipt-text">${esc(shop.receipt_footer)}</div>` : ''}</article>`;
}

function showReceipt(s) {
  const markup = receiptMarkup(s);
  printArea.className = s.shop.paper === 58 ? 'paper58' : 'paper80';
  printArea.innerHTML = markup;
  showModal('ใบเสร็จ ' + bill(s.id), markup + `<div class="actions gap-top">
    ${button('พิมพ์ใบเสร็จ', 'print', { cls: 'primary' })}
    ${state.user.role === 'owner' && s.status === 'paid' ? button('ยกเลิกบิล', 'void-form', { id: s.id, cls: 'danger' }) : ''}
    </div>`);
}

async function loadCatalog() {
  Object.assign(state, await api('/catalog'));
}

async function loadSales(append = false) {
  const requestedDay = state.day;
  const data = await api('/sales?' + new URLSearchParams({
    date: requestedDay, ...(append && state.next ? { before: state.next } : {})
  }));
  if (requestedDay !== state.day) return;
  state.sales = append ? [...state.sales, ...data.sales.filter(row => !state.sales.some(current => current.id === row.id))] : data.sales;
  state.summary = data.summary;
  state.next = data.next;
}

async function switchView(view) {
  if (view === 'sales') await loadSales();
  if (ownerMenus.some(([id]) => id === view) && state.user.role !== 'owner') return;
  if (view === 'staff') state.staff = await api('/staff');
  state.view = view;
  render();
}

function pendingKey() { return 'counter-pos.pending.' + posPath + state.user.id; }

function resetPayment() {
  Object.assign(state, { paid: '', confirmed: false, reference: '' });
}

async function start() {
  const session = await api('/session');
  state.user = session.user;
  if (!session.user) {
    state.cart.clear();
    state.pending = null;
    resetPayment();
    auth(session.initialized);
    return;
  }
  try { state.pending = JSON.parse(localStorage.getItem(pendingKey()) || 'null'); }
  catch { state.pending = null; }
  state.view = 'pos';
  await loadCatalog();
  render();
}

function updateCart() {
  document.querySelector('#checkout').innerHTML = checkout();
}

function add(id, delta) {
  if (state.pending) return;
  const product = state.products.find(p => p.id === id);
  const current = state.cart.get(id);
  const quantity = (current?.quantity || 0) + delta;
  if (quantity <= 0) state.cart.delete(id);
  else {
    if (!product?.active || quantity > product.stock || quantity > 9999) {
      notify('สต็อกคงเหลือไม่พอหรือเกินจำนวนต่อบิล', true);
      return;
    }
    if (!current && state.cart.size >= 80) { notify('เพิ่มได้สูงสุด 80 รายการต่อบิล', true); return; }
    state.cart.set(id, { ...(current || product), quantity });
  }
  state.confirmed = false;
  updateCart();
}

async function sendSale(retry) {
  if (state.busy) return;
  const total = totalCart();
  const paid = cents(state.paid);
  if (!retry) {
    if (!state.cart.size) return;
    if (state.method === 'cash' && (paid === null || paid < total)) { notify('เงินที่รับต้องไม่น้อยกว่ายอดชำระ', true); return; }
    if (state.method === 'promptpay' && !state.confirmed) { notify('กรุณาตรวจและยืนยันว่าได้รับเงินแล้ว', true); return; }
    const body = {
      request_id: crypto.randomUUID(), method: state.method, paid, confirmed: state.confirmed, reference: state.reference,
      items: Array.from(state.cart.values(), ({ id, price, quantity }) => ({ id, price, quantity }))
    };
    try { localStorage.setItem(pendingKey(), JSON.stringify(body)); }
    catch { notify('กรุณาอนุญาตให้เบราว์เซอร์จัดเก็บข้อมูลเพื่อกู้บิลเมื่อการเชื่อมต่อสะดุด', true); return; }
    state.pending = body;
  }
  state.busy = true;
  render();
  try {
    const sale = await api('/sales', state.pending);
    localStorage.removeItem(pendingKey());
    state.pending = null;
    state.cart.clear();
    resetPayment();
    showReceipt(sale);
    notify('บันทึกบิล ' + bill(sale.id) + ' แล้ว');
    await loadCatalog();
  } catch (error) {
    if (error.status === 400 || error.status === 409) {
      localStorage.removeItem(pendingKey());
      state.pending = null;
      if (error.status === 409) {
        state.cart.clear();
        resetPayment();
        await loadCatalog().catch(() => {});
      }
    }
    throw error;
  } finally {
    state.busy = false;
    if (state.user) render();
  }
}

async function perform(action, value) {
  const id = Number(value);
  const product = state.products.find(p => p.id === id);
  switch (action) {
    case 'view': return switchView(value);
    case 'category': state.category = id; render(); return;
    case 'add': return add(id, 1);
    case 'minus': return add(id, -1);
    case 'clear': state.cart.clear(); resetPayment(); return updateCart();
    case 'method': state.method = value; state.confirmed = false; return updateCart();
    case 'exact': state.paid = (totalCart() / 100).toFixed(2); return updateCart();
    case 'pay': return sendSale(false);
    case 'retry': return sendSale(true);
    case 'refresh':
      if (state.view === 'sales') await loadSales();
      else await loadCatalog();
      render();
      return;
    case 'more-sales': await loadSales(true); render(); return;
    case 'product': return showProduct(product);
    case 'stock': return showStock(product);
    case 'new-category':
      return showModal('เพิ่มหมวดหมู่', form('category', input('ชื่อหมวดหมู่', 'name', '', { attrs: 'required maxlength="64"' })));
    case 'movements': {
      const movements = await api('/products/' + id + '/stock');
      const rows = movements.map(m => [dateTime(m.created), (m.quantity > 0 ? '+' : '') + m.quantity, esc(m.name),
        m.reason === 'sale' ? 'ขาย ' + bill(m.sale_id) : m.reason === 'void' ? 'ยกเลิก ' + bill(m.sale_id) : esc(m.reason.slice(7))]);
      return showModal('ประวัติสต็อก · ' + product.name, table(['เวลา', 'จำนวน', 'ผู้บันทึก', 'รายการ'], rows, 'ยังไม่มีประวัติ'));
    }
    case 'receipt': return showReceipt(await api('/sales/' + id));
    case 'void-form':
      return showModal('ยกเลิกบิล ' + bill(id), form('void', `<p class="warning">ระบบจะคืนจำนวนสินค้าเข้าสต็อกและหักยอดบิลออกจากรายงาน หากต้องคืนเงิน ให้ดำเนินการที่ร้านตามวิธีชำระ</p>
        ${input('เหตุผลยกเลิก', 'reason', '', { attrs: 'required maxlength="160"' })}
        <input type="hidden" name="id" value="${id}">`, 'ยืนยันยกเลิกบิล'));
    case 'staff': return showStaff(state.staff.find(p => p.id === id));
    case 'password':
      return showModal('เปลี่ยนรหัสผ่าน', form('password',
        input('รหัสผ่านเดิม', 'current', '', { type: 'password', attrs: 'required maxlength="128" autocomplete="current-password"' }) +
        input('รหัสผ่านใหม่', 'password', '', { type: 'password', attrs: 'required minlength="12" maxlength="128" autocomplete="new-password"' })));
    case 'close': modal.close(); return;
    case 'print': {
      const logo = printArea.querySelector('.receipt-logo');
      if (logo) await logo.decode().catch(() => {});
      window.print();
      return;
    }
    case 'logout':
      if (state.busy) return;
      await api('/logout', {});
      if (modal.open) modal.close();
      printArea.replaceChildren();
      return start();
  }
}

function validateLogoFile(file) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('เลือกรูปเป็น PNG, JPG หรือ WebP');
  }
  if (file.size > 5 * 1024 * 1024) throw new Error('ไฟล์ต้นฉบับต้องไม่เกิน 5 MB');
}

async function prepareLogo(file) {
  validateLogoFile(file);
  const image = await createImageBitmap(file).catch(() => { throw new Error('เปิดไฟล์รูปภาพไม่ได้'); });
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    for (const max of [512, 384, 256]) {
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const logo = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (logo && logo.size <= 256 * 1024) {
        const bytes = new Uint8Array(await logo.arrayBuffer());
        return bytes.toBase64 ? bytes.toBase64() : await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result.split(',')[1]);
          reader.onerror = () => reject(new Error('อ่านไฟล์โลโก้ไม่ได้'));
          reader.readAsDataURL(logo);
        });
      }
    }
    throw new Error('รูปมีรายละเอียดมากเกินไป กรุณาเลือกภาพที่เล็กลง');
  } finally {
    image.close();
  }
}

function previewImage(form, kind) {
  const image = form.querySelector(`#shop-${kind}-preview`);
  const placeholder = form.querySelector(`#shop-${kind}-placeholder`);
  const file = form.elements[kind + '_file'].files[0];
  const remove = form.elements['remove_' + kind]?.checked;
  const url = file && !remove ? URL.createObjectURL(file) : null;
  const src = url || (!remove && state.settings[kind + '_id'] ? logoUrl(state.settings[kind + '_id']) : '');
  if (image.dataset.previewUrl) URL.revokeObjectURL(image.dataset.previewUrl);
  image.dataset.previewUrl = url || '';
  if (src) {
    image.src = src;
    if (url) image.decode().catch(() => {}).finally(() => URL.revokeObjectURL(url));
  } else image.removeAttribute('src');
  image.hidden = !src;
  placeholder.hidden = Boolean(src);
}

async function submit(name, data) {
  const id = data.id;
  switch (name) {
    case 'login': await api('/login', data); return start();
    case 'setup': await api('/setup', data); auth(true); notify('สร้างบัญชีเจ้าของแล้ว เข้าสู่ระบบเพื่อเริ่มใช้งาน'); return;
    case 'scan': {
      const search = data.search.trim().toLowerCase();
      if (!search) return;
      const active = state.products.filter(p => p.active);
      const p = active.find(p => p.barcode?.toLowerCase() === search) || active.find(p => p.sku.toLowerCase() === search);
      if (!p) { notify('ไม่พบ SKU หรือบาร์โค้ดนี้', true); return; }
      add(p.id, 1);
      state.search = '';
      document.querySelector('#search').value = '';
      document.querySelector('#tiles').innerHTML = catalogTiles();
      return;
    }
    case 'category': await api('/categories', data); break;
    case 'product': {
      const price = cents(data.price);
      if (price === null) throw new Error('กรุณาใส่ราคาด้วยตัวเลข ทศนิยมไม่เกิน 2 ตำแหน่ง');
      await api('/products' + (id ? '/' + id : ''), {
        ...data, price, category_id: Number(data.category_id), low_stock: Number(data.low_stock), active: data.active === 'on'
      }, id ? 'PUT' : 'POST');
      break;
    }
    case 'stock': await api('/products/' + id + '/stock', { ...data, quantity: Number(data.quantity) }); break;
    case 'profile': {
      const { logo_file, photo_file, remove_logo, remove_photo, ...profile } = data;
      profile.published = profile.published === 'on';
      for (const [kind, file, remove] of [['logo', logo_file, remove_logo], ['photo', photo_file, remove_photo]]) {
        if (remove) profile[kind] = null;
        else if (file?.size) profile[kind] = await prepareLogo(file);
      }
      await api('/profile', profile, 'PUT');
      break;
    }
    case 'settings': await api('/settings', { ...data, paper: Number(data.paper) }, 'PUT'); break;
    case 'staff':
      await api('/staff' + (id ? '/' + id : ''), { ...data, active: data.active === 'on' }, id ? 'PUT' : 'POST');
      state.staff = await api('/staff');
      break;
    case 'password': await api('/password', data); break;
    case 'void':
      showReceipt(await api('/sales/' + id + '/void', data));
      await loadSales();
      await loadCatalog();
      render();
      notify('ยกเลิกบิลและคืนสต็อกแล้ว');
      return;
  }
  if (modal.open) modal.close();
  await loadCatalog();
  render();
  notify('บันทึกแล้ว');
}

async function handleError(error, target) {
  if (error.status === 401 && state.user) {
    if (modal.open) modal.close();
    printArea.replaceChildren();
    state.user = null;
    await start().catch(() => auth(true));
    notify('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง', true);
  } else if (target) target.textContent = error.message;
  else notify(error.message, true);
}

document.addEventListener('click', async event => {
  const target = event.target.closest('[data-act]');
  if (!target || target.disabled || state.busy) return;
  try { await perform(target.dataset.act, target.dataset.id); }
  catch (error) { await handleError(error); }
});

document.addEventListener('input', event => {
  const { name, value, checked } = event.target;
  if (name === 'search') {
    state.search = value;
    document.querySelector('#tiles').innerHTML = catalogTiles();
  }
  if (name === 'received') {
    state.paid = value;
    document.querySelector('#change').textContent = money(Math.max(0, (cents(value) ?? 0) - totalCart()));
  }
  if (name === 'confirmed') state.confirmed = checked;
  if (name === 'reference') state.reference = value;
});

document.addEventListener('change', async event => {
  const control = event.target;
  const upload = control.name?.match(/^(?:(logo|photo)_file|remove_(logo|photo))$/);
  if (upload) {
    const kind = upload[1] || upload[2];
    const form = control.form;
    const remove = form.elements['remove_' + kind];
    const error = form.querySelector('[data-error]');
    error.textContent = '';
    if (upload[1] && control.files[0]) {
      try {
        validateLogoFile(control.files[0]);
        if (remove) remove.checked = false;
      } catch (problem) {
        control.value = '';
        error.textContent = problem.message;
      }
    }
    if (upload[2] && control.checked) form.elements[kind + '_file'].value = '';
    previewImage(form, kind);
    return;
  }
  if (event.target.name !== 'report-date' || !event.target.value) return;
  state.day = event.target.value;
  state.sales = [];
  state.summary = {};
  state.next = null;
  try { await loadSales(); }
  catch (error) { await handleError(error); }
  if (state.user && state.view === 'sales') render();
});

document.addEventListener('submit', async event => {
  const target = event.target;
  if (!target.dataset.form) return;
  event.preventDefault();
  if (target.dataset.busy) return;
  target.dataset.busy = 'true';
  const errorBox = target.querySelector('[data-error]');
  if (errorBox) errorBox.textContent = '';
  const submitButton = target.querySelector('[type=submit]');
  if (submitButton) submitButton.disabled = true;
  try { await submit(target.dataset.form, Object.fromEntries(new FormData(target))); }
  catch (error) { await handleError(error, errorBox); }
  finally {
    if (submitButton) submitButton.disabled = false;
    delete target.dataset.busy;
  }
});

for (const event of ['online', 'offline']) {
  window.addEventListener(event, () => {
    const connection = document.querySelector('#connection');
    if (connection) connection.innerHTML = onlineIndicator();
  });
}

start().catch(error => {
  app.innerHTML = `<main class="auth-form"><h2>เปิดระบบไม่สำเร็จ</h2><p class="error">${esc(error.message)}</p><p><a href="${posPath}">ลองใหม่</a></p></main>`;
});
