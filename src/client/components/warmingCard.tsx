/** The warming card in the Insights head row: dsh-warm's ledger priced against the client's model
 * price book — money is the story. Schema 2's per-model ledger draws the verdict: the scope's net
 * (credit saved − useful spend − wasted spend − raw spend) as the headline, a saved-vs-spent bar
 * pair on one cost scale beneath it, the segment figures in a legend, and the ping counts demoted
 * to a dim line. The scope follows the doctrine: the overview (no session prop) leads all-time, a
 * session prop leads that session's own bucket, and a session whose bucket the host pruned falls
 * back to the day — never an empty card; wherever the scope outgrows the day, the day rides along
 * as a dim line. Schema 1 keeps the ring story: today's pings by outcome, the day's verifiable
 * cache saving in the center, zero slices listed dimmed. Nothing answered renders nothing — a
 * deployment without dsh-warm never sees the card. Neither branch carries a date corner: the
 * ledger is cumulative with a today sub-line, and a stale `day` would read as current. */

import { useState, type ReactElement } from 'react'
import { formatCost, priceOf, toCurrency, type CostCurrency, type ModelBook, type PriceTriple } from '../cost'
import { useModelPrices } from '../modelPrices'
import { readWarmingStats, type WarmingModelCounters, type WarmingStats } from '../warming'
import type { ViewKit } from '../viewkit'

import type { DonutProps } from './donut'
import { SliceList } from './sliceList'
import type { SliceRow } from './sliceList'

const WARMING_REPO = 'https://github.com/JanEickholt/dsh-warm'

// Ring outcome colors (schema 1): held is the productive rest,
// the three waste causes get their own hues (expired reads as the loss it is).
const HELD_COLOR = 'var(--color-green-500)'
const NEEDLESS_COLOR = 'var(--color-amber-500)'
const NO_FOLLOWUP_COLOR = 'var(--color-purple-500)'
const EXPIRED_COLOR = 'var(--color-red-500)'

// Money colors (schema 2): saved reads as gain; the spend buckets read as what they bought — useful
// spend kept the cache warm to a credited follow-up, wasted spend bought nothing, raw spend is the
// full price the cache-miss pings paid.
const SAVED_COLOR = 'var(--color-green-500)'
const USEFUL_COLOR = 'var(--color-blue-500)'
const WASTED_COLOR = 'var(--color-amber-500)'
const RAW_COLOR = 'var(--color-red-500)'

/** One money figure: the token basis always shows; the cost is null when any contributing model is
 * unpriceable, so a partial sum never poses as the verdict. */
interface MoneySeg {
  tokens: number
  cost: number | null
}

/** One period's priced ledger: credit (saved) against the three spend buckets. */
interface MoneyLedger {
  saved: MoneySeg
  useful: MoneySeg
  wasted: MoneySeg
  raw: MoneySeg
}

/** The display currency: the kit carries no locale service, so a CJK-valued probe key means the zh
 * dictionary is active and the dashboard's CNY face applies (displayCurrencyOf needs a LocaleService). */
function currencyOf(t: ViewKit['t']): CostCurrency {
  return /[\u4e00-\u9fff]/.test(t('warming.title')) ? 'cny' : 'usd'
}

/** The cost face of a USD figure; unpriceable reads as an honest dash, never a silent zero. */
function costOf(usd: number | null, currency: CostCurrency): string {
  return usd === null ? '—' : formatCost(toCurrency(usd, currency), currency)
}

/** The verdict face: signed, so the direction reads at a glance. */
function verdictOf(net: number | null, currency: CostCurrency): string {
  if (net === null) return '—'
  return (net >= 0 ? '+' : '−') + formatCost(toCurrency(Math.abs(net), currency), currency)
}

/** Sum one segment over the models: `tokensOf` picks the basis, `usdOf` picks the rate side (miss
 * prices what a cache miss pays full, hit prices what a cache read pays). The journal's model string
 * carries no provider, so the price resolves through the book's model-side index (empty provider). */
function segOf(
  models: Record<string, WarmingModelCounters>,
  book: ModelBook | null,
  tokensOf: (m: WarmingModelCounters) => number,
  usdOf: (rate: PriceTriple) => number,
): MoneySeg {
  let tokens = 0
  let cost = 0
  let unpriced = false
  for (const id of Object.keys(models)) {
    const n = tokensOf(models[id])
    if (n === 0) continue
    tokens += n
    const rate = priceOf(book, '', id)
    if (rate === null) {
      unpriced = true
      continue
    }
    cost += (n / 1e6) * usdOf(rate)
  }
  return { tokens, cost: unpriced ? null : cost }
}

/** The ping cost basis of the three waste outcomes combined — the cache-read tokens that bought
 * nothing. */
function wastedCacheReadOf(m: WarmingModelCounters): number {
  const p = m.pingCacheReadTokens
  return p.needless + p.noFollowup + p.expired
}

/** Two priced figures merge; an unpriced side keeps the merged figure a dash, never a silent zero. */
function mergeSeg(a: MoneySeg, b: MoneySeg): MoneySeg {
  return { tokens: a.tokens + b.tokens, cost: a.cost === null || b.cost === null ? null : a.cost + b.cost }
}

/** The period's priced ledger per the wire contract. Schema 3's per-model failed figures price
 * against the model's own rates — the cache-read a failed ping still spent joins wasted at hit
 * price, its uncached input joins raw at miss price; an unpriceable model keeps its dash. The
 * pre-schema-3 wire carries only flat failed figures, which price by the same single-model
 * inference (the failed pings carry no model of their own, so the ledger must hold exactly one
 * for the ping's model to be unambiguous): the uncached joins raw at miss, the cache-read joins
 * wasted at hit. */
function moneyOf(
  models: Record<string, WarmingModelCounters>,
  flatFailed: { cacheRead: number; uncached: number },
  book: ModelBook | null,
): MoneyLedger {
  const saved = segOf(models, book, m => m.savedCacheTokens, r => r.miss)
  const useful = segOf(models, book, m => m.pingCacheReadTokens.held, r => r.hit)
  let wasted = segOf(models, book, wastedCacheReadOf, r => r.hit)
  let raw = segOf(models, book, m => m.pingUncachedTokens, r => r.miss)
  let perModelFailed = 0
  for (const id of Object.keys(models)) {
    const f = models[id].failedPingTokens
    if (f === undefined || (f.cacheRead === 0 && f.uncached === 0)) continue
    perModelFailed += f.cacheRead + f.uncached
    const rate = priceOf(book, '', id)
    wasted = mergeSeg(wasted, { tokens: f.cacheRead, cost: rate === null ? null : (f.cacheRead / 1e6) * rate.hit })
    raw = mergeSeg(raw, { tokens: f.uncached, cost: rate === null ? null : (f.uncached / 1e6) * rate.miss })
  }
  if (perModelFailed === 0 && flatFailed.uncached > 0) {
    const ids = Object.keys(models)
    const rate = ids.length === 1 ? priceOf(book, '', ids[0]) : null
    wasted = mergeSeg(wasted, { tokens: flatFailed.cacheRead, cost: rate === null ? null : (flatFailed.cacheRead / 1e6) * rate.hit })
    raw = mergeSeg(raw, { tokens: flatFailed.uncached, cost: rate === null ? null : (flatFailed.uncached / 1e6) * rate.miss })
  }
  return { saved, useful, wasted, raw }
}

/** The priced verdict of one ledger: net, the spend total, and the bars' shared scale — max of
 * credit against spend, so their lengths compare. Null when any figure is unpriced: the hero, the
 * equation, and the bars abstain together, never a partial sum posing as the verdict. */
function pricedOf(m: MoneyLedger): { net: number; spent: number; scale: number } | null {
  const { saved, useful, wasted, raw } = m
  if (saved.cost === null || useful.cost === null || wasted.cost === null || raw.cost === null) return null
  const spent = useful.cost + wasted.cost + raw.cost
  return { net: saved.cost - spent, spent, scale: Math.max(saved.cost, spent) }
}

/** The card's scope: `session` names the bucket the session view leads with; absent (the overview)
 * the card leads all-time. */
interface WarmingCardProps {
  session?: string
}

export function makeWarmingCard(
  kit: ViewKit,
  Donut: (props: DonutProps) => ReactElement,
): (props: WarmingCardProps) => ReactElement | null {
  const { t, fmt, fmtShare } = kit
  return function WarmingCard({ session }: WarmingCardProps): ReactElement | null {
    const [stats, setStats] = useState<WarmingStats | null>(() => readWarmingStats((v) => { setStats(v) }))
    const { book } = useModelPrices()
    const [hoverKey, setHoverKey] = useState<string | null>(null)
    if (stats === null) return null
    const { today, allTime, failed } = stats
    // Today's held residual — credited pings plus chains still open; today's wire carries no
    // failed figure, so nothing else leaves the count.
    const held = Math.max(0, today.warms - today.needless - today.noFollowup - today.expired)
    if (today.models === undefined || allTime.models === undefined) {
      // Schema 1 (or a ledger the boundary stripped to its counts): the ring story, unchanged.
      const rows: SliceRow[] = [
        { key: 'held', color: HELD_COLOR, label: t('warming.held'), pct: fmtShare(held, today.warms), count: fmt(held), dim: held === 0 },
        { key: 'needless', color: NEEDLESS_COLOR, label: t('warming.needless'), pct: fmtShare(today.needless, today.warms), count: fmt(today.needless), dim: today.needless === 0 },
        { key: 'noFollowup', color: NO_FOLLOWUP_COLOR, label: t('warming.noFollowup'), pct: fmtShare(today.noFollowup, today.warms), count: fmt(today.noFollowup), dim: today.noFollowup === 0 },
        { key: 'expired', color: EXPIRED_COLOR, label: t('warming.expired'), pct: fmtShare(today.expired, today.warms), count: fmt(today.expired), dim: today.expired === 0 },
      ]
      return (
        <div className="lc-card lc-col-donut flex-1 min-w-[min(360px,100%)]">
          <div className="lc-card-title">
            <span className="lc-card-title-text">{t('warming.title')}</span>
            <a className="lc-card-sub lc-pi-hint hover:underline" href={WARMING_REPO} target="_blank" rel="noreferrer">
              {t('warming.hint')}
            </a>
          </div>
          <div className="lc-donut-row flex items-center justify-start gap-3 min-w-0 @max-[320px]/lc-card:gap-2 @max-[240px]/lc-card:flex-wrap">
            <Donut
              segments={[
                { key: 'held', color: HELD_COLOR, value: held },
                { key: 'needless', color: NEEDLESS_COLOR, value: today.needless },
                { key: 'noFollowup', color: NO_FOLLOWUP_COLOR, value: today.noFollowup },
                { key: 'expired', color: EXPIRED_COLOR, value: today.expired },
              ]}
              size={96}
              centerTop={fmt(today.savedCacheTokens)}
              centerSub={t('warming.savedToday')}
              hoverKey={hoverKey}
              onHoverKey={setHoverKey}
            />
            <SliceList rows={rows} hoverKey={hoverKey} onHoverKey={setHoverKey} />
          </div>
          <div className="lc-pi-grid">
            <div className="lc-pi-row">
              <div className="lc-pi-label">{t('warming.allTime')}</div>
              <div className="lc-pi-value">{fmt(allTime.warms)}</div>
            </div>
            <div className="lc-pi-row">
              <div className="lc-pi-label">{t('warming.savedAll')}</div>
              <div className="lc-pi-value">{fmt(allTime.savedCacheTokens)}</div>
            </div>
            <div className="lc-pi-row">
              <div className="lc-pi-label">{t('warming.failed')}</div>
              <div className="lc-pi-value">{fmt(failed)}</div>
            </div>
          </div>
        </div>
      )
    }
    // Schema 2/3: the money verdict, scoped by the doctrine. Only the all-time ledger knows its
    // failed pings' figures — the day's and a session's wires carry none.
    const currency = currencyOf(t)
    const dayMoney = moneyOf(today.models, { cacheRead: 0, uncached: 0 }, book)
    const allMoney = moneyOf(allTime.models, stats.failedPingTokens, book)
    const dayVerdict = pricedOf(dayMoney)
    const allVerdict = pricedOf(allMoney)
    const bucket = session === undefined ? undefined : stats.sessions?.[session]
    // The hero's scope: the session's own bucket when it has one, all-time on the overview, and the
    // day when a pruned bucket leaves the session view without its story.
    const scope = bucket !== undefined
      ? { label: t('warming.netSession'), counters: bucket, money: moneyOf(bucket.models, { cacheRead: 0, uncached: 0 }, book) }
      : session === undefined
        ? { label: t('warming.netAll'), counters: allTime, money: allMoney }
        : { label: t('warming.netToday'), counters: today, money: dayMoney }
    const scopeVerdict = pricedOf(scope.money)
    const scopeNet = scopeVerdict === null ? null : scopeVerdict.net
    const scopeSpent = scopeVerdict === null ? null : scopeVerdict.spent
    // The scoped view's dim day line; the day-led fallback already is the day's story.
    const showTodayLine = session === undefined || bucket !== undefined
    // The held residual is scope-bound: the all-time ledger knows its failed pings (they left no
    // outcome), so they leave the count; today's and a session's wires carry no failed figure, so
    // their residual reads credited-or-open-or-unresolved.
    const heldDrop = session === undefined ? failed : 0
    const left = scope.counters.warms - scope.counters.needless - scope.counters.noFollowup - scope.counters.expired
    const scopeHeld = Math.max(0, left - heldDrop)
    const scale = scopeVerdict === null ? 0 : scopeVerdict.scale
    // Every caller gates on a positive cost, and any positive cost makes the scale positive.
    const pctOf = (usd: number): number => Math.round((usd / scale) * 10000) / 100
    const legend = [
      { key: 'saved', color: SAVED_COLOR, label: t('warming.money.saved'), seg: scope.money.saved },
      { key: 'useful', color: USEFUL_COLOR, label: t('warming.money.useful'), seg: scope.money.useful },
      { key: 'wasted', color: WASTED_COLOR, label: t('warming.money.wasted'), seg: scope.money.wasted },
      { key: 'raw', color: RAW_COLOR, label: t('warming.money.raw'), seg: scope.money.raw },
    ]
    const spendBars: { key: string; color: string; left: number; width: number }[] = []
    let seat = 0
    for (const seg of legend.slice(1)) {
      if (seg.seg.cost === null || seg.seg.cost === 0) continue
      const width = pctOf(seg.seg.cost)
      // The seat rounds to the widths' own precision, so cumulative lefts never carry float dust.
      spendBars.push({ key: seg.key, color: seg.color, left: Math.round(seat * 100) / 100, width })
      seat += width
    }
    const counts = [
      t('warming.pings', { n: fmt(scope.counters.warms) }),
      fmt(scopeHeld) + ' ' + t('warming.held'),
      fmt(scope.counters.needless) + ' ' + t('warming.needless'),
      fmt(scope.counters.noFollowup) + ' ' + t('warming.noFollowup'),
      fmt(scope.counters.expired) + ' ' + t('warming.expired'),
    ].join(' · ')
    return (
      <div className="lc-card lc-col-donut flex-1 min-w-[min(360px,100%)]">
        <div className="lc-card-title">
          <span className="lc-card-title-text">{t('warming.title')}</span>
          <a className="lc-card-sub lc-pi-hint hover:underline" href={WARMING_REPO} target="_blank" rel="noreferrer">
            {t('warming.hint')}
          </a>
        </div>
        <div className="lc-warm-hero">
          <span className="lc-warm-hero-label">{scope.label}</span>
          <b className={'lc-warm-hero-value'
            + (scopeNet === null || scopeNet === 0 ? '' : scopeNet > 0 ? ' lc-warm-hero-win' : ' lc-warm-hero-loss')}>
            {verdictOf(scopeNet, currency)}
          </b>
          {scopeNet !== null && (
            <span className="lc-warm-hero-eq">
              {t('warming.netEq', { saved: costOf(scope.money.saved.cost, currency), spent: costOf(scopeSpent, currency) })}
            </span>
          )}
        </div>
        {showTodayLine && (
          <div className="lc-warm-sub">{t('warming.todayLine', { net: verdictOf(dayVerdict === null ? null : dayVerdict.net, currency) })}</div>
        )}
        {scopeNet !== null
          ? (
            <div className="lc-warm-bars">
              <div className="lc-warm-bar-row">
                <span className="lc-warm-bar-label">{t('warming.money.saved')}</span>
                <div className="lc-warm-bar">
                  {scope.money.saved.cost !== null && scope.money.saved.cost > 0
                    ? <i style={{ left: '0%', width: `${pctOf(scope.money.saved.cost)}%`, background: SAVED_COLOR }} />
                    : null}
                </div>
              </div>
              <div className="lc-warm-bar-row">
                <span className="lc-warm-bar-label">{t('warming.bar.spent')}</span>
                <div className="lc-warm-bar">
                  {spendBars.map(b => <i key={b.key} style={{ left: `${b.left}%`, width: `${b.width}%`, background: b.color }} />)}
                </div>
              </div>
            </div>
          )
          : null}
        <div className="lc-warm-leg">
          {legend.map(l => (
            <div key={l.key} className={'lc-warm-leg-row' + (l.seg.tokens === 0 ? ' lc-warm-leg-row-dim' : '')}>
              <i className="lc-warm-leg-dot" style={{ background: l.color }} />
              <span className="lc-warm-leg-label">{l.label}</span>
              <span className="lc-warm-leg-tok">{fmt(l.seg.tokens)}</span>
              <span className="lc-warm-leg-cost">{costOf(l.seg.cost, currency)}</span>
            </div>
          ))}
        </div>
        <div className="lc-warm-sub">{t('warming.money.hint')}</div>
        <div className="lc-warm-counts">{counts}</div>
        {/* The all-time totals stay in every footer; the overview's hero already carries the
            all-time verdict, so its rows skip the duplicate. */}
        <div className="lc-pi-grid">
          {(session === undefined ? [] : [{ label: t('warming.netAll'), value: verdictOf(allVerdict === null ? null : allVerdict.net, currency) }])
            .concat([
              { label: t('warming.allTime'), value: fmt(allTime.warms) },
              { label: t('warming.savedAll'), value: fmt(allTime.savedCacheTokens) },
              { label: t('warming.failed'), value: fmt(failed) },
            ])
            .map(row => (
              <div key={row.label} className="lc-pi-row">
                <div className="lc-pi-label">{row.label}</div>
                <div className="lc-pi-value">{row.value}</div>
              </div>
            ))}
        </div>
      </div>
    )
  }
}
