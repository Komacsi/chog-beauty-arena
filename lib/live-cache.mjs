// Collapse concurrent scans, including ?fresh=1. Fresh requests have a floor too.
export function createLiveCache(load,{ttl=10000,freshTtl=1000,now=Date.now}={}){
  let value,loadedAt=-Infinity,inFlight;
  return function read(fresh=false){
    if(inFlight)return inFlight;
    if(value!==undefined && now()-loadedAt<(fresh?freshTtl:ttl))return Promise.resolve(value);
    inFlight=Promise.resolve().then(load).then(result=>{value=result;loadedAt=now();return result;}).finally(()=>{inFlight=undefined;});
    return inFlight;
  };
}
