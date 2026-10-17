import {chromium} from '@playwright/test';
import {fileURLToPath} from 'node:url';
import {startRelay} from './relay.mjs';

// Offline smoke check: the built bundle loads in desktop Chrome and exposes the harness
// API. Uses a placeholder token and contract; makes no network request.
const here=fileURLToPath(new URL('.',import.meta.url));
const relay=await startRelay({port:0,distDirectory:`${here}dist`,managedDirectory:fileURLToPath(new URL('../../../managed',import.meta.url)),token:'placeholder',publicConfig:{contract:'00'.repeat(32),preflightKeys:{}}});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();
const errors=[];
page.on('pageerror',e=>errors.push(String(e.message).slice(0,200)));
await page.goto(relay.url);
const ready=await page.waitForFunction(()=>globalThis.harnessReady===true,null,{timeout:30000}).then(()=>true,()=>false);
const api=ready?await page.evaluate(()=>Object.keys(globalThis.harness)):[];
const storage=ready?await page.evaluate(()=>globalThis.harness.storage()):null;
console.log(JSON.stringify({ready,api,storage,errors}));
await browser.close();await relay.close();
process.exit(ready?0:1);
