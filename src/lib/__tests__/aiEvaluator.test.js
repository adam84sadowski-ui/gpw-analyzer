import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock external dependencies before importing the module ────────────
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ text: '{"decision":"WEJDŹ","action":"TRZYMAJ","confidence":80,"reason":"Sygnał silny.","risk":"NISKIE","urgency":"NISKA"}' }],
        usage:   { input_tokens: 100, output_tokens: 50 },
      }),
    },
  })),
}))

vi.mock('@vercel/kv', () => ({
  createClient: vi.fn().mockReturnValue({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
  }),
}))

global.fetch = vi.fn()

import { fetchNewsHeadlines, buildSectorContext, validateEntry, evaluatePosition } from '../../services/aiEvaluator.js'

// ── fetchNewsHeadlines ────────────────────────────────────────────────
describe('fetchNewsHeadlines', () => {
  beforeEach(() => vi.clearAllMocks())

  it('parses CDATA headlines from RSS feed', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok:   true,
      text: () => Promise.resolve(
        '<rss><channel>' +
        '<item><title><![CDATA[PKN Orlen record profit]]></title></item>' +
        '<item><title><![CDATA[Energy outlook positive]]></title></item>' +
        '</channel></rss>',
      ),
    })
    const result = await fetchNewsHeadlines('pkn.pl', 'GPW')
    expect(Array.isArray(result)).toBe(true)
  })

  it('returns empty array on network error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network'))
    const result = await fetchNewsHeadlines('err.pl', 'GPW')
    expect(result).toEqual([])
  })

  it('returns empty array when response not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false })
    const result = await fetchNewsHeadlines('bad.pl', 'GPW')
    expect(result).toEqual([])
  })
})

// ── buildSectorContext ────────────────────────────────────────────────
describe('buildSectorContext', () => {
  it('counts only open positions in the same sector', () => {
    const positions = [
      { ticker: 'pzu.pl', exchange: 'GPW', status: 'open' },
      { ticker: 'pko.pl', exchange: 'GPW', status: 'closed' },
    ]
    const ctx = buildSectorContext('ale.pl', 'GPW', positions)
    expect(ctx.sector).toBe('FINANCE')
    expect(Array.isArray(ctx.correlated)).toBe(true)
    expect(ctx.correlated).not.toContain('ale.pl')
    expect(ctx.sectorPositions).toBe(1)
  })

  it('returns 0 sectorPositions with no positions', () => {
    expect(buildSectorContext('pkn.pl', 'GPW', []).sectorPositions).toBe(0)
  })

  it('identifies sector correctly for energy ticker', () => {
    expect(buildSectorContext('pge.pl', 'GPW').sector).toBe('ENERGY')
  })
})

// ── validateEntry ─────────────────────────────────────────────────────
describe('validateEntry', () => {
  it('returns decision/confidence/reason/risk', async () => {
    const result = await validateEntry({
      ticker: 'pkn.pl', exchange: 'GPW', signal: 'RSI_OVERSOLD',
      score: 72, rsi: 28, volMult: 2.1, sma50Delta: -3,
      sector: 'ENERGY', correlated: ['pge.pl'], sectorPositions: 0,
      news: ['PKN profit up'],
    })
    expect(['WEJDŹ', 'POCZEKAJ', 'ODRZUĆ']).toContain(result.decision)
    expect(typeof result.confidence).toBe('number')
    expect(typeof result.reason).toBe('string')
    expect(['NISKIE', 'UMIARKOWANE', 'WYSOKIE']).toContain(result.risk)
  })
})

// ── evaluatePosition ──────────────────────────────────────────────────
describe('evaluatePosition', () => {
  it('returns action/confidence/reason/urgency', async () => {
    const result = await evaluatePosition({
      ticker: 'pkn.pl', exchange: 'GPW', signal: 'RSI_OVERSOLD',
      entryPrice: 60, currentPrice: 63, pnlPct: 5, daysHeld: 3,
      rsi: 52, volMult: 1.8, sma50Delta: 4, news: [],
    })
    expect(['TRZYMAJ', 'ZAMKNIJ', 'ZREDUKUJ']).toContain(result.action)
    expect(typeof result.confidence).toBe('number')
    expect(typeof result.reason).toBe('string')
    expect(['NISKA', 'UMIARKOWANA', 'WYSOKA']).toContain(result.urgency)
  })
})
