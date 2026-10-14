const SECTORS = {
  GPW: {
    FINANCE:    ['pko.pl','pzu.pl','ale.pl','mbk.pl','peo.pl','spl.pl','kru.pl','ing.pl','alr.pl','krk.pl','xtb.pl','cps.pl'],
    ENERGY:     ['pkn.pl','pge.pl','tpe.pl','unt.pl','mls.pl'],
    TECH:       ['cdr.pl','acp.pl','cmr.pl','pcf.pl','ten.pl'],
    MATERIALS:  ['kghm.pl','jsw.pl','kty.pl','stl.pl','cch.pl'],
    CONSUMER:   ['lpp.pl','dnp.pl','amr.pl','ccc.pl','eat.pl','dom.pl','vrg.pl'],
    INDUSTRIAL: ['bdx.pl','brs.pl','pmx.pl','erd.pl','mlp.pl'],
    TELECOM:    ['opl.pl'],
    HEALTH:     ['pli.pl','mrc.pl'],
    OTHER:      ['apr.pl','ast.pl','bcm.pl','bft.pl','xtp.pl','slv.pl','vrc.pl','crm.pl','hug.pl','elq.pl','trk.pl','pgn.pl','11b.pl','pco.pl','car.pl','cln.pl','gpw.pl','ker.pl','fmo.pl','grn.pl','pcc.pl','tpe.pl'],
  },
  NYSE: {
    // More specific sectors first — getSector returns first match
    SEMI_EQUIPMENT:    ['AMAT','ASML','LRCX','KLAC'],
    SEMICONDUCTORS:    ['NVDA','AMD','INTC','QCOM','TXN','CDNS','SNPS','MU','MRVL','MPWR','GFS','TSM','AVGO'],
    STORAGE:           ['WDC','STX','PSTG'],
    INDUSTRIAL_ENERGY: ['GEV','VST','NRG','PWR','BE','NVT','VRT'],
    NUCLEAR:           ['CEG','CCJ','BWXT'],
    DEFENSE:           ['LMT','RTX','NOC','GD','BA','LHX','LDOS','BAH','AXON','KTOS','AVAV','TDY'],
    SPACE:             ['RKLB','ASTS','LUNR','IRDM','VSAT','JOBY','ACHR','GSAT','RDW'],
    AUTO:              ['TM','RIVN','LCID','NIO'],
    INSURANCE:         ['PGR','CB','AIG','MET','PRU'],
    MINING:            ['FCX','NEM','GOLD','ALB','SQM','MOS','MP'],
    MIDSTREAM:         ['LNG','WMB','OKE','KMI','FANG'],
    AI_INFRA:          ['ANET','EQIX','AMT','ALAB'],
    TECH:              ['AAPL','MSFT','GOOGL','META','ORCL','ADBE','NOW','INTU','IBM','ACN','EPAM','CTSH','SAP','WDAY','NFLX','FTNT','CRM','SNOW','PLTR','CRWD','NET','DDOG','ZS','PANW','OKTA','PATH','GTLB','MDB','SOUN','BBAI','S','HUBS','APP','DIS','PYPL','ISRG','INFY','ZM','DOCU'],
    FINANCE:           ['JPM','BAC','GS','MS','WFC','C','V','MA','AXP','COF','SCHW','BX','ICE','HSBC','HOOD','SOFI','AFRM','UPST'],
    CONSUMER:          ['AMZN','UBER','LYFT','ABNB','BKNG','DASH','SPOT','RBLX','ROKU','SQ','SHOP','GME','HIMS','OPEN','COST','TGT','NKE','ULTA','LULU','ONON','DECK','RL','TPR','LEVI','FL','MDLZ','GPS','SBUX'],
    HEALTH:            ['JNJ','UNH','ABT','ABBV','PFE','TMO','LLY','MRK','AMGN','GILD','REGN','VRTX','MRNA','BIIB','BMRN','EXAS','NVO','NVAX','CELH','PG'],
    ENERGY:            ['CVX','XOM','COP','OXY','EOG','VLO','PSX','SLB','HAL','MPC','DVN','EQT','BLNK','CHPT'],
    INDUSTRIAL:        ['CAT','HON','ETN','DE','GE','HON'],
    UTILITIES:         ['NEE','DUK','SO','AEP','D','SRE'],
    SPECULATIVE:       ['TSLA','COIN','MSTR','MARA','RIOT','IONQ','QBTS','RGTI','NKLA','WOLF','LAZR','SMCI','ARM','NU'],
  },
}

export function getSector(ticker, exchange = 'GPW') {
  const map = SECTORS[exchange] ?? SECTORS.GPW
  for (const [sector, tickers] of Object.entries(map)) {
    if (tickers.includes(ticker.toLowerCase()) || tickers.includes(ticker)) return sector
  }
  return 'OTHER'
}

export function checkSectorExposure(ticker, exchange, openPositions = []) {
  const sector  = getSector(ticker, exchange)
  const inSector = openPositions.filter(p =>
    p.status === 'open' && getSector(p.ticker, p.exchange ?? exchange) === sector
  )
  const count   = inSector.length
  const tickers = inSector.map(p => p.tickerDisplay ?? p.ticker.replace('.pl', '').toUpperCase())
  if (count === 0) return { block: false, reduce: false, count, sector, tickers }
  if (count === 1) return { block: false, reduce: true,  count, sector, tickers }
  return           { block: true,  reduce: false, count, sector, tickers }
}

export function getCorrelatedStocks(ticker, exchange = 'GPW', limit = 3) {
  const sector = getSector(ticker, exchange)
  const map = SECTORS[exchange] ?? SECTORS.GPW
  const sectorTickers = map[sector] ?? []
  const norm = ticker.toLowerCase()
  return sectorTickers
    .filter(t => t !== norm && t !== ticker)
    .slice(0, limit)
}

export function formatSectorLine(check) {
  const names = check.tickers?.join(', ') ?? `${check.count}`
  if (check.block)  return `🚫 Sektor ${check.sector}: limit osiągnięty (otwarte: ${names})`
  if (check.reduce) return `⚠️ Sektor ${check.sector}: otwarta ${names} — redukcja do 50%`
  return ''
}
