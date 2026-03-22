import dotenv from 'dotenv'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

// `import.meta.url` can point at tsx’s cache dir under watch. `dotenv.config` alone can also miss
// updates. Parsing + assigning is deterministic.
const envInCwd = resolve(process.cwd(), '.env')
const envBesideThisFile = resolve(dirname(fileURLToPath(import.meta.url)), '.env')

function stripBom(s: string) {
  return s.length > 0 && s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

function mergeEnvFile(path: string): number {
  if (!existsSync(path)) return 0
  const raw = stripBom(readFileSync(path, 'utf8'))
  const parsed = dotenv.parse(raw)
  for (const [k, v] of Object.entries(parsed)) {
    process.env[k] = v
  }
  return Object.keys(parsed).length
}

const nCwd = mergeEnvFile(envInCwd)
if (!process.env.OPENAI_API_KEY?.trim()) {
  mergeEnvFile(envBesideThisFile)
}

import express from 'express'
import type { Request, Response } from 'express'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const { default: ocrHandler }       = await import('./api/ocr.js')
const { default: normalizeHandler } = await import('./api/normalize.js')
const { default: ocrRegionHandler } = await import('./api/ocr-region.js')

const app = express()
app.use(express.json({ limit: '25mb' }))

function wrap(handler: (req: VercelRequest, res: VercelResponse) => unknown) {
  return (req: Request, res: Response) =>
    handler(req as unknown as VercelRequest, res as unknown as VercelResponse)
}

app.post('/api/ocr',        wrap(ocrHandler))
app.post('/api/normalize',  wrap(normalizeHandler))
app.post('/api/ocr-region', wrap(ocrRegionHandler))

const PORT = 3001
app.listen(PORT, () => {
  const ok = (v: string | undefined) => (v?.trim() ? '✓' : '✗ MISSING')
  const openaiOk = ok(process.env.OPENAI_API_KEY)
  console.log(`\n  Dev API server → http://localhost:${PORT}`)
  console.log(`  .env      ${envInCwd} (${nCwd} keys parsed)`)
  console.log(`  openai    ${openaiOk}`)
  if (openaiOk.includes('MISSING')) {
    console.log(`  hint      Save .env in the project root; Node only reads the file on disk.\n`)
  } else {
    console.log('')
  }
})
