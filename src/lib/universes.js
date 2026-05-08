export const UNIVERSES = {
  GPW: {
    scalping:   ['pkn.pl','kghm.pl','pko.pl','pzu.pl','cdr.pl','ale.pl','mbk.pl','lpp.pl','pge.pl','jsw.pl','dnp.pl','kty.pl','cps.pl','peo.pl','spl.pl','opl.pl','kru.pl','bdx.pl','acp.pl','ing.pl','tpe.pl','alr.pl','pco.pl','krk.pl','amr.pl','xtb.pl','pli.pl','unt.pl','mls.pl'],
    swing:      ['kru.pl','acp.pl','bdx.pl','car.pl','cln.pl','dom.pl','eat.pl','gpw.pl','ing.pl','ker.pl','opl.pl','vrg.pl','pcf.pl','brs.pl','mlp.pl','pkn.pl','kghm.pl','lpp.pl','pko.pl','cdr.pl','tpe.pl','alr.pl','pco.pl','cmr.pl','fmo.pl','xtb.pl','pge.pl','pzu.pl','jsw.pl','kty.pl','mbk.pl','spl.pl'],
    aggressive: ['apr.pl','ast.pl','bcm.pl','bft.pl','xtp.pl','slv.pl','vrc.pl','crm.pl','hug.pl','elq.pl','trk.pl','pgn.pl','11b.pl','ccc.pl','xtb.pl','mls.pl','grn.pl','mrc.pl','ten.pl'],
  },
  NYSE: {
    scalping:   ['AAPL','MSFT','NVDA','AMZN','META','GOOGL','JPM','BAC','JNJ','PG','TSLA','AMD','CRM','SNOW','PLTR','ACN','IBM','INFY','CTSH','EPAM','NFLX','AVGO','GS','MS','INTC','UBER','LYFT','ABNB','BKNG','SPOT','ZM','DOCU','PATH','MDB','DDOG','CRWD','NET','ZS','PANW','OKTA','HOOD','SOFI','AFRM','UPST','RIVN','LCID','NOW','GTLB','ORCL','ADBE'],
    swing:      ['AAPL','MSFT','NVDA','AMZN','META','GOOGL','JPM','BAC','JNJ','PG','V','MA','HD','UNH','WMT','ACN','EPAM','ORCL','SAP','CDNS','NFLX','AVGO','GS','LLY','COST','PFE','ABT','ABBV','TMO','CVX','XOM','RTX','LMT','CAT','DE','GE','HON','NEE','DUK','SO','NOW','ADBE','QCOM','TXN','MU','LRCX','IBM','MS','INTC','AXP'],
    aggressive: ['TSLA','AMD','CRM','SNOW','PLTR','COIN','RBLX','ROKU','SQ','SHOP','MSTR','ARM','CRWD','NET','DDOG','SMCI','GME','MARA','RIOT','SOFI','IONQ','QBTS','RGTI','NVAX','NKLA','WOLF','LAZR','JOBY','ACHR','RIVN','LCID','PATH','GTLB','AFRM','UPST','HOOD','HIMS','OPEN','BLNK','CHPT'],
  },
}

export function allTickers(exchange) {
  const byExchange = UNIVERSES[exchange] ?? UNIVERSES.GPW
  return [...new Set(Object.values(byExchange).flat())]
}
