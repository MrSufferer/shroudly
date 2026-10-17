// Minimal `assert` for dependencies that use Node's module in the browser.
function assert(condition,message){if(!condition)throw Error(message instanceof Error?message.message:message??'assertion failed');}
assert.ok=assert;
assert.strictEqual=(a,b,m)=>assert(a===b,m);
assert.equal=(a,b,m)=>assert(a==b,m);
assert.notStrictEqual=(a,b,m)=>assert(a!==b,m);
export default assert;
export {assert};
