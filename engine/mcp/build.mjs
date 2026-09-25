/**
 * Bundle the MCP server into one portable file.
 *
 * `tsc` alone is not enough: it emits imports of the workspace packages, which
 * are TypeScript source that Node cannot load. Anyone installing the server with
 * `claude mcp add` would get ERR_MODULE_NOT_FOUND. A single self-contained file
 * has no workspace to resolve and no tsx to install.
 *
 * Two details the bundle needs:
 *   - the shebang must be the very first line, so it lives in the banner;
 *   - some dependencies are CommonJS and call `require()` for node builtins,
 *     which an ESM bundle has no definition for — hence the createRequire shim.
 */
import { build } from 'esbuild'
import { chmod } from 'node:fs/promises'

const OUT = 'dist/knowledge-mcp.mjs'

await build({
  entryPoints: ['src/index.ts'],
  outfile: OUT,
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'esm',
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __createRequire } from 'node:module'",
      'const require = __createRequire(import.meta.url)',
    ].join('\n'),
  },
  logLevel: 'warning',
})

await chmod(OUT, 0o755)
console.log(`bundled -> ${OUT}`)
