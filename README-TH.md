# ติดตั้ง Counter Market / Counter POS ใน Cloudflare บัญชีใหม่

แพ็กเกจเวอร์ชัน 16 พฤศจิกายน 2569 มีหน้าตลาด โปรไฟล์ร้าน พื้นหลังไล่สี ระบบสมัครผู้เช่าและอนุมัติ แยกเมนูเจ้าของร้านและพนักงาน พร้อมตัวแก้ฟอร์มสมัครสมาชิก

แพ็กเกจนี้เริ่มจากฐานข้อมูลใหม่ เมื่อติดตั้งแล้วให้สร้างบัญชีเจ้าของร้านและรหัสผู้ดูแลใหม่ หากต้องการข้อมูลสินค้า บิล สต็อก และสมาชิกจากบัญชีเดิม ต้องวางแผนย้ายข้อมูล D1 เพิ่มเติม

## 1. เตรียมเครื่องและเข้าสู่บัญชีปลายทาง

ติดตั้ง Node.js รุ่น LTS ที่รองรับโครงการ รุ่นขั้นต่ำ 22.13.0 จาก https://nodejs.org/ จากนั้นแตก ZIP ไปยังโฟลเดอร์ใหม่ เช่น C:\CounterMarket แล้วเปิด PowerShell ในโฟลเดอร์ counter-pos ที่มี package.json

```powershell
npm ci
npx wrangler login --browser false
```

คัดลอกลิงก์ที่แสดงไปเปิดในเบราว์เซอร์ที่เข้าสู่บัญชี Cloudflare ปลายทาง กด Allow แล้วกลับมาตรวจ

```powershell
npx wrangler whoami
```

ตรวจอีเมลให้ตรงกับบัญชีที่จะติดตั้ง หาก Wrangler แสดง Active profile ของบัญชีเดิม ให้รัน npx wrangler auth deactivate ในโฟลเดอร์นี้ แล้ว login และ whoami ใหม่

## 2. ใส่ Account ID และสร้าง D1 สองฐาน

นำ Account ID จาก whoami ไปแทน 00000000000000000000000000000000 ใน account_id ของทั้งสองไฟล์

| ไฟล์ | Worker | ฐานข้อมูล |
| --- | --- | --- |
| wrangler.jsonc | counter-pos สำหรับหน้าเว็บตลาด | counter-pos-market-accounts สำหรับผู้เช่าและใบสมัคร |
| wrangler.backend.jsonc | counter-pos-store สำหรับ API ร้าน | counter-pos สำหรับข้อมูล POS |

สร้างฐานในบัญชีที่ตรวจแล้ว

```powershell
npx wrangler d1 create counter-pos
npx wrangler d1 create counter-pos-market-accounts
```

คัดลอก database_id ที่ได้ไปแทน 00000000-0000-0000-0000-000000000000 ตามตารางด้านบน คง binding เป็น DB ในไฟล์ Back-end และ MARKET_DB ในไฟล์ Front-end

หากชื่อ Worker หรือฐานข้อมูลมีอยู่แล้วในบัญชีปลายทาง ให้เลือกชื่อใหม่ก่อนติดตั้ง หากเปลี่ยนชื่อ Back-end ต้องแก้ services[0].service ใน wrangler.jsonc ให้ตรงกับ name ของ Back-end ด้วย

แก้ชื่อร้านที่แสดงในตลาดใน vars.SHOPS.demo.label และวันหมดอายุใน expiresAt ของ wrangler.jsonc ตัวอย่างตั้งไว้ถึง 1 มกราคม 2030 เวลาไทย

## 3. สร้างตารางและติดตั้ง Back-end

```powershell
npm run db:remote
npm run market:remote
npm run deploy:backend
npx wrangler secret put SETUP_KEY -c wrangler.backend.jsonc
```

เมื่อคำสั่งสุดท้ายถามค่า ให้กรอกรหัสสุ่มอย่างน้อย 24 ตัวอักษรและเก็บไว้สำหรับตั้งค่าร้านครั้งแรก สร้างค่าของตัวเองได้ด้วย PowerShell

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Back-end ติดต่อผ่าน Service Binding และใช้ workers_dev กับ preview_urls เป็น false ตามไฟล์ตั้งค่า

## 4. ติดตั้งหน้าเว็บและตั้งรหัสผู้ดูแลตลาด

```powershell
npm run deploy
npx wrangler secret put MARKET_ADMIN_KEY
```

สร้างรหัสสุ่มอีกชุดยาวอย่างน้อย 32 ตัวอักษรด้วยคำสั่งสร้างรหัสด้านบน แล้วกรอกเมื่อถามค่า เก็บรหัสนี้ไว้ใช้หน้า /admin/

Wrangler จะแสดง URL ของเว็บ เช่น https://counter-pos.<subdomain-ของบัญชีใหม่>.workers.dev

## 5. เปิดใช้งานร้าน

| เส้นทางต่อท้าย URL | การใช้งาน |
| --- | --- |
| / | ตลาดออนไลน์ |
| /tenant/register/ | สมัครผู้เช่าร้าน |
| /tenant/ | เข้าสู่บัญชีผู้เช่าและติดตามผล |
| /admin/ | ผู้ดูแลตลาด ใช้ MARKET_ADMIN_KEY |
| /shops/demo/ | โปรไฟล์ร้านสาธารณะ |
| /shops/demo/pos/ | POS สำหรับเจ้าของและพนักงาน |

เปิด /shops/demo/pos/ กรอก SETUP_KEY ชื่อร้าน ชื่อเจ้าของ ชื่อผู้ใช้ และรหัสผ่านอย่างน้อย 12 ตัวอักษร แล้วเข้าสู่ระบบ

ไปที่ โปรไฟล์ร้าน เพื่อใส่โลโก้ รูปโปรไฟล์ ข้อมูลติดต่อ เวลาเปิด คำแนะนำร้าน เว็บไซต์ และธีมสี เลือกเผยแพร่โปรไฟล์แล้วบันทึกจึงจะแสดงข้อมูลร้านต่อสาธารณะ

เพิ่มสินค้าและรับสต็อกใน สินค้าและสต็อก สร้างแคชเชียร์ที่ บัญชีพนักงาน และกำหนด PromptPay กับขนาดใบเสร็จที่ ตั้งค่าการขาย เมื่อสร้างบัญชีเจ้าของเรียบร้อยแล้ว ลบรหัสตั้งค่าแรกออกจาก Worker

```powershell
npx wrangler secret delete SETUP_KEY -c wrangler.backend.jsonc
```

ผู้เช่าสมัครแล้วเข้าสู่ระบบเพื่อติดตามผล ผู้ดูแลเปิด /admin/ ตรวจใบสมัครและเลือกร้านที่เตรียมไว้เพื่ออนุมัติ บัญชีผู้เช่าและบัญชี POS ใช้แยกกัน เจ้าของใช้บัญชี POS ที่สร้างไว้ในร้าน พนักงานใช้บัญชีที่เจ้าของสร้าง

ผู้ดูแลเพิ่มร้านอื่นด้วย Back-end Worker และ D1 ใหม่ต่อร้าน แล้วเพิ่ม Service Binding กับรายการ SHOPS ใน Front-end ก่อนอนุมัติผู้เช่า การเก็บค่าเช่า การสร้างร้านอัตโนมัติ และการส่งอีเมลกู้รหัสผ่านยังเป็นส่วนที่ต้องพัฒนาต่อ

## ทดลองในเครื่อง

```powershell
Copy-Item .dev.vars.example .dev.vars
```

แก้ SETUP_KEY และ MARKET_ADMIN_KEY ใน .dev.vars เป็นรหัสของคุณ แล้วรัน

```powershell
npm run db:local
npm run market:local
npm run dev
```

เปิด http://localhost:8787/ ค่า .dev.vars ใช้สำหรับทดลองในเครื่อง ส่วนการติดตั้งจริงตั้งผ่าน wrangler secret put ตามขั้นตอนด้านบน

## อ้างอิง Cloudflare

- [D1 CLI และ migrations](https://developers.cloudflare.com/workers/wrangler/commands/d1/)
- [Wrangler login และ whoami](https://developers.cloudflare.com/workers/wrangler/commands/general/)
- [Workers Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)
