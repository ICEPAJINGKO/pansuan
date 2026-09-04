const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

export function uid(prefix = 'n'): string {
  let out = ''
  const bytes = new Uint8Array(8)
  crypto.getRandomValues(bytes)
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length]
  return `${prefix}_${out}`
}
