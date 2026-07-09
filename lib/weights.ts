// Core weighting model for Loopany.
// This is a deliberately simplified first pass — enough to make Down/Up/Left/Right
// feel real in a prototype, not a final production algorithm.

export type ContentRow = {
  id: string
  taken_at: string | null
  uploaded_at: string
  moment_key: string | null
  caption: string | null
}

export type TagRow = {
  content_id: string
  tag_type: string
  value: string
  tagged_by: string
}

export type CommentRow = {
  content_id: string
  author_id: string
}

export type MembershipRow = {
  user_id: string
  generation: number
}

// How much a person's generation in the loop discounts their contribution.
// Generation 0 (creator's direct invites) = full weight.
// Each generation out roughly halves the influence.
export function generationDecay(generation: number): number {
  return 1 / (1 + generation)
}

// Crowding/scarcity multiplier: photos that are one-of-a-kind in their moment
// get a bonus; photos from a moment with many near-duplicates get discounted.
export function scarcityMultiplier(clusterSize: number): number {
  if (clusterSize <= 1) return 1.3 // rare — boost it
  if (clusterSize <= 4) return 1.0 // normal
  return 0.7 // crowded event — dampen so it doesn't dominate everything
}

function generationForUser(userId: string, memberships: MembershipRow[]): number {
  const m = memberships.find((row) => row.user_id === userId)
  return m ? m.generation : 3 // unknown contributor treated as far outer ring
}

// The overall Content_Weight for a single piece of content, from the
// perspective of "how strongly is this content connected to the loop overall."
// Sums weighted tag contributions and comment contributions.
export function computeContentWeight(
  contentId: string,
  tags: TagRow[],
  comments: CommentRow[],
  memberships: MembershipRow[],
  clusterSize: number
): number {
  const contentTags = tags.filter((t) => t.content_id === contentId)
  const contentComments = comments.filter((c) => c.content_id === contentId)

  const tagWeight = contentTags.reduce(
    (sum, t) => sum + generationDecay(generationForUser(t.tagged_by, memberships)),
    0
  )
  const commentWeight = contentComments.reduce(
    (sum, c) => sum + 0.5 * generationDecay(generationForUser(c.author_id, memberships)),
    0
  )

  return (tagWeight + commentWeight) * scarcityMultiplier(clusterSize)
}

// Relation score between two specific pieces of content: how many tags they
// share (person/place/event/thing), weighted by the closeness of whoever
// applied each shared tag.
export function relationScore(
  contentIdA: string,
  contentIdB: string,
  tags: TagRow[],
  memberships: MembershipRow[]
): number {
  const tagsA = tags.filter((t) => t.content_id === contentIdA)
  const tagsB = tags.filter((t) => t.content_id === contentIdB)

  let score = 0
  for (const a of tagsA) {
    for (const b of tagsB) {
      if (a.tag_type === b.tag_type && a.value.toLowerCase() === b.value.toLowerCase()) {
        const genA = generationDecay(generationForUser(a.tagged_by, memberships))
        const genB = generationDecay(generationForUser(b.tagged_by, memberships))
        score += (genA + genB) / 2
      }
    }
  }
  return score
}

// Session_Weight: a simple in-memory fatigue tracker, keyed by content id.
// Suppresses content that was just viewed; fades back toward 1.0 over time.
export class SessionFatigue {
  private lastViewed: Map<string, number> = new Map()

  markViewed(contentId: string) {
    this.lastViewed.set(contentId, Date.now())
  }

  // Returns a multiplier between ~0.1 (just viewed) and 1.0 (fully faded / never viewed).
  // Fatigue clears over FADE_MS milliseconds.
  suppressionMultiplier(contentId: string, fadeMs = 5 * 60 * 1000): number {
    const seenAt = this.lastViewed.get(contentId)
    if (!seenAt) return 1.0
    const elapsed = Date.now() - seenAt
    if (elapsed >= fadeMs) return 1.0
    const fraction = elapsed / fadeMs
    return 0.1 + 0.9 * fraction
  }

  clear() {
    this.lastViewed.clear()
  }
}

// DOWN: find the single strongest related piece of content, regardless of
// time or place — the "true thread" — discounted by session fatigue.
export function findStrongestRelated(
  currentId: string,
  candidates: ContentRow[],
  tags: TagRow[],
  memberships: MembershipRow[],
  fatigue: SessionFatigue
): ContentRow | null {
  let best: ContentRow | null = null
  let bestScore = 0
  for (const c of candidates) {
    if (c.id === currentId) continue
    const raw = relationScore(currentId, c.id, tags, memberships)
    if (raw <= 0) continue
    const score = raw * fatigue.suppressionMultiplier(c.id)
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
}

// UP: find a genuinely real but weakly-weighted relation — a rut-breaker.
// Looks for the lowest non-zero relation score above a small noise floor.
export function findWeakRelated(
  currentId: string,
  candidates: ContentRow[],
  tags: TagRow[],
  memberships: MembershipRow[],
  fatigue: SessionFatigue
): ContentRow | null {
  const NOISE_FLOOR = 0.05
  let best: ContentRow | null = null
  let bestScore = Infinity
  for (const c of candidates) {
    if (c.id === currentId) continue
    const raw = relationScore(currentId, c.id, tags, memberships)
    if (raw <= NOISE_FLOOR) continue // must be real, not zero
    const score = raw * fatigue.suppressionMultiplier(c.id)
    if (score < bestScore) {
      bestScore = score
      best = c
    }
  }
  return best
}

// LEFT/RIGHT: strictly chronological neighbor, biased toward closer generations.
// direction: -1 for left (backward in time), 1 for right (forward in time).
export function findTemporalNeighbor(
  currentId: string,
  candidates: ContentRow[],
  direction: -1 | 1
): ContentRow | null {
  const current = candidates.find((c) => c.id === currentId)
  if (!current) return null
  const currentTime = new Date(current.taken_at ?? current.uploaded_at).getTime()

  let best: ContentRow | null = null
  let bestDelta = Infinity
  for (const c of candidates) {
    if (c.id === currentId) continue
    const t = new Date(c.taken_at ?? c.uploaded_at).getTime()
    const delta = (t - currentTime) * direction
    if (delta > 0 && delta < bestDelta) {
      bestDelta = delta
      best = c
    }
  }
  return best
}
