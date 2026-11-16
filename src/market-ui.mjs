import { icon } from '../public/icons.js';

export const text = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function page(title, body, status = 200, area = 'public') {
  const account = area === 'admin' || area === 'tenant';
  const links = account
    ? '<a href="/tenant/">' + icon('user') + ' ผู้เช่าร้าน</a><a href="/admin/">' + icon('shield') + ' ผู้ดูแลตลาด</a>'
    : '<a href="/tenant/">' + icon('user') + ' พื้นที่ผู้เช่าร้าน</a>';
  return new Response(`<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${text(title)} · Counter Market</title><link rel="icon" href="/counter-pos-icon.svg">
<link rel="stylesheet" href="/market.css"></head>
<body class="area-${area}"><a class="skip-link" href="#content">ข้ามไปยังเนื้อหา</a>
<header class="site-header"><a class="wordmark" href="/">${icon('market')} <span>Counter Market<small>ตลาดออนไลน์</small></span></a>
<nav aria-label="เมนูหลัก">${links}</nav></header>
<main id="content">${body}</main>
<footer class="site-footer"><a href="/about/">เกี่ยวกับ Counter POS</a>
<a href="/admin/">${icon('shield')} ผู้ดูแลตลาด</a></footer></body></html>`, { status, headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(account ? { 'X-Robots-Tag': 'noindex' } : {}),
    // Native form POSTs need the browser to send a same-origin Origin header.
    'Referrer-Policy': account ? 'same-origin' : 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  } });
}
