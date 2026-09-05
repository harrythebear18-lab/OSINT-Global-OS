/**
 * CLIP Service — client for the local CLIP embedding server.
 *
 * Connects to a Python FastAPI server running open_clip (ViT-B-32).
 * Used for:
 *  - Text-to-image similarity (search satellite tiles by description)
 *  - Image-to-image similarity (find similar terrain)
 *  - Text-to-text similarity (semantic search over notes/annotations)
 *
 * The CLIP server must be started separately:
 *   py scripts/clip_server.py
 * Default: http://localhost:9776
 */

const CLIP_BASE = 'http://localhost:9776'

export interface ClipHealth {
  running: boolean
  model?: string
  device?: string
  dim?: number
}

/** Check if the CLIP server is running. */
export async function checkClipHealth(): Promise<ClipHealth> {
  try {
    const res = await fetch(`${CLIP_BASE}/health`, { signal: AbortSignal.timeout(3000) })
    if (!res.ok) return { running: false }
    const data = await res.json()
    return {
      running: true,
      model: data.model,
      device: data.device,
      dim: data.dim,
    }
  } catch {
    return { running: false }
  }
}

/** Get text embedding from CLIP. */
export async function embedText(text: string): Promise<number[]> {
  const res = await fetch(`${CLIP_BASE}/embed/text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`CLIP text embed failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  return data.embedding
}

/** Get image embedding from CLIP (by file path). */
export async function embedImage(imagePath: string): Promise<number[]> {
  const res = await fetch(`${CLIP_BASE}/embed/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_path: imagePath }),
  })
  if (!res.ok) throw new Error(`CLIP image embed failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  return data.embedding
}

/** Compute cosine similarity between two embeddings. */
export async function similarity(a: number[], b: number[]): Promise<number> {
  const res = await fetch(`${CLIP_BASE}/similarity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ a, b }),
  })
  if (!res.ok) throw new Error(`CLIP similarity failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  return data.similarity
}

/** Embed a batch of texts (sequential, since CLIP server is single-threaded). */
export async function embedTextBatch(texts: string[]): Promise<number[][]> {
  const results: number[][] = []
  for (const text of texts) {
    results.push(await embedText(text))
  }
  return results
}

/**
 * Search: find the most similar images to a text query.
 * @param query Text query (e.g. "dense forest with river")
 * @param candidates Array of { id, path } image candidates
 * @returns Array of { id, similarity } sorted by similarity descending
 */
export async function searchByText(
  query: string,
  candidates: { id: string; path: string }[],
): Promise<{ id: string; similarity: number }[]> {
  const queryEmb = await embedText(query)
  const results: { id: string; similarity: number }[] = []
  for (const c of candidates) {
    const imgEmb = await embedImage(c.path)
    const sim = await similarity(queryEmb, imgEmb)
    results.push({ id: c.id, similarity: sim })
  }
  return results.sort((a, b) => b.similarity - a.similarity)
}
