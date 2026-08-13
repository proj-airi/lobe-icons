import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { importDirectory, SVG } from '@iconify/tools'
import { getPackageInfo, isPackageExists } from 'local-pkg'
import { defineConfig } from 'tsdown'

import packageJSON from './package.json' with { type: 'json' }

import { extractAvatars } from './src/build/extract-avatars.ts'
import { collectVariants } from './src/build/variants.ts'

function json(any: any) {
  return JSON.stringify(any, null, 2)
}

export default defineConfig({
  entry: ['./src/index.ts'],
  external: [
    './metadata.json',
    './icons.json',
    './chars.json',
    './info.json',
  ],
  sourcemap: false,
  dts: true,
  unused: true,
  fixedExtension: true,
  hooks: {
    'build:done': async () => {
      if (!isPackageExists('@lobehub/icons-static-svg'))
        throw new Error('Package @lobehub/icons-static-svg not found')

      const pkg = await getPackageInfo('@lobehub/icons-static-svg')
      if (!pkg)
        throw new Error('Package @lobehub/icons-static-svg not found')

      // (Re)generate the per-model avatar config from the installed @lobehub/icons package,
      // then bake `combine` (logo + text) and `avatar` (logo on background) variants.
      await extractAvatars()

      const iconSetData = await importDirectory(join(pkg.rootPath, 'icons'), { prefix: 'lobe-icons', ignoreImportErrors: 'warn' })

      const variants = await collectVariants(iconSetData)
      for (const variant of variants)
        iconSetData.fromSVG(variant.name, new SVG(variant.svg))

      const iconJSONData = iconSetData.export()

      await writeFile(join('dist', 'metadata.json'), json({ categories: iconSetData.categories }), { encoding: 'utf8' })
      await writeFile(join('dist', 'icons.json'), json(iconJSONData), { encoding: 'utf8' })
      await writeFile(join('dist', 'chars.json'), json({}), { encoding: 'utf8' })
      await writeFile(join('dist', 'info.json'), json({
        prefix: 'lobe-icons',
        name: 'Lobe Icons',
        total: Object.keys(iconJSONData.icons).length,
        version: packageJSON.version,
        author: {
          name: 'LobeHub',
          url: 'https://github.com/lobehub',
        },
        license: {
          title: 'MIT',
          spdx: 'MIT',
        },
        samples: [
          'openai',
          'deepseek',
          'claude',
          'openai-combine',
          'openai-avatar',
        ],
        height: 20,
        displayHeight: 20,
        category: 'Logos 20px',
        tags: [
          'AI',
          'Models',
          'LLM',
          'Lobe',
        ],
        palette: true,
      }), { encoding: 'utf8' })
    },
  },
})
