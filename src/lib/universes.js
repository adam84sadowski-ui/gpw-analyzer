export const UNIVERSES = {
  GPW: {
    scalping:   ['pkn.pl','kghm.pl','pko.pl','pzu.pl','cdr.pl','ale.pl','mbk.pl','lpp.pl','pge.pl','jsw.pl','dnp.pl','kty.pl','cps.pl','peo.pl','spl.pl','opl.pl','kru.pl','bdx.pl','acp.pl','ing.pl','tpe.pl','alr.pl','pco.pl','krk.pl','amr.pl','xtb.pl','pli.pl','unt.pl','mls.pl'],
    swing:      ['kru.pl','acp.pl','bdx.pl','car.pl','cln.pl','dom.pl','eat.pl','gpw.pl','ing.pl','ker.pl','opl.pl','vrg.pl','pcf.pl','brs.pl','mlp.pl','pkn.pl','kghm.pl','lpp.pl','pko.pl','cdr.pl','tpe.pl','alr.pl','pco.pl','cmr.pl','fmo.pl','xtb.pl','pge.pl','pzu.pl','jsw.pl','kty.pl','mbk.pl','spl.pl'],
    aggressive: ['apr.pl','ast.pl','bcm.pl','bft.pl','xtp.pl','slv.pl','vrc.pl','crm.pl','hug.pl','elq.pl','trk.pl','pgn.pl','11b.pl','ccc.pl','xtb.pl','mls.pl','grn.pl','mrc.pl','ten.pl'],
  },
  NYSE: {
    // Scalping: blue chips + large tech (vol >10M/day), defense, energy, commodities, financials, pharma, consumer
    scalping:   ['AAPL','MSFT','NVDA','AMZN','META','GOOGL','AVGO','ORCL','ADBE','QCOM','TXN','INTU','NOW','IBM','ACN','AMD','INTC','NFLX','AMAT','LRCX','MU','MRVL','FTNT','LMT','RTX','NOC','GD','BA','CVX','XOM','FCX','NEM','COP','SLB','OXY','HAL','MPC','NRG','VLO','PSX','V','MA','JPM','BAC','GS','MS','WFC','C','AXP','SCHW','TSLA','CRM','PANW','LLY','PFE','MCD','SBUX','COST','UNH','MRNA'],
    // Swing: mid/large cap, diverse sectors — tech, defense, space, commodities, energy, financials, apparel, pharma
    swing:      ['AAPL','MSFT','NVDA','AMZN','META','GOOGL','AVGO','ORCL','ADBE','NOW','INTU','QCOM','TXN','CDNS','SNPS','IBM','ACN','EPAM','CTSH','SAP','AMD','INTC','WDAY','NFLX','AMAT','LRCX','MU','KLAC','MRVL','FTNT','ETN','LMT','RTX','NOC','GD','BA','LHX','LDOS','BAH','AXON','KTOS','AVAV','RKLB','ASTS','LUNR','IRDM','VSAT','BWXT','TDY','CVX','XOM','COP','OXY','EOG','CEG','FCX','NEM','GOLD','ALB','SQM','CCJ','MOS','MP','NRG','VLO','PSX','LNG','WMB','FANG','OKE','KMI','ALAB','LULU','ONON','DECK','RL','TPR','UBER','V','MA','JPM','BAC','GS','WFC','C','AXP','COF','SCHW','BX','ICE','HSBC','TSLA','CRM','PANW','CRWD','COST','UNH','MRNA','PFE','JNJ','ABBV','LLY','NVO','AMGN','GILD','REGN','VRTX'],
    // Aggressive: high beta, momentum — tech, space, energy, financials, apparel, crypto, quantum, EV, biotech
    aggressive: ['TSLA','AMD','NVDA','CRM','SNOW','PLTR','CRWD','NET','DDOG','ZS','PANW','SMCI','ARM','MSTR','PATH','GTLB','MDB','OKTA','AI','SOUN','BBAI','S','WOLF','MRVL','KTOS','AVAV','AXON','RKLB','LUNR','ASTS','JOBY','ACHR','GSAT','RDW','CEG','VST','DVN','FCX','ALB','LAC','UEC','CCJ','DNN','MP','NEM','GOLD','ALAB','SPCX','LULU','CROX','ONON','UBER','COF','LNG','FANG','EQT','COIN','MARA','RIOT','HOOD','SOFI','AFRM','UPST','IONQ','QBTS','RGTI','RIVN','LCID','NIO','BLNK','CHPT','HIMS','CELH','SHOP','RBLX','ROKU','SQ','ABNB','NVAX','MRNA','BIIB','VRTX','BMRN','EXAS'],
  },
}

export function allTickers(exchange) {
  const byExchange = UNIVERSES[exchange] ?? UNIVERSES.GPW
  return [...new Set(Object.values(byExchange).flat())]
}
