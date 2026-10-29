// The warming reader (src/client/warming.ts): dsh-warm's schema-1 boundary proof and the per-open route
// read — anything short of a well-shaped enabled payload reads as nothing, so a deployment without
// dsh-warm never sees the card.

import assert from 'node:assert/strict'
import { afterEach, describe, test, vi } from 'vitest'
import { readWarmingStats, resetWarmingStats, warmingStatsOf, type WarmingStats } from '../../src/client/warming'

const WIRE_WARMING = {
  schema: 1,
  statsEnabled: true,
  stats: {
    today: { day: '2026-10-20', warms: 3, needless: 0, noFollowup: 1, expired: 0, savedCacheTokens: 1152 },
    allTime: { warms: 12, needless: 1, noFollowup: 2, expired: 1, savedCacheTokens: 4608 },
    failed: 0,
  },
}

const PARSED_WARMING: WarmingStats = {
  today: { day: '2026-10-20', warms: 3, needless: 0, noFollowup: 1, expired: 0, savedCacheTokens: 1152 },
  allTime: { warms: 12, needless: 1, noFollowup: 2, expired: 1, savedCacheTokens: 4608 },
  failed: 0,
  failedPingTokens: { cacheRead: 0, uncached: 0 },
}

function stubRoute(body: unknown | undefined, mode: 'ok' | 'reject' | 'status' = 'ok'): { calls: () => number } {
  let n = 0
  vi.stubGlobal('fetch', async () => {
    n++
    if (mode === 'reject') throw new Error('down')
    if (mode === 'status') return { ok: false, status: 404, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => body }
  })
  return { calls: () => n }
}

/** Drain the promise chains a pending route answer settles, then report. */
async function drain(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

/** Collect the figures a read's background refresh reports. */
function collector(): { seen: WarmingStats[]; onRefresh: (v: WarmingStats) => void } {
  const seen: WarmingStats[] = []
  return { seen, onRefresh: (v) => { seen.push(v) } }
}

afterEach(() => {
  resetWarmingStats()
  vi.unstubAllGlobals()
})

describe('warmingStatsOf', () => {
  test('a well-shaped enabled payload narrows to its counters', () => {
    assert.deepEqual(warmingStatsOf(WIRE_WARMING), PARSED_WARMING)
  })

  test('absent payloads, a schema number without its body, or stats off read as nothing', () => {
    assert.equal(warmingStatsOf(undefined), null)
    assert.equal(warmingStatsOf(null), null)
    assert.equal(warmingStatsOf('nope'), null)
    // A schema-2 number on a schema-1 body: the models policy rejects the claim, not the tag.
    assert.equal(warmingStatsOf({ ...WIRE_WARMING, schema: 2 }), null)
    assert.equal(warmingStatsOf({ ...WIRE_WARMING, schema: 4 }), null, 'a schema past the known ones')
    assert.equal(warmingStatsOf({ ...WIRE_WARMING, statsEnabled: false }), null)
    assert.equal(warmingStatsOf({ schema: 1, statsEnabled: true, stats: null }), null)
  })

  test('schema-2 sessions: absent reads empty, malformed drops the payload', () => {
    const wire = {
      schema: 2,
      statsEnabled: true,
      stats: {
        today: { day: '2026-10-20', warms: 3, needless: 0, noFollowup: 1, expired: 0, savedCacheTokens: 1152, models: {} },
        allTime: { warms: 12, needless: 1, noFollowup: 2, expired: 1, savedCacheTokens: 4608, models: {} },
        failed: 0,
      },
    }
    const withSessions = {
      ...wire,
      stats: {
        ...wire.stats,
        sessions: { 's-live': { warms: 2, needless: 0, noFollowup: 0, expired: 0, savedCacheTokens: 1152, models: {} } },
      },
    }
    // Absent sessions is a live pre-sessions host or a pruned ledger — still a well-shaped payload.
    const absent = warmingStatsOf(wire)
    assert.ok(absent)
    assert.deepEqual(absent.sessions, {})
    const live = warmingStatsOf(withSessions)
    assert.ok(live)
    assert.deepEqual(live.sessions, {
      's-live': { warms: 2, needless: 0, noFollowup: 0, expired: 0, savedCacheTokens: 1152, models: {} },
    })
    // One malformed bucket drops the whole payload (the models policy), never a half-parsed ledger.
    for (const broken of [
      { 's-live': { warms: 2, needless: 0, noFollowup: 0, expired: 0, savedCacheTokens: 1152 } },
      { 's-live': { warms: 1.5, needless: 0, noFollowup: 0, expired: 0, savedCacheTokens: 0, models: {} } },
      3,
    ]) {
      assert.equal(warmingStatsOf({ ...wire, stats: { ...wire.stats, sessions: broken } }), null, JSON.stringify(broken))
    }
  })

  test('schema 3 parses the per-model failed figures; one malformed entry drops the payload', () => {
    const model = {
      warms: 12, needless: 1, noFollowup: 2, expired: 1, savedCacheTokens: 4608,
      pingCacheReadTokens: { held: 5000, needless: 0, noFollowup: 0, expired: 0 },
      pingUncachedTokens: 1000,
      failedPingTokens: { cacheRead: 300, uncached: 200 },
    }
    const wire = {
      schema: 3,
      statsEnabled: true,
      stats: {
        today: { day: '2026-10-20', warms: 3, needless: 0, noFollowup: 1, expired: 0, savedCacheTokens: 1152, models: {} },
        allTime: { warms: 12, needless: 1, noFollowup: 2, expired: 1, savedCacheTokens: 4608, models: { 'zai-glm-5-3': model } },
        failed: 2,
        failedPingTokens: { cacheRead: 300, uncached: 200 },
      },
    }
    // The schema-3 number rides the schema-2 money story: both models maps, sessions absent → {}.
    const parsed = warmingStatsOf(wire)
    assert.ok(parsed)
    assert.deepEqual(parsed.allTime.models?.['zai-glm-5-3'], model)
    assert.deepEqual(parsed.failedPingTokens, { cacheRead: 300, uncached: 200 })
    assert.deepEqual(parsed.sessions, {})
    // Absent per-model figures stay omitted — an un-upgraded host observed none.
    const quiet = warmingStatsOf({
      ...wire,
      stats: {
        ...wire.stats,
        allTime: {
          ...wire.stats.allTime,
          models: { 'zai-glm-5-3': { warms: 12, needless: 1, noFollowup: 2, expired: 1, savedCacheTokens: 4608, pingCacheReadTokens: { held: 5000, needless: 0, noFollowup: 0, expired: 0 }, pingUncachedTokens: 1000 } },
        },
      },
    })
    assert.ok(quiet)
    assert.equal('failedPingTokens' in (quiet.allTime.models?.['zai-glm-5-3'] ?? {}), false)
    // Malformed per-model figures drop the whole payload, never a half-priced verdict.
    for (const bad of [null, 3, { cacheRead: 1.5, uncached: 0 }, { cacheRead: 1 }]) {
      const broken = {
        ...wire,
        stats: {
          ...wire.stats,
          allTime: { ...wire.stats.allTime, models: { 'zai-glm-5-3': { ...model, failedPingTokens: bad } } },
        },
      }
      assert.equal(warmingStatsOf(broken), null, JSON.stringify(bad))
    }
    // The same policy guards the flat figures, the rest of the model record, and session buckets.
    for (const broken of [
      { ...wire, stats: { ...wire.stats, failedPingTokens: 3 } },
      { ...wire, stats: { ...wire.stats, failedPingTokens: { cacheRead: -1, uncached: 0 } } },
      { ...wire, stats: { ...wire.stats, allTime: { ...wire.stats.allTime, models: { 'zai-glm-5-3': 3 } } } },
      { ...wire, stats: { ...wire.stats, allTime: { ...wire.stats.allTime, models: { 'zai-glm-5-3': { ...model, warms: -1 } } } } },
      { ...wire, stats: { ...wire.stats, allTime: { ...wire.stats.allTime, models: { 'zai-glm-5-3': { ...model, pingCacheReadTokens: 3 } } } } },
      { ...wire, stats: { ...wire.stats, allTime: { ...wire.stats.allTime, models: { 'zai-glm-5-3': { ...model, pingCacheReadTokens: { held: 'x', needless: 0, noFollowup: 0, expired: 0 } } } } } },
      { ...wire, stats: { ...wire.stats, allTime: { ...wire.stats.allTime, models: { 'zai-glm-5-3': { ...model, pingUncachedTokens: -1 } } } } },
      { ...wire, stats: { ...wire.stats, sessions: { 's-live': 3 } } },
    ]) {
      assert.equal(warmingStatsOf(broken), null, JSON.stringify(broken))
    }
  })

  test('today, allTime, or failed outside the shape reads as nothing', () => {
    for (const key of ['today', 'allTime'] as const) {
      const broken = { ...WIRE_WARMING, stats: { ...WIRE_WARMING.stats, [key]: null } }
      assert.equal(warmingStatsOf(broken), null, key)
    }
    assert.equal(warmingStatsOf({ ...WIRE_WARMING, stats: { ...WIRE_WARMING.stats, failed: -1 } }), null)
    assert.equal(warmingStatsOf({ ...WIRE_WARMING, stats: { ...WIRE_WARMING.stats, failed: 1.5 } }), null)
    assert.equal(warmingStatsOf({ ...WIRE_WARMING, stats: { ...WIRE_WARMING.stats, failed: '2' } }), null)
  })

  test('each counter must be a non-negative integer, one bad field at a time', () => {
    for (const field of ['warms', 'needless', 'noFollowup', 'expired', 'savedCacheTokens'] as const) {
      for (const bad of [-1, 1.5, '3', null]) {
        const label = field + ' = ' + String(bad)
        const brokenToday = { ...WIRE_WARMING, stats: { ...WIRE_WARMING.stats, today: { ...WIRE_WARMING.stats.today, [field]: bad } } }
        assert.equal(warmingStatsOf(brokenToday), null, 'today.' + label)
        const brokenAll = { ...WIRE_WARMING, stats: { ...WIRE_WARMING.stats, allTime: { ...WIRE_WARMING.stats.allTime, [field]: bad } } }
        assert.equal(warmingStatsOf(brokenAll), null, 'allTime.' + label)
      }
    }
  })

  test('today.day must be a calendar day string', () => {
    for (const bad of ['2026-10', '2026/10/20', 20261020, null]) {
      const broken = { ...WIRE_WARMING, stats: { ...WIRE_WARMING.stats, today: { ...WIRE_WARMING.stats.today, day: bad } } }
      assert.equal(warmingStatsOf(broken), null, String(bad))
    }
  })
})

describe('readWarmingStats', () => {
  test('the landing figure reports through the refresh and is served from memory next time', async () => {
    const { calls } = stubRoute(WIRE_WARMING)
    const first = collector()
    assert.equal(readWarmingStats(first.onRefresh), null, 'the first open has nothing to paint')
    await drain()
    assert.deepEqual(first.seen, [PARSED_WARMING])
    assert.equal(calls(), 1)
    const second = collector()
    assert.deepEqual(readWarmingStats(second.onRefresh), PARSED_WARMING, 'the memory figure paints at once')
    await drain()
    assert.equal(calls(), 2, 'every open revalidates regardless of what it could paint')
  })

  test('an open while a read is in flight joins that read and lands with it', async () => {
    const route = stubRoute(WIRE_WARMING)
    const a = collector()
    const b = collector()
    assert.equal(readWarmingStats(a.onRefresh), null)
    assert.equal(readWarmingStats(b.onRefresh), null, 'nothing cached until a read lands')
    await drain()
    assert.deepEqual(a.seen, [PARSED_WARMING], 'the open that started the read reports its figure')
    assert.deepEqual(b.seen, [PARSED_WARMING], 'the joining open takes the landing for its own too')
    assert.equal(route.calls(), 1, 'one read serves both opens')
  })

  test('every absent answer notifies nobody and caches nothing', async () => {
    for (const [label, body, mode] of [
      ['route absent (404)', undefined, 'status'],
      ['transport down', undefined, 'reject'],
      ['stats off', { schema: 1, statsEnabled: false, stats: null }, 'ok'],
      ['future schema', { schema: 4, statsEnabled: true, stats: {} }, 'ok'],
    ] as [string, unknown, 'ok' | 'reject' | 'status'][]) {
      resetWarmingStats()
      stubRoute(body, mode)
      const { seen, onRefresh } = collector()
      assert.equal(readWarmingStats(onRefresh), null, label)
      await drain()
      assert.equal(seen.length, 0, label)
      assert.equal(readWarmingStats(() => {}), null, label + ' — nothing was cached')
    }
  })

  test('a reset drops the cached figure', async () => {
    stubRoute(WIRE_WARMING)
    readWarmingStats(() => {})
    await drain()
    assert.deepEqual(readWarmingStats(() => {}), PARSED_WARMING)
    resetWarmingStats()
    assert.equal(readWarmingStats(() => {}), null)
  })

  test('a read a reset superseded lands nowhere and leaves the next read intact', async () => {
    const answers: ((body: unknown) => void)[] = []
    vi.stubGlobal('fetch', () => new Promise((resolve) => {
      answers.push(body => { resolve({ ok: true, status: 200, json: async () => body }) })
    }))
    const stale = collector()
    readWarmingStats(stale.onRefresh)
    resetWarmingStats()
    const fresh = collector()
    const joiner = collector()
    readWarmingStats(fresh.onRefresh)
    answers[0](WIRE_WARMING)
    await drain()
    assert.deepEqual(stale.seen, [], 'the superseded read notifies nobody')
    assert.equal(readWarmingStats(joiner.onRefresh), null, 'nor caches its figure; the fresh read is still in flight')
    assert.equal(answers.length, 2, 'the joiner rides the fresh read instead of starting a third')
    answers[1](WIRE_WARMING)
    await drain()
    assert.deepEqual(fresh.seen, [PARSED_WARMING])
    assert.deepEqual(joiner.seen, [PARSED_WARMING])
  })
})
