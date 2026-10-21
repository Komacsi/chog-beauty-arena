// Only explicit HTTPS frontend origins are trusted behind an external proxy.
// Forwarded-Host/Origin headers never add entries to this allowlist.
export function webOrigins(value=''){
  return new Set(value.split(',').map(s=>s.trim()).filter(Boolean).map(value=>{
    const url=new URL(value);
    if(url.protocol!=='https:' || url.username || url.password || url.origin!==value)throw Error('ARENA_WEB_ORIGINS must contain exact HTTPS origins');
    return url.origin;
  }));
}
export function allowedWebOrigin(origin,host,allowed=new Set()){
  if(!origin)return true; // Non-browser clients are still subject to contract/demo validation.
  try{
    const url=new URL(origin);
    if(url.origin!==origin || !['http:','https:'].includes(url.protocol))return false;
    return url.host===host || allowed.has(url.origin);
  }catch{return false;}
}
