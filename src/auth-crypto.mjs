const encoder = new TextEncoder();
const ITERATIONS = 100_000;

function hex(bytes) {
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

async function digest(value) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

function same(a, b) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    difference |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return difference === 0;
}

async function passwordHash(password, salt = hex(crypto.getRandomValues(new Uint8Array(16)))) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bytes = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: encoder.encode(salt), iterations: ITERATIONS, hash: 'SHA-256' }, key, 256
  );
  return salt + '.' + hex(bytes);
}

export { hex, digest, same, passwordHash };
