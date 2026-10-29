// The warming card (src/client/components/warmingCard.tsx): dsh-warm's ledger priced against the
// client's model price book. Schema 2 draws the money verdict — the scope's net headline, a
// saved-vs-spent bar pair on one cost scale, segment legend, ping counts demoted to a dim line.
// The scope follows the doctrine: a session prop leads that session's own bucket (a pruned bucket
// falls back to the day), and the unproped overview instance leads all-time with the day as a dim
// line. Schema 1 keeps the count ring (today's pings by outcome, the day's cache saving in the
// center). Nothing answered renders nothing.

import { createElement as h } from 'react'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, test, vi } from 'vitest'
import { Donut } from '../../../src/client/components/donut'
import { makeWarmingCard } from '../../../src/client/components/warmingCard'
import { resetModelPrices, setModelPricesLoader } from '../../../src/client/modelPrices'
import { resetWarmingStats } from '../../../src/client/warming'
import { flush, hover, makeKit, mount, query, queryAll, text, until } from '../helpers/kit'

const kit = makeKit()

// The price book the money view prices against: the registry's real carrier of the journal's model
// string (mistral lists `zai-glm-5-3` verbatim); rates are USD per 1M tokens (miss 1, hit 0.1).
const PROVIDERS = {
  mistral: {
    npm: '@ai-sdk/mistral',
    models: {
      'zai-glm-5-3': { cost: { input: 1, output: 4.2, cache_read: 0.1 } },
      'mistral-small-latest': { cost: { input: 0.5, output: 1.5, cache_read: 0.05 } },
    },
  },
}

const WIRE_WARMING = {
  schema: 1,
  statsEnabled: true,
  stats: {
    today: { day: '2026-10-20', warms: 3, needless: 0, noFollowup: 1, expired: 0, savedCacheTokens: 1152 },
    allTime: { warms: 12, needless: 1, noFollowup: 2, expired: 1, savedCacheTokens: 4608 },
    failed: 0,
  },
}

// Schema 2: the per-model money ledger. Priced by PROVIDERS the day saves $2.00 against $0.40 spent
// ($0.10 useful + $0.05 wasted + $0.25 raw); the failed pings' flat figures join the all-time
// verdict by the single-model inference — 100k cache-read into wasted at hit, 50k uncached into raw.
const WIRE_MONEY = {
  schema: 2,
  statsEnabled: true,
  stats: {
    today: {
      day: '2026-10-20', warms: 3, needless: 0, noFollowup: 1, expired: 0, savedCacheTokens: 2_000_000,
      models: {
        'zai-glm-5-3': {
          warms: 3, needless: 0, noFollowup: 1, expired: 0, savedCacheTokens: 2_000_000,
          pingCacheReadTokens: { held: 1_000_000, needless: 0, noFollowup: 500_000, expired: 0 },
          pingUncachedTokens: 250_000,
        },
      },
    },
    allTime: {
      warms: 38, needless: 1, noFollowup: 2, expired: 1, savedCacheTokens: 8_000_000,
      models: {
        'zai-glm-5-3': {
          warms: 38, needless: 1, noFollowup: 2, expired: 1, savedCacheTokens: 8_000_000,
          pingCacheReadTokens: { held: 5_000_000, needless: 500_000, noFollowup: 500_000, expired: 500_000 },
          pingUncachedTokens: 1_000_000,
        },
      },
    },
    failed: 2,
    failedPingTokens: { cacheRead: 100_000, uncached: 50_000 },
  },
}

// Schema 2 with the sessions map: one live session bucket priced by the same book — saved 1M ($1.00)
// against useful 400k ($0.04), wasted 100k ($0.010), raw 100k ($0.10) → net +$0.85. The wire's
// today/all-time figures stay WIRE_MONEY's, so the scoped card carries distinct period figures.
const WIRE_SESSIONS = {
  ...WIRE_MONEY,
  stats: {
    ...WIRE_MONEY.stats,
    sessions: {
      'session-live': {
        warms: 2, needless: 0, noFollowup: 1, expired: 0, savedCacheTokens: 1_000_000,
        models: {
          'zai-glm-5-3': {
            warms: 2, needless: 0, noFollowup: 1, expired: 0, savedCacheTokens: 1_000_000,
            pingCacheReadTokens: { held: 400_000, needless: 0, noFollowup: 100_000, expired: 0 },
            pingUncachedTokens: 100_000,
          },
        },
      },
    },
  },
}

// Schema 3: the failed pings' figures ride per model, so they price against the model's own rates —
// failed cache-read joins wasted at hit price, failed uncached joins full-price at miss price. The
// flat failedPingTokens mirror the per-model sums (authoritative totals). Priced by PROVIDERS the
// day nets +$1.48 (saved $2.00 against $0.52 spent) and the all-time ledger +$6.12 ($1.88 spent).
// The today model carries failed figures beyond the wire contract (failed stays all-time only) —
// deliberate forward-compat proof that the day scope prices its own per-model figures too.
const WIRE_SCHEMA3 = {
  schema: 3,
  statsEnabled: true,
  stats: {
    today: {
      day: '2026-10-20', warms: 3, needless: 0, noFollowup: 1, expired: 0, savedCacheTokens: 2_000_000,
      models: {
        'zai-glm-5-3': {
          warms: 3, needless: 0, noFollowup: 1, expired: 0, savedCacheTokens: 2_000_000,
          pingCacheReadTokens: { held: 1_000_000, needless: 0, noFollowup: 500_000, expired: 0 },
          pingUncachedTokens: 250_000,
          failedPingTokens: { cacheRead: 200_000, uncached: 100_000 },
        },
      },
    },
    allTime: {
      warms: 38, needless: 1, noFollowup: 2, expired: 1, savedCacheTokens: 8_000_000,
      models: {
        'zai-glm-5-3': {
          warms: 38, needless: 1, noFollowup: 2, expired: 1, savedCacheTokens: 8_000_000,
          pingCacheReadTokens: { held: 5_000_000, needless: 500_000, noFollowup: 500_000, expired: 500_000 },
          pingUncachedTokens: 1_000_000,
          failedPingTokens: { cacheRead: 300_000, uncached: 200_000 },
        },
      },
    },
    failed: 2,
    failedPingTokens: { cacheRead: 300_000, uncached: 200_000 },
  },
}

function stubRoute(body: unknown | undefined, ok = true): void {
  vi.stubGlobal('fetch', async () => ({ ok, status: ok ? 200 : 404, json: async () => body }))
}

function rowOf(container: HTMLElement, i: number): { pct: string; label: string; count: string; on: boolean } {
  const row = queryAll(container, '.lc-sl-row')[i]
  return {
    pct: row.querySelector('.lc-sl-pct')?.textContent ?? '',
    label: row.querySelector('.lc-sl-label')?.textContent ?? '',
    count: row.querySelector('.lc-sl-sub')?.textContent ?? '',
    on: row.classList.contains('lc-sl-row-on'),
  }
}

function legOf(container: HTMLElement, i: number): { label: string; tok: string; cost: string } {
  const row = queryAll(container, '.lc-warm-leg-row')[i]
  return {
    label: row.querySelector('.lc-warm-leg-label')?.textContent ?? '',
    tok: row.querySelector('.lc-warm-leg-tok')?.textContent ?? '',
    cost: row.querySelector('.lc-warm-leg-cost')?.textContent ?? '',
  }
}

function piRowsOf(container: HTMLElement): { label: string; value: string }[] {
  return queryAll(container, '.lc-pi-row').map(row => ({
    label: row.querySelector('.lc-pi-label')?.textContent ?? '',
    value: row.querySelector('.lc-pi-value')?.textContent ?? '',
  }))
}

beforeEach(() => {
  resetModelPrices()
  setModelPricesLoader(() => Promise.resolve(PROVIDERS))
})

afterEach(() => {
  resetModelPrices()
  resetWarmingStats()
  vi.unstubAllGlobals()
})

describe('WarmingCard', () => {
  test('absent, failed, and stats-off reads render nothing', async () => {
    for (const [label, body, ok] of [
      ['route absent', undefined, false],
      ['stats off', { schema: 1, statsEnabled: false, stats: null }, true],
    ] as [string, unknown, boolean][]) {
      stubRoute(body, ok)
      const Card = makeWarmingCard(kit, Donut)
      const card = await mount(h(Card, {}))
      await flush()
      assert.equal(text(card.container), '', label)
      await card.unmount()
      resetWarmingStats()
    }
  })

  test('a still-pending read renders nothing until it lands', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.stubGlobal('fetch', async () => {
      await gate
      return { ok: true, status: 200, json: async () => WIRE_WARMING }
    })
    const Card = makeWarmingCard(kit, Donut)
    const card = await mount(h(Card, {}))
    await flush()
    assert.equal(text(card.container), '', 'nothing while the read is in flight')
    release()
    await until(() => text(card.container) !== '', 'the landing paints the card')
    await card.unmount()
  })

  test('a schema-1 answer partitions today by outcome around the saved center', async () => {
    stubRoute(WIRE_WARMING)
    const Card = makeWarmingCard(kit, Donut)
    const card = await mount(h(Card, {}))
    await until(() => query(card.container, '.lc-donut-center') !== null, 'the card paints')
    // Center: the verifiable figure — today's cache saving.
    assert.equal(query(card.container, '.lc-donut-center b').textContent, '1.2k')
    assert.equal(query(card.container, '.lc-donut-center span').textContent, 'Cache saved today')
    // Title corner: no date — the ledger is cumulative, and a stale `day` would read as current.
    assert.equal(card.container.querySelector('.lc-card-rate'), null, 'the warming card carries no rate corner')
    const hint = query<HTMLAnchorElement>(card.container, 'a.lc-pi-hint')
    assert.equal(hint.textContent, 'keeps the provider cache warm across tool runs')
    assert.equal(hint.href, 'https://github.com/JanEickholt/dsh-warm')
    // Ring legend: warms 3 = held 2 + no-follow-up 1; both waste-zero rows stay listed, dimmed.
    const rows = queryAll(card.container, '.lc-sl-row')
    assert.equal(rows.length, 4)
    assert.deepEqual(rowOf(card.container, 0), { pct: '66.7%', label: 'held or open', count: '2', on: false })
    assert.deepEqual(rowOf(card.container, 1), { pct: '0.0%', label: 'warm anyway', count: '0', on: false })
    assert.deepEqual(rowOf(card.container, 2), { pct: '33.3%', label: 'no follow-up', count: '1', on: false })
    assert.deepEqual(rowOf(card.container, 3), { pct: '0.0%', label: 'cache died before follow-up', count: '0', on: false })
    assert.equal(rows[1].classList.contains('lc-sl-row-dim'), true, 'zero slices dim')
    assert.equal(rows[3].classList.contains('lc-sl-row-dim'), true, 'zero slices dim')
    assert.equal(rows[0].classList.contains('lc-sl-row-dim'), false)
    // Below the ring: the all-time ledger rows.
    assert.deepEqual(piRowsOf(card.container), [
      { label: 'Warmed all-time', value: '12' },
      { label: 'Cache saved all-time', value: '4.6k' },
      { label: 'Failed pings (all-time)', value: '0' },
    ])
    await card.unmount()
  })

  test('a warms-only day keeps every outcome row listed and dimmed', async () => {
    stubRoute({
      schema: 1, statsEnabled: true,
      stats: {
        today: { day: '2026-10-20', warms: 0, needless: 0, noFollowup: 0, expired: 0, savedCacheTokens: 0 },
        allTime: { warms: 12, needless: 1, noFollowup: 2, expired: 1, savedCacheTokens: 4608 },
        failed: 0,
      },
    })
    const Card = makeWarmingCard(kit, Donut)
    const card = await mount(h(Card, {}))
    await until(() => query(card.container, '.lc-donut-center') !== null, 'the card paints')
    assert.equal(query(card.container, '.lc-donut-center b').textContent, '0')
    const rows = queryAll(card.container, '.lc-sl-row')
    assert.equal(rows.length, 4, 'a tracked-but-empty day still lists every bucket')
    for (const row of rows) {
      assert.equal(row.classList.contains('lc-sl-row-dim'), true)
      assert.equal(row.querySelector('.lc-sl-pct')?.textContent, '—')
    }
    await card.unmount()
  })

  test('hovering a legend row lights it alone', async () => {
    stubRoute(WIRE_WARMING)
    const Card = makeWarmingCard(kit, Donut)
    const card = await mount(h(Card, {}))
    await until(() => queryAll(card.container, '.lc-sl-row').length === 4, 'the card paints')
    await hover(queryAll(card.container, '.lc-sl-row')[2])
    const states = queryAll(card.container, '.lc-sl-row').map(r => r.classList.contains('lc-sl-row-on'))
    assert.deepEqual(states, [false, false, true, false])
    await card.unmount()
  })

  test('a session prop whose bucket the host pruned falls back to the day story: net headline, bar pair, legend, demoted counts', async () => {
    stubRoute(WIRE_MONEY)
    const Card = makeWarmingCard(kit, Donut)
    const card = await mount(h(Card, { session: 'session-pruned' }))
    // The first paint dashes (the book lands after the stats); the priced verdict follows.
    await until(() => card.container.querySelector('.lc-warm-hero-value')?.textContent === '+$1.60', 'the priced verdict paints')
    // Hero: the day's net and the equation beneath it.
    assert.equal(query(card.container, '.lc-warm-hero-label').textContent, 'Net today')
    assert.equal(query(card.container, '.lc-warm-hero-eq').textContent, 'saved $2.00 − spent $0.40')
    // Bar pair on one cost scale: saved fills its row, the spend segments seat side by side.
    const bars = queryAll(card.container, '.lc-warm-bar')
    assert.equal(bars.length, 2)
    assert.equal(query(bars[0], 'i').style.width, '100%')
    assert.deepEqual(queryAll(bars[1], 'i').map(s => [s.style.left, s.style.width]), [
      ['0%', '5%'], ['5%', '2.5%'], ['7.5%', '12.5%'],
    ])
    // Legend: the token basis dim against the priced figure.
    assert.deepEqual([0, 1, 2, 3].map(i => legOf(card.container, i)), [
      { label: 'Saved', tok: '2.0M', cost: '$2.00' },
      { label: 'Useful spend', tok: '1.0M', cost: '$0.10' },
      { label: 'Wasted spend', tok: '500.0k', cost: '$0.050' },
      { label: 'Full-price spend', tok: '250.0k', cost: '$0.25' },
    ])
    // The ring is gone; the ping counts demote to one dim line.
    assert.equal(card.container.querySelector('.lc-donut'), null)
    // Title corner: no date in the money view either.
    assert.equal(card.container.querySelector('.lc-card-rate'), null, 'the warming card carries no rate corner')
    assert.equal(query(card.container, '.lc-warm-counts').textContent, '3 pings · 2 held or open · 0 warm anyway · 1 no follow-up · 0 cache died before follow-up')
    // Below: the all-time verdict over the same count rows as before.
    assert.deepEqual(piRowsOf(card.container), [
      { label: 'Net all-time', value: '+$6.29' },
      { label: 'Warmed all-time', value: '38' },
      { label: 'Cache saved all-time', value: '8.0M' },
      { label: 'Failed pings (all-time)', value: '2' },
    ])
    await card.unmount()
  })

  test('a model the book cannot price shows tokens against honest dashes', async () => {
    const wire = {
      ...WIRE_MONEY,
      stats: {
        ...WIRE_MONEY.stats,
        today: { ...WIRE_MONEY.stats.today, models: { 'mystery-7b': WIRE_MONEY.stats.today.models['zai-glm-5-3'] } },
        allTime: { ...WIRE_MONEY.stats.allTime, models: { 'mystery-7b': WIRE_MONEY.stats.allTime.models['zai-glm-5-3'] } },
      },
    }
    stubRoute(wire)
    const Card = makeWarmingCard(kit, Donut)
    const card = await mount(h(Card, { session: 'session-pruned' }))
    await until(() => card.container.querySelector('.lc-warm-hero-value') !== null, 'the card paints')
    // No priced figure: the verdict abstains, the equation and the cost-scale bars stay out.
    assert.equal(query(card.container, '.lc-warm-hero-value').textContent, '—')
    assert.equal(card.container.querySelector('.lc-warm-hero-eq'), null)
    assert.equal(card.container.querySelector('.lc-warm-bars'), null)
    // The token basis still shows; every cost reads as a dash, never a silent zero.
    assert.deepEqual([0, 1, 2, 3].map(i => legOf(card.container, i)), [
      { label: 'Saved', tok: '2.0M', cost: '—' },
      { label: 'Useful spend', tok: '1.0M', cost: '—' },
      { label: 'Wasted spend', tok: '500.0k', cost: '—' },
      { label: 'Full-price spend', tok: '250.0k', cost: '—' },
    ])
    assert.equal(query(card.container, '.lc-warm-counts').textContent, '3 pings · 2 held or open · 0 warm anyway · 1 no follow-up · 0 cache died before follow-up')
    assert.deepEqual(piRowsOf(card.container)[0], { label: 'Net all-time', value: '—' })
    await card.unmount()
  })

  test('a day that spent more than it saved shows the loss', async () => {
    // The ping missed the cache: $0.50 raw against $0.10 saved.
    const day = {
      warms: 1, needless: 0, noFollowup: 0, expired: 0, savedCacheTokens: 100_000,
      pingCacheReadTokens: { held: 0, needless: 0, noFollowup: 0, expired: 0 },
      pingUncachedTokens: 500_000,
    }
    stubRoute({
      schema: 2, statsEnabled: true,
      stats: {
        // No failedPingTokens: the usage block joined the wire after this ledger's counts.
        today: { day: '2026-10-20', warms: 1, needless: 0, noFollowup: 0, expired: 0, savedCacheTokens: 100_000, models: { 'zai-glm-5-3': day } },
        allTime: { warms: 1, needless: 0, noFollowup: 0, expired: 0, savedCacheTokens: 100_000, models: { 'zai-glm-5-3': day } },
        failed: 0,
      },
    })
    const Card = makeWarmingCard(kit, Donut)
    const card = await mount(h(Card, { session: 'session-pruned' }))
    await until(() => card.container.querySelector('.lc-warm-hero-value')?.textContent === '−$0.40', 'the priced verdict paints')
    const value = query(card.container, '.lc-warm-hero-value')
    assert.equal(value.classList.contains('lc-warm-hero-loss'), true)
    assert.equal(query(card.container, '.lc-warm-hero-eq').textContent, 'saved $0.10 − spent $0.50')
    const bars = queryAll(card.container, '.lc-warm-bar')
    assert.equal(query(bars[0], 'i').style.width, '20%')
    const spend = queryAll(bars[1], 'i')
    assert.equal(spend.length, 1, 'only the raw segment carries cost')
    assert.deepEqual([spend[0].style.left, spend[0].style.width], ['0%', '100%'])
    await card.unmount()
  })

  test('failed pings price only when their model is unambiguous', async () => {
    // All-time holds two models and failed usage: the failed tokens cannot be attributed, so the
    // all-time verdict abstains while the day's — single model, no failed tokens — stays priced.
    stubRoute({
      ...WIRE_MONEY,
      stats: {
        ...WIRE_MONEY.stats,
        allTime: {
          warms: 40, needless: 1, noFollowup: 2, expired: 1, savedCacheTokens: 8_100_000,
          models: {
            'zai-glm-5-3': WIRE_MONEY.stats.allTime.models['zai-glm-5-3'],
            'mistral-small-latest': {
              warms: 2, needless: 0, noFollowup: 0, expired: 0, savedCacheTokens: 100_000,
              pingCacheReadTokens: { held: 50_000, needless: 0, noFollowup: 0, expired: 0 },
              pingUncachedTokens: 10_000,
            },
          },
        },
      },
    })
    const Card = makeWarmingCard(kit, Donut)
    const card = await mount(h(Card, { session: 'session-pruned' }))
    await until(() => card.container.querySelector('.lc-warm-hero-value')?.textContent === '+$1.60', 'today prices')
    assert.deepEqual(piRowsOf(card.container)[0], { label: 'Net all-time', value: '—' })
    await card.unmount()
  })

  test('a live session bucket leads the session view: scoped verdict, bars, and counts, the day demoted to a line', async () => {
    stubRoute(WIRE_SESSIONS)
    const Card = makeWarmingCard(kit, Donut)
    const card = await mount(h(Card, { session: 'session-live' }))
    await until(() => card.container.querySelector('.lc-warm-hero-value')?.textContent === '+$0.85', 'the session verdict prices')
    // Hero: the session's own net, the day reduced to a dim line beneath it.
    assert.equal(query(card.container, '.lc-warm-hero-label').textContent, 'Net this session')
    assert.equal(query(card.container, '.lc-warm-hero-eq').textContent, 'saved $1.00 − spent $0.15')
    assert.equal(query(card.container, '.lc-warm-sub').textContent, 'today +$1.60')
    // The bar pair prices the session's own ledger on one cost scale.
    const bars = queryAll(card.container, '.lc-warm-bar')
    assert.equal(query(bars[0], 'i').style.width, '100%')
    assert.deepEqual(queryAll(bars[1], 'i').map(s => [s.style.left, s.style.width]), [
      ['0%', '4%'], ['4%', '1%'], ['5%', '10%'],
    ])
    assert.deepEqual([0, 1, 2, 3].map(i => legOf(card.container, i)), [
      { label: 'Saved', tok: '1.0M', cost: '$1.00' },
      { label: 'Useful spend', tok: '400.0k', cost: '$0.040' },
      { label: 'Wasted spend', tok: '100.0k', cost: '$0.010' },
      { label: 'Full-price spend', tok: '100.0k', cost: '$0.10' },
    ])
    // Counts scope to the session's own pings.
    assert.equal(query(card.container, '.lc-warm-counts').textContent, '2 pings · 1 held or open · 0 warm anyway · 1 no follow-up · 0 cache died before follow-up')
    // Footer: the all-time totals, verdict row included.
    assert.deepEqual(piRowsOf(card.container), [
      { label: 'Net all-time', value: '+$6.29' },
      { label: 'Warmed all-time', value: '38' },
      { label: 'Cache saved all-time', value: '8.0M' },
      { label: 'Failed pings (all-time)', value: '2' },
    ])
    await card.unmount()
  })

  test('the overview instance (no session prop) leads all-time with the day as the dim line', async () => {
    stubRoute(WIRE_MONEY)
    const Card = makeWarmingCard(kit, Donut)
    const card = await mount(h(Card, {}))
    await until(() => card.container.querySelector('.lc-warm-hero-value')?.textContent === '+$6.29', 'the all-time verdict prices')
    // Hero: the all-time net; the day rides along as the dim line.
    assert.equal(query(card.container, '.lc-warm-hero-label').textContent, 'Net all-time')
    assert.equal(query(card.container, '.lc-warm-hero-eq').textContent, 'saved $8.00 − spent $1.71')
    assert.equal(query(card.container, '.lc-warm-sub').textContent, 'today +$1.60')
    // Legacy schema-2 wire: no per-model failed figures, so the flat figures infer through the
    // single-model path — 100k cache-read into wasted at hit, 50k uncached into raw at miss.
    const bars = queryAll(card.container, '.lc-warm-bar')
    assert.equal(query(bars[0], 'i').style.width, '100%')
    assert.deepEqual(queryAll(bars[1], 'i').map(s => [s.style.left, s.style.width]), [
      ['0%', '6.25%'], ['6.25%', '2%'], ['8.25%', '13.13%'],
    ])
    assert.deepEqual([0, 1, 2, 3].map(i => legOf(card.container, i)), [
      { label: 'Saved', tok: '8.0M', cost: '$8.00' },
      { label: 'Useful spend', tok: '5.0M', cost: '$0.50' },
      { label: 'Wasted spend', tok: '1.6M', cost: '$0.16' },
      { label: 'Full-price spend', tok: '1.1M', cost: '$1.05' },
    ])
    assert.equal(query(card.container, '.lc-warm-counts').textContent, '38 pings · 32 held or open · 1 warm anyway · 2 no follow-up · 1 cache died before follow-up')
    // The hero already carries the all-time verdict; the footer rows keep the plain totals.
    assert.deepEqual(piRowsOf(card.container), [
      { label: 'Warmed all-time', value: '38' },
      { label: 'Cache saved all-time', value: '8.0M' },
      { label: 'Failed pings (all-time)', value: '2' },
    ])
    await card.unmount()
  })

  test('schema 3 prices each model failed pings into their own buckets; the hint decodes the legend', async () => {
    stubRoute(WIRE_SCHEMA3)
    const Card = makeWarmingCard(kit, Donut)
    // The overview: all-time scope — the failed figures price at the model's own rates, and the
    // all-time held residual loses the 2 failed pings.
    const card = await mount(h(Card, {}))
    await until(() => card.container.querySelector('.lc-warm-hero-value')?.textContent === '+$6.12', 'the all-time verdict prices')
    assert.equal(query(card.container, '.lc-warm-hero-eq').textContent, 'saved $8.00 − spent $1.88')
    assert.equal(query(card.container, '.lc-warm-sub').textContent, 'today +$1.48', 'the day rides as the dim line')
    assert.deepEqual([0, 1, 2, 3].map(i => legOf(card.container, i)), [
      { label: 'Saved', tok: '8.0M', cost: '$8.00' },
      { label: 'Useful spend', tok: '5.0M', cost: '$0.50' },
      { label: 'Wasted spend', tok: '1.8M', cost: '$0.18' },
      { label: 'Full-price spend', tok: '1.2M', cost: '$1.20' },
    ])
    assert.equal(query(card.container, '.lc-warm-counts').textContent, '38 pings · 32 held or open · 1 warm anyway · 2 no follow-up · 1 cache died before follow-up')
    // The hint line renders once under the legend, after the dim day line.
    const subs = queryAll(card.container, '.lc-warm-sub')
    assert.equal(subs.length, 2, 'day line + hint line')
    assert.equal(subs[1].textContent, "Wasted spend = wasted pings' cache-read tokens at hit price; Full-price spend = every ping's uncached tokens at full price.")
    await card.unmount()
    // The day scope prices its own per-model failed figures too (fallback view, session pruned).
    const day = await mount(h(Card, { session: 'session-pruned' }))
    await until(() => day.container.querySelector('.lc-warm-hero-value')?.textContent === '+$1.48', 'the day verdict prices')
    assert.equal(query(day.container, '.lc-warm-hero-label').textContent, 'Net today')
    assert.equal(query(day.container, '.lc-warm-hero-eq').textContent, 'saved $2.00 − spent $0.52')
    assert.deepEqual([0, 1, 2, 3].map(i => legOf(day.container, i)), [
      { label: 'Saved', tok: '2.0M', cost: '$2.00' },
      { label: 'Useful spend', tok: '1.0M', cost: '$0.10' },
      { label: 'Wasted spend', tok: '700.0k', cost: '$0.070' },
      { label: 'Full-price spend', tok: '350.0k', cost: '$0.35' },
    ])
    // The day-led fallback carries no day line — the hint stands alone under the legend.
    assert.equal(queryAll(day.container, '.lc-warm-sub').length, 1)
    assert.equal(query(day.container, '.lc-warm-counts').textContent, '3 pings · 2 held or open · 0 warm anyway · 1 no follow-up · 0 cache died before follow-up')
    assert.deepEqual(piRowsOf(day.container)[0], { label: 'Net all-time', value: '+$6.12' })
    await day.unmount()
  })

  test('the flat failed figures past the per-model sums (pre-schema-3 rows) still price', async () => {
    // A ledger upgraded from schema 2: the flat totals keep the legacy failed usage the per-model
    // maps never saw — 100k cache-read at hit ($0.01) and 100k uncached at miss ($0.10) beyond them.
    stubRoute({
      ...WIRE_SCHEMA3,
      stats: { ...WIRE_SCHEMA3.stats, failedPingTokens: { cacheRead: 400_000, uncached: 300_000 } },
    })
    const Card = makeWarmingCard(kit, Donut)
    const card = await mount(h(Card, {}))
    await until(() => card.container.querySelector('.lc-warm-hero-value')?.textContent === '+$6.01', 'the all-time verdict prices')
    assert.equal(query(card.container, '.lc-warm-hero-eq').textContent, 'saved $8.00 − spent $1.99')
    assert.deepEqual([2, 3].map(i => legOf(card.container, i)), [
      { label: 'Wasted spend', tok: '1.9M', cost: '$0.19' },
      { label: 'Full-price spend', tok: '1.3M', cost: '$1.30' },
    ])
    await card.unmount()
  })

  test('per-model failed figures: a zero pair skips, a cache-read-less pair prices, an unpriceable model dashes', async () => {
    // Zai declares a zero failed pair (none observed) and must not shift a bucket; mistral declares
    // failed uncached with no cache-read, pricing at its own miss rate ($0.05, not zai's $0.10).
    const priced = {
      ...WIRE_SCHEMA3,
      stats: {
        ...WIRE_SCHEMA3.stats,
        allTime: {
          ...WIRE_SCHEMA3.stats.allTime,
          models: {
            'zai-glm-5-3': { ...WIRE_SCHEMA3.stats.allTime.models['zai-glm-5-3'], failedPingTokens: { cacheRead: 0, uncached: 0 } },
            'mistral-small-latest': {
              warms: 0, needless: 0, noFollowup: 0, expired: 0, savedCacheTokens: 0,
              pingCacheReadTokens: { held: 0, needless: 0, noFollowup: 0, expired: 0 },
              pingUncachedTokens: 0,
              failedPingTokens: { cacheRead: 0, uncached: 100_000 },
            },
          },
        },
        failedPingTokens: { cacheRead: 0, uncached: 100_000 },
      },
    }
    stubRoute(priced)
    const Card = makeWarmingCard(kit, Donut)
    const card = await mount(h(Card, {}))
    await until(() => card.container.querySelector('.lc-warm-hero-value')?.textContent === '+$6.30', 'the priced verdict paints')
    assert.deepEqual([0, 1, 2, 3].map(i => legOf(card.container, i)), [
      { label: 'Saved', tok: '8.0M', cost: '$8.00' },
      { label: 'Useful spend', tok: '5.0M', cost: '$0.50' },
      { label: 'Wasted spend', tok: '1.5M', cost: '$0.15' },
      { label: 'Full-price spend', tok: '1.1M', cost: '$1.05' },
    ])
    await card.unmount()
    // The failed figures ride a model the book cannot price: their buckets turn to dashes, the
    // priced ones stay honest, and the verdict abstains. The day rides the same unpriceable
    // model, so the dim day line reads as a dash too.
    const dashed = {
      ...WIRE_SCHEMA3,
      stats: {
        ...WIRE_SCHEMA3.stats,
        today: {
          ...WIRE_SCHEMA3.stats.today,
          models: { 'mystery-7b': { ...WIRE_SCHEMA3.stats.today.models['zai-glm-5-3'], failedPingTokens: { cacheRead: 0, uncached: 0 } } },
        },
        allTime: {
          ...WIRE_SCHEMA3.stats.allTime,
          models: {
            'zai-glm-5-3': { ...WIRE_SCHEMA3.stats.allTime.models['zai-glm-5-3'], failedPingTokens: { cacheRead: 0, uncached: 0 } },
            'mystery-7b': {
              warms: 0, needless: 0, noFollowup: 0, expired: 0, savedCacheTokens: 0,
              pingCacheReadTokens: { held: 0, needless: 0, noFollowup: 0, expired: 0 },
              pingUncachedTokens: 0,
              failedPingTokens: { cacheRead: 500_000, uncached: 400_000 },
            },
          },
        },
        failedPingTokens: { cacheRead: 500_000, uncached: 400_000 },
      },
    }
    stubRoute(dashed)
    const dash = await mount(h(Card, {}))
    await until(() => dash.container.querySelector('.lc-warm-hero-value')?.textContent === '—', 'the dashed verdict paints')
    assert.equal(queryAll(dash.container, '.lc-warm-sub')[0].textContent, 'today —')
    assert.equal(dash.container.querySelector('.lc-warm-hero-eq'), null)
    assert.equal(dash.container.querySelector('.lc-warm-bars'), null)
    assert.deepEqual([0, 1, 2, 3].map(i => legOf(dash.container, i)), [
      { label: 'Saved', tok: '8.0M', cost: '$8.00' },
      { label: 'Useful spend', tok: '5.0M', cost: '$0.50' },
      { label: 'Wasted spend', tok: '2.0M', cost: '—' },
      { label: 'Full-price spend', tok: '1.4M', cost: '—' },
    ])
    await dash.unmount()
  })

  test('a zero-cost ledger paints the money view without a single bar', async () => {
    const empty = {
      warms: 0, needless: 0, noFollowup: 0, expired: 0, savedCacheTokens: 0,
      pingCacheReadTokens: { held: 0, needless: 0, noFollowup: 0, expired: 0 },
      pingUncachedTokens: 0,
    }
    stubRoute({
      schema: 2,
      statsEnabled: true,
      stats: {
        today: { day: '2026-10-20', warms: 0, needless: 0, noFollowup: 0, expired: 0, savedCacheTokens: 0, models: { 'zai-glm-5-3': empty } },
        allTime: { warms: 0, needless: 0, noFollowup: 0, expired: 0, savedCacheTokens: 0, models: { 'zai-glm-5-3': empty } },
        failed: 0,
      },
    })
    const Card = makeWarmingCard(kit, Donut)
    const card = await mount(h(Card, {}))
    await until(() => card.container.querySelector('.lc-warm-hero-value') !== null, 'the zero-cost verdict paints')
    assert.equal(query(card.container, '.lc-warm-hero-value').textContent, '+$0.0')
    assert.equal(query(card.container, '.lc-warm-hero-eq').textContent, 'saved $0.0 − spent $0.0')
    // The bars section renders, but no segment carries cost to draw.
    assert.notEqual(card.container.querySelector('.lc-warm-bars'), null)
    assert.equal(queryAll(card.container, '.lc-warm-bar i').length, 0)
    assert.deepEqual([0, 1, 2, 3].map(i => legOf(card.container, i)), [
      { label: 'Saved', tok: '0', cost: '$0.0' },
      { label: 'Useful spend', tok: '0', cost: '$0.0' },
      { label: 'Wasted spend', tok: '0', cost: '$0.0' },
      { label: 'Full-price spend', tok: '0', cost: '$0.0' },
    ])
    assert.equal(query(card.container, '.lc-warm-counts').textContent, '0 pings · 0 held or open · 0 warm anyway · 0 no follow-up · 0 cache died before follow-up')
    await card.unmount()
  })

  test('the zh dashboard prices the verdict in CNY', async () => {
    stubRoute(WIRE_MONEY)
    const Card = makeWarmingCard(makeKit('zh'), Donut)
    const card = await mount(h(Card, {}))
    await until(() => card.container.querySelector('.lc-warm-hero-value')?.textContent === '+¥41.93', 'the CNY verdict prices')
    assert.equal(query(card.container, '.lc-warm-hero-eq').textContent, '省 ¥53.33 − 花 ¥11.40')
    assert.deepEqual([0, 1, 2, 3].map(i => legOf(card.container, i).cost), ['¥53.33', '¥3.33', '¥1.07', '¥7.00'])
    await card.unmount()
  })
})
