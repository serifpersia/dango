const MEDIA_HEADER = 20
const MEDIA = 21
const STREAM_PROTECTION_STATUS = 58

export interface UmpCarry {
  pendingType: number
  remaining: number
  chunks: Buffer[]
}

export interface UmpResult {
  media: Buffer
  status: number
  carry: UmpCarry | null
}

function readVarint(buf: Buffer, pos: number): [number, number] | null {
  if (pos >= buf.length) return null
  const prefix = buf[pos]
  let size = 0
  for (let shift = 1; shift <= 5; shift++) {
    if ((prefix & (128 >> (shift - 1))) === 0) {
      size = shift
      break
    }
  }
  if (size < 1 || pos + size > buf.length) return null
  if (size === 1) return [prefix, pos + 1]
  if (size === 5) {
    const value = buf[pos + 1] + buf[pos + 2] * 256 + buf[pos + 3] * 65536 + buf[pos + 4] * 16777216
    return [value >>> 0, pos + 5]
  }
  const lowBits = 8 - size
  let value = prefix & ((1 << lowBits) - 1)
  for (let i = 1; i < size; i++) {
    value += buf[pos + i] * 2 ** (lowBits + 8 * (i - 1))
  }
  return [value, pos + size]
}

function readStatusField(payload: Buffer): number {
  let pos = 0
  while (pos < payload.length) {
    const key = payload[pos++]
    const field = key >> 3
    const wire = key & 7
    if (wire !== 0) break
    const decoded = readVarint(payload, pos)
    if (!decoded) break
    if (field === 1) return decoded[0]
    pos = decoded[1]
  }
  return 1
}

export function parseUmpResponse(buf: Buffer, carry: UmpCarry | null): UmpResult {
  const mediaChunks: Buffer[] = []
  let status = 1
  let nextCarry: UmpCarry | null = carry
  let pos = 0

  if (nextCarry) {
    const t = readVarint(buf, pos)
    const s = t && readVarint(buf, t[1])
    if (t && s && t[0] === MEDIA_HEADER) {
      pos = s[1] + s[0]
    }
    const ct = readVarint(buf, pos)
    const cs = ct && readVarint(buf, ct[1])
    if (ct && cs && ct[0] === nextCarry.pendingType) {
      pos = cs[1]
      const take = Math.min(cs[0], buf.length - pos)
      nextCarry.chunks.push(buf.subarray(pos, pos + take))
      nextCarry.remaining = cs[0] - take
      pos += take
      if (nextCarry.remaining <= 0) {
        const full = Buffer.concat(nextCarry.chunks)
        nextCarry = null
        if (ct[0] === MEDIA && full.length > 1) mediaChunks.push(full.subarray(1))
      }
    } else {
      nextCarry = null
    }
  }

  while (pos < buf.length) {
    const t = readVarint(buf, pos)
    if (!t) break
    const s = readVarint(buf, t[1])
    if (!s) break
    const [type, size] = [t[0], s[0]]
    pos = s[1]
    const available = buf.length - pos
    if (size > available) {
      nextCarry = {
        pendingType: type,
        remaining: size - available,
        chunks: [buf.subarray(pos)],
      }
      break
    }
    const payload = buf.subarray(pos, pos + size)
    pos += size
    if (type === MEDIA) {
      if (payload.length > 1) mediaChunks.push(payload.subarray(1))
    } else if (type === STREAM_PROTECTION_STATUS) {
      status = readStatusField(payload)
    }
  }

  return { media: Buffer.concat(mediaChunks), status, carry: nextCarry }
}
