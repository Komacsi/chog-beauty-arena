export const COLLECTION = '0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763';
export const CHOG_TOKEN = '0x350035555e10d9afaf1566aaebfced5ba6c27777';
export const EXPECTED_SUPPLY = 1969;
export const CHAIN_ID = 143;
export const FEE_BPS = 100;
export const RPC_URL = process.env.MONAD_RPC_URL || 'https://rpc.monad.xyz';
export const IPFS_GATEWAY = process.env.IPFS_GATEWAY || 'https://ipfs.filebase.io/ipfs/';
export function resolveUri(uri) {
  if (uri.startsWith('ipfs://')) return IPFS_GATEWAY + uri.slice(7).replace(/^ipfs\//, '');
  if (uri.startsWith('https://')) return uri;
  throw new Error('Unsupported metadata URI');
}
export function decodeString(hex) {
  const raw = hex.replace(/^0x/, '');
  const offset = Number(BigInt('0x' + raw.slice(0, 64))) * 2;
  const size = Number(BigInt('0x' + raw.slice(offset, offset + 64))) * 2;
  return Buffer.from(raw.slice(offset + 64, offset + 64 + size), 'hex').toString('utf8');
}
export async function rpc(method, params) {
  const response = await fetch(RPC_URL, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}), signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const result = await response.json();
  if (result.error) throw new Error(result.error.message);
  return result.result;
}
export async function call(data) { return rpc('eth_call', [{to:COLLECTION,data},'latest']); }
