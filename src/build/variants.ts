/**
 * Build-time generation of `combine` (logo + text wordmark) and `avatar` variants.
 *
 * These variants don't exist as static assets in @lobehub/icons-static-svg (Combine is a
 * React render and Avatar is only raster webp), so we bake them into flat SVGs here and feed
 * them back into the IconSet produced by importDirectory.
 *
 * Per-model avatar design (foreground source, background, foreground color, scale) is read at
 * build time from src/build/avatar-config.generated.json, which is regenerated from the
 * installed @lobehub/icons package by src/build/extract-avatars.ts (see tsdown.config build:done).
 */

import type { IconSet, SVG } from '@iconify/tools'

import process from 'node:process'

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Global layout multiples. lobe-icons stores per-model COMBINE_* constants in each model's
 * style.ts, but they aren't published, so we use reasonable defaults across the set.
 */
export const COMBINE_TEXT_MULTIPLE = 0.72
export const COMBINE_SPACE_MULTIPLE = 0.15
/** Corner radius multiplier for the rounded `-avatar-square` variant. */
export const AVATAR_SQUARE_RADIUS = 0.1

export interface AvatarConfig {
  /** foreground icon source */
  icon: 'mono' | 'color' | 'inner' | 'none'
  /** AVATAR_BACKGROUND: '#hex', 'linear-gradient(...)' or 'conic-gradient(...)' */
  background: string
  /** AVATAR_COLOR (used only for mono/inner foreground) */
  color: string
  /** AVATAR_ICON_MULTIPLE */
  scale: number
}

/**
 * Round to a compact fixed-point string (avoids long float noise in the emitted SVG).
 */
function fmt(n: number): string {
  const r = Math.round(n * 1000) / 1000
  return Number.isInteger(r) ? String(r) : String(r)
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

/**
 * Read an SVG's viewBox as a plain box.
 */
function boxOf(svg: SVG): Box {
  const vb = svg.viewBox
  return { x: vb.left ?? 0, y: vb.top ?? 0, w: vb.width, h: vb.height }
}

let avatarConfigCache: Record<string, AvatarConfig> | null = null

/**
 * Load the generated avatar config (memoized).
 */
async function loadAvatarConfig(): Promise<Record<string, AvatarConfig>> {
  if (!avatarConfigCache) {
    const raw = await readFile(join(process.cwd(), 'src', 'build', 'avatar-config.generated.json'), 'utf8')
    avatarConfigCache = JSON.parse(raw) as Record<string, AvatarConfig>
  }
  return avatarConfigCache
}

/**
 * Compose a `combine` SVG: a square logo glyph beside a wide text wordmark.
 *
 * `colorMode`:
 * - 'mono': logo + text are theme-tintable (currentColor).
 * - 'color': logo keeps its baked brand colors; text stays currentColor.
 */
export function buildCombineSVG(logo: SVG, text: SVG, colorMode: 'mono' | 'color'): string {
  const l = boxOf(logo)
  const t = boxOf(text)
  const tm = COMBINE_TEXT_MULTIPLE

  const textWidth = t.w * tm
  const space = l.w * COMBINE_SPACE_MULTIPLE
  const width = l.w + space + textWidth
  const height = l.h
  const cx = l.w + space
  const cy = (height - t.h * tm) / 2

  const logoTransform = `translate(${fmt(-l.x)} ${fmt(-l.y)})`
  const textTransform = `translate(${fmt(cx)} ${fmt(cy)}) scale(${fmt(tm)}) translate(${fmt(-t.x)} ${fmt(-t.y)})`

  const logoFill = colorMode === 'mono' ? ' fill="currentColor"' : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(width)} ${fmt(height)}"><g transform="${logoTransform}"${logoFill}>${logo.getBody()}</g><g transform="${textTransform}" fill="currentColor">${text.getBody()}</g></svg>`
}

/**
 * SVG defs + fill attribute for a flat or gradient avatar background.
 */
function backgroundMarkup(background: string, id: string, size: number): { defs: string, fill: string } {
  // flat color
  if (/^#[0-9a-f]{3,8}$/i.test(background))
    return { defs: '', fill: `fill="${background}"` }

  // gradient (linear-gradient(...) or conic-gradient(...), approximated as linear)
  const inner = background.slice(background.indexOf('(') + 1, background.lastIndexOf(')'))
  let angle = 180 // default: top -> bottom

  const degM = inner.match(/^\s*(?:from\s+)?([-\d.]+)deg/)
  if (degM) {
    angle = Number.parseFloat(degM[1])
  }
  else {
    const toM = inner.match(/^\s*to\s+([a-z]+(?:\s+[a-z]+)*)/i)
    if (toM) {
      const dir = toM[1].toLowerCase()
      if (dir.includes('top') && dir.includes('right'))
        angle = 45
      else if (dir.includes('bottom') && dir.includes('right'))
        angle = 135
      else if (dir.includes('top') && dir.includes('left'))
        angle = 315
      else if (dir.includes('bottom') && dir.includes('left'))
        angle = 225
      else if (dir.includes('top'))
        angle = 0
      else if (dir.includes('right'))
        angle = 90
      else if (dir.includes('bottom'))
        angle = 180
      else if (dir.includes('left'))
        angle = 270
    }
  }

  // parse stops
  const parts = (inner.includes(',') ? inner.slice(inner.search(/,/)) : inner).split(',').map(s => s.trim()).filter(Boolean)
  const stops = parts.map((p, i) => {
    const color = p.match(/(#[0-9a-f]{3,8})/i)?.[1] ?? '#000'
    const offM = p.match(/([\d.]+)%/)
    const offset = offM ? Number.parseFloat(offM[1]) / 100 : (parts.length > 1 ? i / (parts.length - 1) : 0)
    return { offset, color }
  })
  if (!stops.length)
    stops.push({ offset: 0, color: background })

  // CSS angle -> user-space gradient line over the square
  const c = size / 2
  const rad = angle * Math.PI / 180
  const dx = Math.sin(rad)
  const dy = -Math.cos(rad)
  const k = c / Math.max(Math.abs(dx), Math.abs(dy))
  const x1 = fmt(c - dx * k)
  const y1 = fmt(c - dy * k)
  const x2 = fmt(c + dx * k)
  const y2 = fmt(c + dy * k)

  const stopTags = stops.map(s => `<stop offset="${fmt(s.offset)}" stop-color="${s.color}"/>`).join('')
  const defs = `<defs><linearGradient id="${id}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" gradientUnits="userSpaceOnUse">${stopTags}</linearGradient></defs>`
  return { defs, fill: `fill="url(#${id})"` }
}

/**
 * Return an SVG-safe id fragment from a model name.
 */
function sanitizeId(id: string): string {
  return id.replace(/[^a-z0-9]/gi, '_')
}

/**
 * Compose an `avatar` SVG: the model's logo (mono tinted, or the color logo) scaled inside a
 * `circle` (round) or `rounded` (rounded-square) background.
 */
export function buildAvatarSVG(mono: SVG | null, name: string, cfg: AvatarConfig, shape: 'circle' | 'rounded'): string {
  const size = mono ? boxOf(mono).w : 24
  const M = cfg.scale
  const radius = shape === 'circle' ? size / 2 : size * AVATAR_SQUARE_RADIUS
  const gid = `g${sanitizeId(name)}`
  const { defs, fill } = backgroundMarkup(cfg.background, gid, size)

  let icon = ''
  if (mono) {
    const offset = (size - size * M) / 2
    // strip `currentColor` so our tint (or the baked colors of a color logo) applies
    const body = cfg.icon === 'color' ? mono.getBody() : mono.getBody().replace(/\sfill="currentColor"/g, '')
    const tint = cfg.icon === 'color' ? '' : ` fill="${cfg.color}"`
    icon = `<g transform="translate(${fmt(offset)} ${fmt(offset)}) scale(${fmt(M)})"${tint}>${body}</g>`
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(size)} ${fmt(size)}">${defs}<rect width="${fmt(size)}" height="${fmt(size)}" rx="${fmt(radius)}" ry="${fmt(radius)}" ${fill}/>${icon}</svg>`
}

export interface GeneratedVariant {
  name: string
  svg: string
}

/**
 * Generate `-combine`, `-combine-color`, `-avatar` (round) and `-avatar-square` (rounded)
 * variants. Every model in the generated avatar config is considered; gating is purely on
 * asset availability.
 */
export async function collectVariants(iconSet: IconSet): Promise<GeneratedVariant[]> {
  const models = await loadAvatarConfig()
  const out: GeneratedVariant[] = []

  for (const [name, cfg] of Object.entries(models)) {
    // mono combine
    if (iconSet.exists(name) && iconSet.exists(`${name}-text`)) {
      const logo = iconSet.toSVG(name)
      const text = iconSet.toSVG(`${name}-text`)
      if (logo && text)
        out.push({ name: `${name}-combine`, svg: buildCombineSVG(logo, text, 'mono') })
    }

    // color combine
    if (iconSet.exists(`${name}-color`) && iconSet.exists(`${name}-text`)) {
      const color = iconSet.toSVG(`${name}-color`)
      const text = iconSet.toSVG(`${name}-text`)
      if (color && text)
        out.push({ name: `${name}-combine-color`, svg: buildCombineSVG(color, text, 'color') })
    }

    // avatar foreground source
    let fg: SVG | null = null
    if (cfg.icon === 'color' && iconSet.exists(`${name}-color`))
      fg = iconSet.toSVG(`${name}-color`)
    else if ((cfg.icon === 'mono' || cfg.icon === 'inner') && iconSet.exists(name))
      fg = iconSet.toSVG(name)

    out.push({ name: `${name}-avatar`, svg: buildAvatarSVG(fg, name, cfg, 'circle') })
    out.push({ name: `${name}-avatar-square`, svg: buildAvatarSVG(fg, name, cfg, 'rounded') })
  }

  return out
}
