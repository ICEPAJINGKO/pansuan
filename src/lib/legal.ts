/**
 * Ownership of the app, in one place.
 *
 * The notice covers Portovanta itself — not the libraries it is built on.
 * React, React-DOM and scheduler ship inside the bundle under the MIT licence
 * and keep their own copyright; a notice here neither claims nor cancels those.
 */
export const OWNER = 'ICEPAJINGKO'
/** First year the work was published, for the range below. */
export const OWNER_SINCE = 2026

/**
 * Where the bundled licences are served. A notice only satisfies MIT if it
 * actually travels with the distributed copy, so it lives in public/ and ships
 * inside dist/ — the app links to it rather than keeping it in the repo alone.
 */
export const NOTICES_URL = `${import.meta.env.BASE_URL}third-party-notices.txt`

/** `© 2026 NAME · สงวนลิขสิทธิ์`, widening to a range as the years pass. */
export function copyrightLine(): string | null {
  const name = OWNER.trim()
  if (!name) return null
  const now = new Date().getFullYear()
  const span = now > OWNER_SINCE ? `${OWNER_SINCE}–${now}` : String(OWNER_SINCE)
  return `© ${span} ${name} · สงวนลิขสิทธิ์`
}
