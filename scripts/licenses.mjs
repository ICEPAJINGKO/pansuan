/**
 * Regenerates the third-party notices from what is actually installed.
 *
 * Only the runtime dependency graph is walked — devDependencies build the app
 * but never ship inside it, so their licences carry no distribution duty. Run
 * it again whenever dependencies change: `npm run licenses`.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const OUT = join(ROOT, 'public', 'third-party-notices.txt')
const LICENCE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'license']

const read = (path) => JSON.parse(readFileSync(path, 'utf8'))

function packageDir(name) {
  const dir = join(ROOT, 'node_modules', name)
  return existsSync(join(dir, 'package.json')) ? dir : null
}

/** Every package that ends up inside the bundle, in dependency order. */
function collect(names, seen = new Map()) {
  for (const name of names) {
    if (seen.has(name)) continue
    const dir = packageDir(name)
    if (!dir) continue
    const pkg = read(join(dir, 'package.json'))
    seen.set(name, { pkg, dir })
    collect(Object.keys(pkg.dependencies ?? {}), seen)
  }
  return seen
}

function licenceText(dir) {
  for (const file of LICENCE_FILES) {
    const path = join(dir, file)
    if (existsSync(path)) return readFileSync(path, 'utf8').trim()
  }
  return null
}

const root = read(join(ROOT, 'package.json'))
const found = collect(Object.keys(root.dependencies ?? {}))

const parts = [
  'THIRD-PARTY NOTICES',
  '',
  `Portovanta bundles the open-source packages listed below. Each keeps its own`,
  `copyright and licence; the notices are reproduced here because their licences`,
  `require it. Nothing in this file limits the rights of those copyright holders,`,
  `and nothing here is claimed by the Portovanta copyright holder.`,
  '',
  `Generated from the installed dependency tree — regenerate with: npm run licenses`,
  '',
  '='.repeat(78),
  '',
]

for (const [name, { pkg, dir }] of [...found].sort(([a], [b]) => a.localeCompare(b))) {
  const licence = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'see below')
  const text = licenceText(dir)
  parts.push(`${name}@${pkg.version} — ${licence}`)
  if (pkg.homepage) parts.push(pkg.homepage)
  parts.push('')
  parts.push(text ?? '(no licence file shipped with this package)')
  parts.push('')
  parts.push('-'.repeat(78))
  parts.push('')
}

parts.push(
  'FONTS',
  '',
  'Space Grotesk, IBM Plex Sans Thai and JetBrains Mono are loaded at runtime from',
  'Google Fonts and are not redistributed with this app. All three are published',
  'under the SIL Open Font License 1.1. Self-hosting them instead would mean',
  'shipping the OFL text alongside the font files.',
  '',
)

writeFileSync(OUT, parts.join('\n'))
console.log(`wrote ${OUT}`)
console.log([...found.keys()].join(', '))
