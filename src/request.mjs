class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function requireThat(condition, message = 'ข้อมูลไม่ถูกต้อง', status = 400) {
  if (!condition) throw new HttpError(status, message);
}

function field(value, max, min = 0) {
  requireThat(typeof value === 'string', 'กรุณากรอกข้อมูลให้ครบ');
  const result = value.trim();
  requireThat(result.length >= min && result.length <= max, 'ความยาวของข้อมูลไม่ถูกต้อง');
  return result;
}

async function readText(request, limit) {
  const reader = request.body?.getReader();
  requireThat(reader, 'ไม่พบข้อมูล');
  const decoder = new TextDecoder();
  let size = 0;
  let value = '';
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    size += chunk.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new HttpError(413, 'ข้อมูลมีขนาดใหญ่เกินไป');
    }
    value += decoder.decode(chunk, { stream: true });
  }
  return value + decoder.decode();
}

export { HttpError, requireThat, field, readText };

export async function rateLimit(db, key, limit) {
  const bucket = Math.floor(Date.now() / (15 * 60_000));
  const row = await db.prepare(`
    INSERT INTO login_attempts (key, bucket, attempts) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET attempts =
      CASE WHEN bucket = excluded.bucket THEN min(attempts + 1, ?) ELSE 1 END,
      bucket = excluded.bucket
    RETURNING attempts
  `).bind(key, bucket, limit + 1).first();
  requireThat(row.attempts <= limit, 'ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่', 429);
}

