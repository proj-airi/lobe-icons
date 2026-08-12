/**
 * Regenerates `src/build/avatar-config.generated.json` from the installed `@lobehub/icons`
 * package (each model's `es/<model>/style.js` + `es/<model>/components/Avatar.js`), which is the only
 * place the per-model avatar design (foreground source, background, color, scale) is shipped.
 *
 * It's re-run on every `pnpm build` (see tsdown.config build:done), so bumping the dependency
 * and rebuilding automatically picks up new/reworked avatars — no hand-maintained data file.
 * Run standalone with: `node src/build/extract-avatars.ts`
 */

import process from 'node:process'

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { getPackageInfo } from 'local-pkg'

const PACKAGE = '@lobehub/icons'
const OUT_FILE = join(process.cwd(), 'src', 'build', 'avatar-config.generated.json')

export interface AvatarEntry {
  icon: 'mono' | 'color' | 'inner' | 'none'
  background: string
  color: string
  scale: number
}

/**
 * Parse `export var NAME = <value>;` declarations (values may span lines).
 */
function grabConsts(src: string): Record<string, string> {
  const consts: Record<string, string> = {}
  for (const m of src.matchAll(/export var (\w+)\s*=([\s\S]*?);/g))
    consts[m[1]] = m[2].trim()
  return consts
}

/**
 * Resolve a value, following references to other consts
 * (e.g. AVATAR_BACKGROUND = COLOR_PRIMARY).
 */
function resolve(token: string, consts: Record<string, string>, depth = 0): string {
  if (depth > 6)
    return token
  const value = token.trim().replace(/;$/, '')
  if (/^['"][^'"]+['"]$/.test(value))
    return value.slice(1, -1)
  if (/^[\d.]+$/.test(value))
    return value
  if (/^[a-z_]\w*$/i.test(value) && consts[value] != null)
    return resolve(consts[value], consts, depth + 1)
  return value
}

/**
 * Map the `Icon:` prop in a compiled Avatar.js to its foreground source.
 */
function iconSource(avatar: string): AvatarEntry['icon'] {
  const icon = avatar.match(/Icon:\s*(\w+)/)
  if (!icon)
    return 'none'
  const file = avatar.match(new RegExp(`import\\s+${icon[1]}\\s+from\\s+["']\\./(\\w+)["']`))?.[1] ?? icon[1]
  if (file === 'Color')
    return 'color'
  if (file === 'Mono')
    return 'mono'
  if (file === 'Inner')
    return 'inner'
  return 'none'
}

/**
 * Scan every model's `es/<model>/style.js` + `components/Avatar.js` and write the generated
 * per-model avatar config to OUT_FILE.
 */
export async function extractAvatars(): Promise<string> {
  const pkg = await getPackageInfo(PACKAGE)
  if (!pkg)
    throw new Error(`Package ${PACKAGE} not found`)

  const es = join(pkg.rootPath, 'es')
  const out: Record<string, AvatarEntry> = {}

  for (const name of readdirSync(es)) {
    const avatarFile = join(es, name, 'components', 'Avatar.js')
    const styleFile = join(es, name, 'style.js')
    if (!existsSync(avatarFile) || !existsSync(styleFile))
      continue

    const avatar = readFileSync(avatarFile, 'utf8')
    const consts = grabConsts(readFileSync(styleFile, 'utf8'))

    let scale = Number.parseFloat(avatar.match(/iconMultiple:\s*([\d.]+)/)?.[1] ?? '')
    if (!Number.isFinite(scale) && consts.AVATAR_ICON_MULTIPLE != null)
      scale = Number.parseFloat(resolve(consts.AVATAR_ICON_MULTIPLE, consts))
    if (!Number.isFinite(scale))
      scale = 0.75

    out[name.toLowerCase()] = {
      icon: iconSource(avatar),
      background: resolve(consts.AVATAR_BACKGROUND ?? '', consts) || '#000',
      color: resolve(consts.AVATAR_COLOR ?? '', consts) || '#fff',
      scale,
    }
  }

  writeFileSync(OUT_FILE, `${JSON.stringify(out, null, 2)}\n`)
  return OUT_FILE
}

// Run when executed directly (not when imported by the build).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  extractAvatars().then(file => process.stdout.write(`written: ${file}\n`))
