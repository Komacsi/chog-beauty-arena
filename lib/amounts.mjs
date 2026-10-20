// Display only. Deposits, payouts and fees keep their original 18-decimal units.
// Integer formatting avoids losing significant digits in large token balances.
export function formatTokenAmount(value){
  const raw=BigInt(value || 0),units=raw<0n?-raw:raw,sign=raw<0n?'-':'';
  if(units>0n && units<10n**15n)return sign+'<0.001';
  const displayUnits=(units+5n*10n**14n)/10n**15n;
  const whole=displayUnits/1000n,decimals=String(displayUnits%1000n).padStart(3,'0').replace(/0+$/,'');
  return sign+whole.toLocaleString('en-US')+(decimals?'.'+decimals:'');
}
