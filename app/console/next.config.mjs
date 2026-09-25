import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'

// Next reads .env from the app directory, not the workspace root, so a monorepo
// ends up with one .env per app. Load the root file here instead — next.config
// is evaluated before compilation, so NEXT_PUBLIC_* values are still inlined.
// Anything already in the environment wins, so `FOO=bar pnpm dev` still works.
config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) })

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // A production build writes into the same directory `next dev` serves from,
  // which leaves a running dev server with a module map that no longer matches
  // disk. Setting NEXT_DIST_DIR lets a verification build go somewhere else.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // The workspace packages ship TypeScript source rather than a build step.
  transpilePackages: ['@knowledge01/core', '@knowledge01/storage', '@knowledge01/repo', '@knowledge01/connect'],
  webpack: (config, { isServer }) => {
    // Those packages use ESM-style `./foo.js` specifiers that resolve to `./foo.ts`
    // on disk. Without this alias webpack looks for files that are never emitted.
    config.resolve.extensionAlias = { ...config.resolve.extensionAlias, '.js': ['.ts', '.tsx', '.js'] }
    // The engine packages publish to npm, so their "exports" point at dist/.
    // This condition selects the TypeScript source instead, which is what makes
    // a change in engine/ visible here without a build step.
    // On the client, `browser` has to stay in the list: without it a package
    // with separate builds (eciesjs's ciphers) resolves its Node build and
    // pulls `node:crypto` into the page.
    config.resolve.conditionNames = ['development', ...(isServer ? [] : ['browser']), ...(config.resolve.conditionNames ?? (isServer ? ['require', 'import', 'node'] : ['import', 'module', 'require']))]
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false }
    }
    return config
  },
}
export default nextConfig
