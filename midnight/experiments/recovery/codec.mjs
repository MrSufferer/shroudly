// Lossless JSON codec for witness material: bigint and Uint8Array survive a round trip.
const toHex=bytes=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
const fromHex=text=>{
  if(text.length%2||/[^0-9a-f]/.test(text))throw Error('invalid encoded bytes');
  return Uint8Array.from(text.match(/../g)??[],h=>parseInt(h,16));
};
// The replacer reads the holder's raw value: a Node Buffer's toJSON runs before it.
export const encode=value=>JSON.stringify(value,function(k,v){
  const raw=this[k];
  return typeof raw==='bigint'?{$bigint:raw.toString()}:raw instanceof Uint8Array?{$bytes:toHex(raw)}:v;
});
export const decode=text=>JSON.parse(text,(_,v)=>{
  if(v&&typeof v==='object'&&!Array.isArray(v)){
    const keys=Object.keys(v);
    if(keys.length===1&&keys[0]==='$bigint')return BigInt(v.$bigint);
    if(keys.length===1&&keys[0]==='$bytes')return fromHex(v.$bytes);
  }
  return v;
});
export {toHex,fromHex};
