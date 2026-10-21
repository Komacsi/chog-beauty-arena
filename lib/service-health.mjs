import {keeperHealthAlerts} from './keeper-health.mjs';
// Public, bounded health summary. No wallets, DB/journal contents or credential paths.
export async function serviceHealth({live,healthPath,now=Date.now()}){
  if(!live)return {status:200,body:{status:'ok',mode:'demo',keeper:'not-required-for-demo',alerts:[]}};
  const alerts=await keeperHealthAlerts(healthPath,now);
  return {status:alerts.length?503:200,body:{status:alerts.length?'degraded':'ok',mode:'live',keeper:alerts.length?'unhealthy':'healthy',alerts:alerts.map(a=>a.code)}};
}
