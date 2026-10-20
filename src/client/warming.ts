/** The warming ledger behind the Insights head card: dsh-warm's route read once per open (the balance
 * capsule's join pattern — one in-flight read, every open riding it). The route is dsh-warm's stable
 * contract; anything else — dsh-warm absent, stats off, a future schema — reads as nothing, and
 * nothing rendered keeps the plugins independent.
 *
 * Schema 2 adds the per-model money ledger — each model's ping cost basis and saved credit — the
 * failed pings' observed usage, and the per-session buckets; schema 3 adds the failed figures
 * PER MODEL (the flat ones stay authoritative totals); schema 1 stays the count story. A payload
 * that claims schema 2 or 3 must carry BOTH period's models maps: the money verdict prices them,
 * and a ledger-less read is malformed, not a count story. */

import { WARMING_ROUTE } from './apiRoutes'
import { asRecord } from './services'

export interface WarmingCounters {
  warms: number
  needless: number
  noFollowup: number
  expired: number
  savedCacheTokens: number
}

/** The ping's own cache-read tokens, bucketed by the ping's outcome (schema 2). */
export interface WarmingPingTokens {
  held: number
  needless: number
  noFollowup: number
  expired: number
}

/** One model's schema-2/3 ledger entry: the count partition plus the ping cost basis. */
export interface WarmingModelCounters extends WarmingCounters {
  pingCacheReadTokens: WarmingPingTokens
  pingUncachedTokens: number
  /** The model's failed pings' observed usage (schema 3); absent = none observed. */
  failedPingTokens?: { cacheRead: number; uncached: number }
}

export interface WarmingStats {
  today: WarmingCounters & { day: string; models?: Record<string, WarmingModelCounters> }
  allTime: WarmingCounters & { models?: Record<string, WarmingModelCounters> }
  /** All-time only by dsh-warm's contract: a ping that errored never carries an outcome. */
  failed: number
  /** Failed pings' observed usage; a schema-1 wire observes none, so its parse reads zeros. */
  failedPingTokens: { cacheRead: number; uncached: number }
  /** Per-session attribution (schema 2), bounded to the host's recent sessions; a pruned session
   * keeps its numbers in today/allTime but loses its bucket. */
  sessions?: Record<string, WarmingSessionBucket>
}

/** One session's schema-2 bucket: allTime-shaped (count fields + models, no day, no failed —
 * failures stay global), so the money verdict prices it with the same function. */
export interface WarmingSessionBucket extends WarmingCounters {
  models: Record<string, WarmingModelCounters>
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

function countOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null
}

/** Narrow one period's count fields. The record itself is the callers' boundary check — each
 * asRecords its value first, so the helper takes the record it is handed. */
function countersOf(data: Record<string, unknown>): WarmingCounters | null {
  const warms = countOf(data.warms)
  const needless = countOf(data.needless)
  const noFollowup = countOf(data.noFollowup)
  const expired = countOf(data.expired)
  const savedCacheTokens = countOf(data.savedCacheTokens)
  if (warms === null || needless === null || noFollowup === null || expired === null || savedCacheTokens === null) {
    return null
  }
  return { warms, needless, noFollowup, expired, savedCacheTokens }
}

function pingTokensOf(value: unknown): WarmingPingTokens | null {
  const data = asRecord(value)
  if (data === null) return null
  const held = countOf(data.held)
  const needless = countOf(data.needless)
  const noFollowup = countOf(data.noFollowup)
  const expired = countOf(data.expired)
  if (held === null || needless === null || noFollowup === null || expired === null) return null
  return { held, needless, noFollowup, expired }
}

function modelCountersOf(value: unknown): WarmingModelCounters | null {
  const data = asRecord(value)
  if (data === null) return null
  const counters = countersOf(data)
  if (counters === null) return null
  const pingCacheReadTokens = pingTokensOf(data.pingCacheReadTokens)
  const pingUncachedTokens = countOf(data.pingUncachedTokens)
  if (pingCacheReadTokens === null || pingUncachedTokens === null) return null
  // Schema 3's per-model failed figures price against the model's own rates; absent = none observed.
  let failedPingTokens: { cacheRead: number; uncached: number } | undefined
  if (data.failedPingTokens !== undefined) {
    const parsed = failedPingTokensOf(data.failedPingTokens)
    if (parsed === null) return null
    failedPingTokens = parsed
  }
  return failedPingTokens === undefined
    ? { ...counters, pingCacheReadTokens, pingUncachedTokens }
    : { ...counters, pingCacheReadTokens, pingUncachedTokens, failedPingTokens }
}

/** Schema-2's models map: one malformed entry drops the whole payload (untrusted wire) rather than
 * silently zeroing that model's share of the verdict. */
function modelsOf(value: unknown): Record<string, WarmingModelCounters> | null {
  const data = asRecord(value)
  if (data === null) return null
  const out: Record<string, WarmingModelCounters> = {}
  for (const id of Object.keys(data)) {
    const entry = modelCountersOf(data[id])
    if (entry === null) return null
    out[id] = entry
  }
  return out
}

function failedPingTokensOf(value: unknown): { cacheRead: number; uncached: number } | null {
  const data = asRecord(value)
  if (data === null) return null
  const cacheRead = countOf(data.cacheRead)
  const uncached = countOf(data.uncached)
  if (cacheRead === null || uncached === null) return null
  return { cacheRead, uncached }
}

/** Schema-2's sessions map: one malformed bucket drops the whole payload (the models policy — an
 * untrusted wire never yields a half-parsed ledger); absent reads as no sessions at all. */
function sessionsOf(value: unknown): Record<string, WarmingSessionBucket> | null {
  if (value === undefined) return {}
  const data = asRecord(value)
  if (data === null) return null
  const out: Record<string, WarmingSessionBucket> = {}
  for (const sid of Object.keys(data)) {
    const raw = asRecord(data[sid])
    if (raw === null) return null
    const counters = countersOf(raw)
    const models = modelsOf(raw.models)
    if (counters === null || models === null) return null
    out[sid] = { ...counters, models }
  }
  return out
}

export function warmingStatsOf(value: unknown): WarmingStats | null {
  const data = asRecord(value)
  if (data === null || (data.schema !== 1 && data.schema !== 2 && data.schema !== 3) || data.statsEnabled !== true) return null
  const stats = asRecord(data.stats)
  if (stats === null) return null
  const todayRaw = asRecord(stats.today)
  const allTimeRaw = asRecord(stats.allTime)
  const failed = countOf(stats.failed)
  if (todayRaw === null || allTimeRaw === null || failed === null) return null
  const today = countersOf(todayRaw)
  const day = todayRaw.day
  if (today === null || typeof day !== 'string' || !DAY_RE.test(day)) return null
  const allTime = countersOf(allTimeRaw)
  if (allTime === null) return null
  if (data.schema === 2 || data.schema === 3) {
    const todayModels = modelsOf(todayRaw.models)
    const allTimeModels = modelsOf(allTimeRaw.models)
    if (todayModels === null || allTimeModels === null) return null
    // The failed pings' usage joined the wire after the counts did; absent usage reads zero.
    const failedPingTokens = stats.failedPingTokens === undefined
      ? { cacheRead: 0, uncached: 0 }
      : failedPingTokensOf(stats.failedPingTokens)
    if (failedPingTokens === null) return null
    const sessions = sessionsOf(stats.sessions)
    if (sessions === null) return null
    return {
      today: { ...today, day, models: todayModels },
      allTime: { ...allTime, models: allTimeModels },
      failed,
      failedPingTokens,
      sessions,
    }
  }
  return { today: { ...today, day }, allTime, failed, failedPingTokens: { cacheRead: 0, uncached: 0 } }
}

let cached: WarmingStats | null = null
/** The route read in flight, so a second open joins it instead of starting one. */
let refreshing: Promise<void> | null = null
/** Every open riding the in-flight read, joiners included; cleared when the read settles. */
const landingCallbacks = new Set<(value: WarmingStats) => void>()

/** One route GET, narrowed through `warmingStatsOf`. Never rejects. */
async function readRoute(): Promise<WarmingStats | null> {
  try {
    const response = await fetch(WARMING_ROUTE, { method: 'GET' })
    if (!response.ok) return null
    return warmingStatsOf(await response.json())
  } catch {
    return null
  }
}

/** One route read per open, `onRefresh` once it lands on a figure. `refreshing` is assigned before anything
 * awaits, so an open arriving mid-flight joins the read rather than starting a second one, and the read's
 * landing reports to every open riding it. A failed or absent read notifies nobody. */
export function readWarmingStats(onRefresh: (value: WarmingStats) => void): WarmingStats | null {
  landingCallbacks.add(onRefresh)
  if (refreshing === null) {
    refreshing = (async () => {
      const value = await readRoute()
      if (value === null) return
      cached = value
      for (const waiter of landingCallbacks) waiter(value)
    })().finally(() => {
      refreshing = null
      landingCallbacks.clear()
    })
  }
  return cached
}

export function resetWarmingStats(): void {
  cached = null
  refreshing = null
  landingCallbacks.clear()
}
