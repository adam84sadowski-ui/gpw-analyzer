import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.js', 'tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: [
        'src/indicators/atr.js',
        'src/indicators/bollinger.js',
        'src/indicators/macd.js',
        'src/indicators/macroFilter.js',
        'src/indicators/positionSizing.js',
        'src/indicators/rsi.js',
        'src/indicators/scoring.js',
        'src/indicators/seasonality.js',
        'src/indicators/sectorCorrelation.js',
        'src/indicators/sma.js',
        'src/lib/backtester.js',
        'src/lib/kvHistory.js',
        'src/lib/trailingStop.js',
      ],
      exclude: ['src/indicators/__tests__/**', 'src/**/*.test.js'],
      reporter: ['text', 'json', 'json-summary'],
      thresholds: {
        lines:      70,
        functions:  70,
        branches:   60,
        statements: 70,
        'src/indicators/rsi.js':            { lines: 90 },
        'src/indicators/scoring.js':        { lines: 90 },
        'src/indicators/positionSizing.js': { lines: 90 },
        'src/indicators/macroFilter.js':    { lines: 80 },
        'src/indicators/macd.js':           { lines: 80 },
        'src/indicators/bollinger.js':      { lines: 80 },
        'src/indicators/atr.js':            { lines: 80 },
        'src/lib/trailingStop.js':          { lines: 90 },
        'src/lib/backtester.js':            { lines: 80 },
      },
    },
  },
})
