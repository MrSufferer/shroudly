// Redacted error cause chains for live-run evidence (port of the #23 timing
// helper, b176de5/e4af5d3). URLs, credential key/value pairs, long hex and long
// opaque tokens (Blockfrost project ids are alphanumeric, not hex) are removed,
// and each message is truncated, so abort causes can be stored and printed.
export const redacted=text=>String(text??'')
  .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi,'<url>')
  .replace(/\b(project_id|token|seed|mnemonic|secret|password|authorization|bearer|api[_-]?key)\b\s*[=:]?\s*\S*/gi,'<redacted>')
  .replace(/\bkey\w*\s*[=:]\s*\S*/gi,'<redacted>')
  .replace(/(0x)?[0-9a-f]{24,}/gi,'<hex>')
  .replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b/g,'<opaque>')
  .slice(0,240);

// Effect fiber failures carry the failed error in a Cause under this symbol, not in .cause.
const FIBER_CAUSE=Symbol.for('effect/Runtime/FiberFailure/Cause');
const failedIn=cause=>cause&&(cause.error??cause.defect??failedIn(cause.left)??failedIn(cause.right));
const causeOf=error=>error?.cause??failedIn(error?.[FIBER_CAUSE]);
const describe=e=>typeof e==='object'?`${e?.constructor?.name}: ${redacted(e?.message)}`:`${typeof e}: ${redacted(e)}`;

export const errorDetail=error=>{
  const parts=[];
  for(let e=error,i=0;e&&i<4;e=typeof e==='object'?causeOf(e):undefined,i++)parts.push(describe(e));
  return parts.join(' <- ');
};

export const abortSummary=error=>({
  abortCategory:redacted(typeof error==='object'?error?.message:error).slice(0,80)||'unknown',
  abortDetail:errorDetail(error),
});
