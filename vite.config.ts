import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/*
 * The build environment, declared just widely enough to read it. Pulling in
 * @types/node for one property would add a dependency to a project that gets by
 * on five, and every other name it brings along is one this file never uses.
 */
declare const process: { env: Record<string, string | undefined> }

/**
 * The origin the document head should point at.
 *
 * og:image and canonical have to be absolute URLs, and a domain is exactly the
 * kind of thing that should not be frozen into source: it changes when the
 * project moves, and a preview deployment is not the production site. Vercel
 * hands its own hostname to the build, so the placeholder is resolved there and
 * a local build still gets something that works.
 */
function siteUrl(): string {
  const explicit = process.env.SITE_URL ?? process.env.VITE_SITE_URL
  if (explicit) return explicit.replace(/\/+$/, '')
  // Vercel: the stable production domain first, the per-deployment host second.
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL
  if (host) return `https://${host.replace(/\/+$/, '')}`
  return 'http://localhost:5173'
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'pansuan-site-url',
      transformIndexHtml: (html) => html.replaceAll('%SITE_URL%', siteUrl()),
    },
  ],
  server: { port: 5173, open: true },
  build: { target: 'es2022' },
})
