#!/usr/bin/env node

import { execSync } from 'child_process'
import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')

function usage() {
  console.log(`Usage: node scripts/bump-fork-version.js [options]

Derive this fork's version from the upstream/source version.

Default behavior:
  upstream package version 0.1.44 + current 0.1.44-pi.1 -> 0.1.44-pi.2
  upstream package version 0.1.45 + current 0.1.44-pi.2 -> 0.1.45-pi.1

Options:
  --remote <name>       Upstream git remote name (default: upstream)
  --branch <name>       Upstream branch name (default: main)
  --channel <name>      Fork prerelease channel (default: pi)
  --base <version>      Use an explicit upstream base version instead of git show
  --number <n>          Use an explicit fork build number instead of auto-increment
  --no-fetch            Do not run git fetch before reading the upstream version
  --dry-run             Print the computed version without writing files
  -h, --help            Show this help

Environment overrides:
  FORK_VERSION_REMOTE, FORK_VERSION_BRANCH, FORK_VERSION_CHANNEL
`)
}

function parseArgs(argv) {
  const options = {
    remote: process.env.FORK_VERSION_REMOTE || 'upstream',
    branch: process.env.FORK_VERSION_BRANCH || 'main',
    channel: process.env.FORK_VERSION_CHANNEL || 'pi',
    base: null,
    number: null,
    fetch: true,
    dryRun: false,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    switch (arg) {
      case '--remote':
        options.remote = requireValue(argv, ++i, arg)
        break
      case '--branch':
        options.branch = requireValue(argv, ++i, arg)
        break
      case '--channel':
        options.channel = requireValue(argv, ++i, arg)
        break
      case '--base':
        options.base = requireValue(argv, ++i, arg)
        break
      case '--number':
        options.number = Number.parseInt(requireValue(argv, ++i, arg), 10)
        break
      case '--no-fetch':
        options.fetch = false
        break
      case '--dry-run':
        options.dryRun = true
        break
      case '-h':
      case '--help':
        usage()
        process.exit(0)
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }

  if (!/^[0-9A-Za-z-]+$/.test(options.channel)) {
    throw new Error(
      `Invalid channel "${options.channel}". Use letters, numbers, and hyphens only.`
    )
  }

  if (
    options.number !== null &&
    (!Number.isInteger(options.number) || options.number < 1)
  ) {
    throw new Error('--number must be a positive integer')
  }

  return options
}

function requireValue(argv, index, option) {
  const value = argv[index]
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value`)
  }
  return value
}

function exec(command, options = {}) {
  return execSync(command, {
    cwd: root,
    encoding: 'utf8',
    stdio: options.silent ? 'pipe' : 'inherit',
    ...options,
  })
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), 'utf8'))
}

function writeJson(path, value) {
  writeFileSync(resolve(root, path), `${JSON.stringify(value, null, 2)}\n`)
}

function baseVersion(version) {
  const match = version.match(/^(\d+\.\d+\.\d+)(?:[-+].*)?$/)
  if (!match) {
    throw new Error(`Invalid semantic version: ${version}`)
  }
  return match[1]
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function currentForkNumber(version, base, channel) {
  const pattern = new RegExp(
    `^${escapeRegExp(base)}-${escapeRegExp(channel)}\\.(\\d+)$`
  )
  const match = version.match(pattern)
  if (!match) return null
  return Number.parseInt(match[1], 10)
}

function fetchTags(remote) {
  try {
    exec(`git remote get-url ${shellQuote(remote)}`, { silent: true })
    exec(`git fetch ${shellQuote(remote)} --tags`, { silent: true })
  } catch {
    // Optional convenience only: local tags are still used if the remote is absent.
  }
}

function readUpstreamVersion(options) {
  if (options.base) return options.base

  try {
    exec(`git remote get-url ${shellQuote(options.remote)}`, { silent: true })
  } catch {
    throw new Error(
      `Git remote "${options.remote}" was not found. Add it with:\n` +
        `  git remote add ${options.remote} <source-repo-url>\n` +
        'Or pass --base <version> to avoid reading from git.'
    )
  }

  if (options.fetch) {
    console.log(`Fetching ${options.remote}/${options.branch}...`)
    const remoteTrackingRef = `refs/remotes/${options.remote}/${options.branch}`
    const refspec = `+refs/heads/${options.branch}:${remoteTrackingRef}`
    exec(
      `git fetch ${shellQuote(options.remote)} ${shellQuote(refspec)} --tags`
    )
  }

  const packageJson = exec(
    `git show ${shellQuote(`${options.remote}/${options.branch}:package.json`)}`,
    { silent: true }
  )
  return JSON.parse(packageJson).version
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`
}

function latestForkTagNumber(base, channel) {
  const tagPrefix = `v${base}-${channel}.`
  const tags = exec(`git tag --list ${shellQuote(`${tagPrefix}*`)}`, {
    silent: true,
  })
    .split('\n')
    .map(tag => tag.trim())
    .filter(Boolean)

  let latest = null
  for (const tag of tags) {
    const suffix = tag.slice(tagPrefix.length)
    if (!/^\d+$/.test(suffix)) continue
    const number = Number.parseInt(suffix, 10)
    latest = Math.max(latest ?? 0, number)
  }

  return latest
}

function updateCargoVersion(version) {
  const cargoPath = resolve(root, 'src-tauri/Cargo.toml')
  const cargo = readFileSync(cargoPath, 'utf8')
  const updated = cargo.replace(/^version = "[^"]*"/m, `version = "${version}"`)

  if (updated === cargo) {
    throw new Error('Could not find package version in src-tauri/Cargo.toml')
  }

  writeFileSync(cargoPath, updated)
}

function main() {
  const options = parseArgs(process.argv.slice(2))

  const pkg = readJson('package.json')
  const tauriConfig = readJson('src-tauri/tauri.conf.json')

  const upstreamRawVersion = readUpstreamVersion(options)
  if (options.fetch) fetchTags('origin')

  const upstreamBaseVersion = baseVersion(upstreamRawVersion)
  const currentVersion = pkg.version
  const existingForkNumber = currentForkNumber(
    currentVersion,
    upstreamBaseVersion,
    options.channel
  )
  const latestTaggedForkNumber = latestForkTagNumber(
    upstreamBaseVersion,
    options.channel
  )
  const nextForkNumber =
    options.number ??
    Math.max(existingForkNumber ?? 0, latestTaggedForkNumber ?? 0) + 1
  const nextVersion = `${upstreamBaseVersion}-${options.channel}.${nextForkNumber}`
  const nextTag = `v${nextVersion}`

  console.log('\nFork version bump')
  console.log('-----------------')
  console.log(
    `Upstream source:  ${options.base ? '--base' : `${options.remote}/${options.branch}`}`
  )
  console.log(`Upstream version: ${upstreamRawVersion}`)
  console.log(`Base version:     ${upstreamBaseVersion}`)
  console.log(`Current version:  ${currentVersion}`)
  console.log(
    `Latest tag:       ${latestTaggedForkNumber ? `v${upstreamBaseVersion}-${options.channel}.${latestTaggedForkNumber}` : '(none)'}`
  )
  console.log(`Next version:     ${nextVersion}`)
  console.log(`Next tag:         ${nextTag}`)

  if (options.dryRun) {
    console.log('\nDry run only; no files were changed.')
    return
  }

  pkg.version = nextVersion
  tauriConfig.version = nextVersion

  writeJson('package.json', pkg)
  writeJson('src-tauri/tauri.conf.json', tauriConfig)
  updateCargoVersion(nextVersion)

  console.log('\nUpdated:')
  console.log('- package.json')
  console.log('- src-tauri/tauri.conf.json')
  console.log('- src-tauri/Cargo.toml')

  console.log('\nNext steps:')
  console.log('  bun install --frozen-lockfile')
  console.log('  bun run check:all')
  console.log(
    '  git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml bun.lock'
  )
  console.log(`  git commit -m "chore: release ${nextTag}"`)
  console.log(`  git tag ${nextTag}`)
  console.log('  git push origin main --tags')
}

try {
  main()
} catch (error) {
  console.error(`\n❌ ${error.message}`)
  process.exit(1)
}
