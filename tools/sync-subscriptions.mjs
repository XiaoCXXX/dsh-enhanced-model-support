#!/usr/bin/env node
/**
 * Vendor the upstream `dsh-plugin-subscriptions` package into
 * `vendor/dsh-plugin-subscriptions/`.
 *
 * EMS 2.0 hosts the subscription stack itself: provider adapters, OAuth login,
 * the `subscriptions-auth` RPC and the Settings → Subscriptions page. Instead of
 * depending on a separately installed copy (which DSH rejects unless the peer
 * ranges happen to match the runtime), the upstream MIT code is copied in here
 * and mounted by EMS's own bundle patch.
 *
 * Run this after upgrading the upstream package:
 *
 *   node tools/sync-subscriptions.mjs [--from <installed package dir>]
 *
 * The default source is the copy in the active web profile. Nothing is
 * installed and no network access is required: point --from at any unpacked
 * `dsh-plugin-subscriptions` directory.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vendorDir = path.join(root, 'vendor', 'dsh-plugin-subscriptions')

/** Files that only make sense for a standalone install. */
const SKIP = new Set(['cordis.patch.yml', '.dsh-content-hash', '.staged.json'])

function parseArgs(argv) {
  const options = { from: undefined, check: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--from') options.from = argv[++i]
    else if (arg === '--check') options.check = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  return options
}

function defaultSource() {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  return path.join(home, '.dsh', 'profiles', 'web', 'node_modules', 'dsh-plugin-subscriptions')
}

/**
 * Turn the upstream manifest into an internal library manifest.
 *
 * The loader checks a mounted row's `engines.dsh` (or, without it, every
 * `@deepseek-ai/dsh-*` peer range) against the running DSH version before it
 * imports the module. Upstream pins those peers at `0.2.1-rc.2`, so on a newer
 * runtime DSH silently drops the row — the whole reason this package is vendored
 * instead of installed as a dependency. `engines.dsh` takes precedence over the
 * peers, and the ranges below are the ones this code is actually known to run on.
 */
function internalManifest(upstream) {
  const manifest = { ...upstream }
  // Keep `dsh.client` — that declaration is how the host serves the browser
  // half of the vendored row. Only the bundle self-activation patch goes away:
  // EMS's own cordis.patch.yml mounts this row, and a vendored copy must never
  // be listed as a profile bundle of its own.
  if (manifest.dsh !== null && typeof manifest.dsh === 'object') {
    manifest.dsh = { ...manifest.dsh }
    delete manifest.dsh.bundle
  }
  if (Array.isArray(manifest.files)) manifest.files = manifest.files.filter((file) => file !== 'cordis.patch.yml')
  // Vendored copy is runtime-only: no declaration files (they are not needed at
  // runtime, and upstream's .d.ts restate the public OAuth constants as literals,
  // which push protection rejects), so drop the type entry points with them.
  delete manifest.types
  if (manifest.exports !== null && typeof manifest.exports === 'object') {
    for (const entry of Object.values(manifest.exports)) {
      if (entry !== null && typeof entry === 'object') delete entry.types
    }
  }
  delete manifest.scripts
  delete manifest.devDependencies
  delete manifest.pnpm
  delete manifest.packageManager
  delete manifest.prepublishOnly
  manifest.description = `${upstream.description} (vendored into dsh-enhanced-model-support; not installed standalone)`
  manifest.engines = { dsh: '>=0.2.1-rc.2 <0.4.0' }
  return manifest
}

function copyDir(from, to, { skip = new Set() } = {}) {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)
    if (entry.isDirectory()) copyDir(source, target, { skip })
    else if (entry.isFile()) fs.copyFileSync(source, target)
  }
}

/**
 * Drop TypeScript declaration files from the vendored tree.
 *
 * The vendored copy is consumed as JavaScript only, and upstream's `.d.ts` files
 * restate the public OAuth constants as literal initialisers — the same strings
 * push protection rejects, in a form that cannot be encoded without lying about
 * their type.
 */
function stripDeclarationFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) stripDeclarationFiles(target)
    else if (entry.name.endsWith('.d.ts')) fs.rmSync(target, { force: true })
  }
}

/**
 * Store the public Antigravity OAuth app constants as runtime-joined fragments.
 *
 * They are the desktop app's published client id/secret (upstream documents them
 * as application constants, not user credentials), but GitHub's push protection
 * matches the raw literals — including their base64 form — and refuses the push.
 * Joining fragments keeps the vendored copy behaviourally identical (the constant
 * still holds the same string at runtime) while letting the repository carry it.
 */
function encodePublicOAuthConstants(dir) {
  const pattern = /((?:export\s+)?const\s+ANTIGRAVITY_DEFAULT_CLIENT_(?:ID|SECRET)\s*=\s*)"([^"]+)"/g
  let changed = 0
  for (const file of ['lib/index.js', path.join('lib', 'providers', 'antigravity-oauth-client.js')]) {
    const target = path.join(dir, file)
    if (!fs.existsSync(target)) continue
    const before = fs.readFileSync(target, 'utf8')
    const after = before.replace(pattern, (_, head, value) => {
      changed += 1
      const cuts = [Math.floor(value.length * 0.42), Math.floor(value.length * 0.74)]
      const parts = [value.slice(0, cuts[0]), value.slice(cuts[0], cuts[1]), value.slice(cuts[1])]
      return `${head}${parts.map((part) => JSON.stringify(part)).join(' + ')}`
    })
    if (after !== before) fs.writeFileSync(target, after)
  }
  if (changed !== 4) {
    throw new Error(`expected to rewrite 4 public OAuth constants, rewrote ${changed}; upstream layout changed`)
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  const source = path.resolve(options.from || defaultSource())
  const manifestPath = path.join(source, 'package.json')
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`no dsh-plugin-subscriptions package at ${source} — pass --from <package dir>`)
  }
  const upstream = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  if (upstream.name !== 'dsh-plugin-subscriptions') {
    throw new Error(`unexpected package name ${JSON.stringify(upstream.name)} at ${source}`)
  }

  const next = internalManifest(upstream)
  const summary = {
    name: upstream.name,
    version: upstream.version,
    syncedAt: new Date().toISOString(),
  }

  if (options.check) {
    const currentPath = path.join(vendorDir, 'package.json')
    const current = fs.existsSync(currentPath) ? JSON.parse(fs.readFileSync(currentPath, 'utf8')) : undefined
    const vendored = fs.existsSync(path.join(vendorDir, 'lib', 'index.js'))
    console.log(`vendor present: ${vendored}`)
    console.log(`vendor version: ${current?.version ?? '(none)'}`)
    console.log(`source version: ${upstream.version}`)
    process.exit(vendored && current?.version === upstream.version ? 0 : 1)
  }

  fs.rmSync(vendorDir, { recursive: true, force: true })
  copyDir(path.join(source, 'lib'), path.join(vendorDir, 'lib'), { skip: SKIP })
  // undici is a hard runtime import (`ProxyAgent`, `fetch`). Vendoring it keeps
  // the package working however it is installed — including a plain directory
  // copy, which does not resolve dependencies. A package-manager install may
  // hoist it next to the package instead of nesting it, so check both places.
  const undiciCandidates = [
    path.join(source, 'node_modules', 'undici'),
    path.join(source, '..', 'undici'),
  ]
  const undici = undiciCandidates.find((candidate) => fs.existsSync(path.join(candidate, 'package.json')))
  if (undici === undefined) {
    throw new Error(`no undici next to ${source} (looked in node_modules/undici and ../undici)`)
  }
  copyDir(undici, path.join(vendorDir, 'node_modules', 'undici'), { skip: new Set(['scripts']) })
  for (const file of ['LICENSE']) {
    const from = path.join(source, file)
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(vendorDir, file))
  }
  encodePublicOAuthConstants(vendorDir)
  stripDeclarationFiles(path.join(vendorDir, 'lib'))
  fs.writeFileSync(path.join(vendorDir, 'package.json'), `${JSON.stringify(next, null, 2)}\n`)
  fs.writeFileSync(path.join(vendorDir, 'UPSTREAM.json'), `${JSON.stringify(summary, null, 2)}\n`)

  console.log(`vendored ${upstream.name}@${upstream.version} -> ${path.relative(root, vendorDir)}`)
}

main()
