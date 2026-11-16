import { icon } from '../public/icons.js';
import { accountRoute } from './accounts.mjs';
import { page, text } from './market-ui.mjs';

const validSlug = /^[a-z0-9][a-z0-9-]{0,47}$/;
const shopRoute = /^\/shops\/([a-z0-9][a-z0-9-]{0,47})(\/.*)?$/;
function available(shop, now) {
  return shop.enabled === true && Date.parse(shop.expiresAt) > now;
}

function directory(shops, now) {
  const links = Object.entries(shops).filter(([slug, shop]) => validSlug.test(slug) && available(shop, now))
    .map(([slug, shop]) => `<li><a class="shop-card" href="/shops/${slug}/">
      <span class="tile-icon">${icon('market')}</span><strong>${text(shop.label)}</strong>
      <span class="card-link">ดูหน้าร้าน ${icon('arrow')}</span></a></li>`);
  return page('ตลาดออนไลน์', `<section class="hero market-hero">
    <p class="eyebrow">${icon('market')} COUNTER MARKET</p>
    <h1>เดินตลาดออนไลน์</h1><p>พบร้านค้าและติดต่อร้านได้โดยตรง หรือสมัครเพื่อเปิดร้านของคุณเอง</p>
    <div class="cta-row"><a class="primary" href="#shops">${icon('market')} เลือกร้าน</a>
    <a class="secondary" href="/tenant/register/">${icon('plus')} สมัครเปิดร้าน</a></div></section>
    <section class="directory" id="shops"><div class="section-heading"><div><p class="eyebrow">EXPLORE</p><h2>ร้านในตลาด</h2></div>
    <span class="count">${links.length} ร้าน</span></div>
    ${links.length ? `<ul class="shop-grid">${links.join('')}</ul>` : '<p>ยังไม่มีร้านเปิดให้บริการ</p>'}</section>`);
}

function profile(shop, path) {
  const theme = ['leaf', 'ocean', 'clay'].includes(shop.theme) ? shop.theme : 'leaf';
  const phone = (shop.phone ?? '').replace(/[^0-9+]/g, '');
  const fields = [
    ['โทรศัพท์', shop.phone, phone ? 'tel:' + phone : null],
    ['อีเมล', shop.email, shop.email ? 'mailto:' + encodeURIComponent(shop.email) : null],
    ['LINE ID', shop.line_id], ['ที่อยู่', shop.address]
  ].filter(([, value]) => value);
  return page(shop.name, `<article class="profile ${theme}">
    <p><a href="/">← ร้านทั้งหมด</a></p>
    <section class="hero shop-hero">
      <div><p class="eyebrow">${icon('market')} โปรไฟล์ร้าน</p><h1>${text(shop.name)}</h1><p>${text(shop.tagline)}</p>
      ${shop.logo_id && shop.photo_id ? `<img class="logo mini-logo" src="${path}logo" alt="โลโก้ร้าน">` : ''}
      </div>
      ${shop.photo_id ? `<img class="shop-photo" src="${path}photo" alt="รูปโปรไฟล์ร้าน">` :
        shop.logo_id ? `<img class="logo" src="${path}logo" alt="โลโก้ร้าน">` : ''}
    </section>
    ${shop.description || shop.hours ? `<section class="details"><h2>เกี่ยวกับร้าน</h2>
      ${shop.description ? `<p class="preserve">${text(shop.description)}</p>` : ''}
      ${shop.hours ? `<p class="inline-icon">${icon('clock')} <span>${text(shop.hours)}</span></p>` : ''}</section>` : ''}
    ${fields.length || shop.website ? `<section class="details"><h2>ติดต่อร้าน</h2><dl>${fields.map(([label, value, href]) =>
      `<dt>${label}</dt><dd>${href ? `<a href="${text(href)}">${text(value)}</a>` : text(value)}</dd>`).join('')}</dl>
      ${shop.website && /^https?:\/\//i.test(shop.website) ? `<a class="secondary" href="${text(shop.website)}" target="_blank" rel="noopener noreferrer">${icon('link')} เว็บไซต์ร้าน</a>` : ''}
    </section>` : ''}
    <p class="shop-links"><a href="${path}pos/">${icon('key')} พื้นที่เจ้าของร้านและพนักงาน</a></p>
  </article>`);
}

function unavailable(status = 404) {
  const message = status === 503 ? 'ร้านขัดข้องชั่วคราว' : 'ร้านนี้ยังไม่เปิดให้บริการ';
  return page(message, `<section class="hero"><h1>${message}</h1><a href="/">กลับหน้าตลาด</a></section>`, status);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (['/admin', '/tenant'].includes(url.pathname) && request.method === 'GET') {
      url.pathname += '/';
      return Response.redirect(url, 308);
    }
    if (/^\/(?:admin|tenant)\//.test(url.pathname)) return accountRoute(request, env, url);
    const route = url.pathname.match(shopRoute);
    const safe = request.method === 'GET' || request.method === 'HEAD';
    const shops = env.SHOPS ?? {};
    const now = Date.now();
    if (safe && url.pathname === '/') return directory(shops, now);
    if (!route) {
      if (/^\/pos(?:\.html|\/)?$/i.test(url.pathname)) return unavailable();
      return publicPage(request, env.ASSETS, url);
    }

    const [, slug, suffix] = route;
    const path = `/shops/${slug}/`;
    const api = suffix?.startsWith('/pos/api/');
    const shop = Object.hasOwn(shops, slug) ? shops[slug] : null;
    const backend = shop && env[shop.binding];
    if (!shop || !available(shop, now) || typeof backend?.fetch !== 'function') {
      return api ? Response.json({ error: 'ร้านนี้ยังไม่เปิดให้บริการ' }, {
        status: 404, headers: { 'Cache-Control': 'no-store' }
      }) : unavailable();
    }

    if (api) {
      try { return await backend.fetch(request); }
      catch (error) {
        console.error('Shop backend unavailable', slug, error.message);
        return Response.json({ error: 'ระบบขัดข้องชั่วคราว กรุณาลองใหม่' }, {
          status: 503, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }
        });
      }
    }
    if (!safe) return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
    if (!suffix || suffix === '/pos') {
      url.pathname += '/';
      return Response.redirect(url, 308);
    }
    if (suffix === '/pos/') {
      url.pathname = '/pos';
      const asset = await env.ASSETS.fetch(new Request(url, { method: request.method }));
      const headers = new Headers(asset.headers);
      headers.set('X-Robots-Tag', 'noindex');
      return new Response(asset.body, { status: asset.status, headers });
    }
    const publicAsset = suffix === '/logo' || suffix === '/photo';
    if (suffix !== '/' && !publicAsset) return unavailable();
    url.pathname = path + 'pos/api/public-' + (publicAsset ? suffix.slice(1) : 'profile');
    try {
      const result = await backend.fetch(new Request(url));
      if (result.status === 404) {
        if (publicAsset) return result;
        return page('โปรไฟล์ร้าน', `<section class="hero"><h1>ร้านยังไม่ได้เผยแพร่โปรไฟล์</h1>
          <p><a href="${path}pos/">เข้าสู่ POS สำหรับเจ้าของร้านและพนักงาน</a></p></section>`, 404);
      }
      if (!result.ok) return unavailable(503);
      if (publicAsset) return request.method === 'HEAD' ? new Response(null, result) : result;
      return profile(await result.json(), path);
    } catch (error) {
      console.error('Shop profile unavailable', slug, error.message);
      return unavailable(503);
    }
  }
};

async function publicPage(request, assets, url) {
  const { pathname, origin } = url;
  if (request.method !== 'GET' && request.method !== 'HEAD') return assets.fetch(request);
  if (pathname === '/about' || pathname === '/about/index.html') {
    url.pathname = '/about/';
    return Response.redirect(url, 308);
  }
  if (pathname === '/robots.txt' || pathname === '/sitemap.xml') {
    const robots = pathname === '/robots.txt';
    const sitemapLocation = new URL('/about/', origin).href.replaceAll('&', '&amp;');
    const body = robots
      ? `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /tenant/\nSitemap: ${origin}/sitemap.xml\n`
      : `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${sitemapLocation}</loc></url><url><loc>${origin}/</loc></url></urlset>\n`;
    return new Response(request.method === 'HEAD' ? null : body, {
      headers: {
        'Content-Type': robots ? 'text/plain; charset=utf-8' : 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  }
  if (pathname !== '/about/') return assets.fetch(request);
  const page = await assets.fetch(new Request(origin + '/about/', { method: request.method }));
  if (!page.ok || request.method === 'HEAD') return page;
  const canonical = origin + '/about/';
  return new HTMLRewriter()
    .on('link[rel="canonical"]', { element: el => el.setAttribute('href', canonical) })
    .on('meta[property="og:url"]', { element: el => el.setAttribute('content', canonical) })
    .on('meta[property="og:image"]', { element: el => el.setAttribute('content', origin + '/counter-pos-preview.png') })
    .transform(page);
}

