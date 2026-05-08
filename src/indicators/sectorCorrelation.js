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
    TECH:        ['AAPL','MSFT','NVDA','GOOGL','META','AMD','CRM','SNOW','PLTR','IBM','INFY','CTSH','EPAM','ACN','NOW','ADBE','GTLB','MDB','DDOG','CRWD','NET','ZS','PANW','OKTA','PATH','ZM','DOCU'],
    FINANCE:     ['JPM','BAC','GS','MS','V','MA','AXP','HOOD','SOFI','AFRM','UPST'],
    CONSUMER:    ['AMZN','NFLX','UBER','LYFT','ABNB','BKNG','DASH','SPOT','RBLX','ROKU','SQ','SHOP','GME','HIMS','OPEN'],
    HEALTH:      ['JNJ','PG','UNH','ABT','ABBV','PFE','TMO','LLY','NVAX'],
    ENERGY:      ['CVX','XOM','BLNK','CHPT'],
    INDUSTRIAL:  ['CAT','DE','GE','HON','RTX','LMT'],
    UTILITIES:   ['NEE','DUK','SO','AEP','D','SRE'],
    SPECULATIVE: ['TSLA','COIN','MSTR','MARA','RIOT','IONQ','QBTS','RGTI','NKLA','WOLF','LAZR','JOBY','ACHR','RIVN','LCID','SMCI','ARM'],
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
  const count = inSector.length
  if (count === 0) return { block: false, reduce: false, count, sector }
  if (count === 1) return { block: false, reduce: true,  count, sector }
  return           { block: true,  reduce: false, count, sector }
}

export function formatSectorLine(check) {
  if (check.block)  return `🚫 Sektor ${check.sector}: ${check.count} pozycje otwarte — limit osiągnięty`
  if (check.reduce) return `⚠️ Sektor ${check.sector}: 1 pozycja otwarta — redukcja do 50%`
  return ''
}
