import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { PNG } from 'pngjs'
import pixelmatch from 'pixelmatch'

/**
 * Phase 5.5 pixel-compare helper. Wraps `pixelmatch` + `pngjs` and archives a
 * diff PNG next to the calling spec when the tolerance budget blows.
 *
 * Returns the fraction of mismatched pixels over total pixels. Spec asserts
 * the return is within budget — typical budget `<0.005` (0.5%).
 */
export function comparePngBuffers(
  a: Buffer,
  b: Buffer,
  diffOutPath: string | undefined,
  options: { threshold?: number } = {},
): number {
  const imgA = PNG.sync.read(a)
  const imgB = PNG.sync.read(b)
  if (imgA.width !== imgB.width || imgA.height !== imgB.height) {
    throw new Error(
      `pixelCompare: dimension mismatch — canvas=${imgA.width}x${imgA.height} vs pdf=${imgB.width}x${imgB.height}. ` +
        `Canvas DPR and pdfjs-dist render scale must match.`,
    )
  }
  const diff = new PNG({ width: imgA.width, height: imgA.height })
  const mismatched = pixelmatch(imgA.data, imgB.data, diff.data, imgA.width, imgA.height, {
    threshold: options.threshold ?? 0.1,
  })
  if (diffOutPath) {
    try {
      // Ensure parent dir exists without pulling in mkdirp.
      const parent = dirname(diffOutPath)
      if (parent) {
        try { require('node:fs').mkdirSync(parent, { recursive: true }) } catch {}
      }
      writeFileSync(diffOutPath, PNG.sync.write(diff))
    } catch {}
  }
  return mismatched / (imgA.width * imgA.height)
}

/** Convenience wrapper — assert within budget or write diff PNG + fail. */
export function expectWithinBudget(actual: number, budget: number, diffPath?: string): void {
  if (actual > budget) {
    throw new Error(
      `pixel diff ${(actual * 100).toFixed(3)}% exceeds budget ${(budget * 100).toFixed(3)}%.` +
        (diffPath ? ` Diff PNG: ${diffPath}` : ''),
    )
  }
}

/** Compute a canonical diff-output path co-located with the failing spec. */
export function diffOutPath(specFilePath: string, testName: string): string {
  const slug = testName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
  return join(dirname(specFilePath), '__diffs__', `${slug}.png`)
}
