import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('insecure schemes and nondefault provider ports fail before credential access',()=>{
  const directory=mkdtempSync(join(tmpdir(),'custody-endpoint-test-'));
  const configuration=join(directory,'configuration');
  const base={
    MIDNIGHT_INDEXER_HTTP_URL:'https://midnight-preprod.blockfrost.io/api/v0',
    MIDNIGHT_INDEXER_WS_URL:'wss://midnight-preprod.blockfrost.io/api/v0/ws',
    MIDNIGHT_RPC_URL:'wss://rpc.midnight-preprod.blockfrost.io/',
  };
  try{
    for(const [key,value]of Object.entries(base)){
      for(const invalid of [value.replace(/^https:/,'http:').replace(/^wss:/,'ws:'),value.replace('.io/','.io:8443/')]){
        writeFileSync(configuration,Object.entries({...base,[key]:invalid}).map(([name,value])=>`${name}=${value}`).join('\n'));
        const env={...process.env};for(const name of Object.keys(base))delete env[name];
        // Neither prover nor Keychain configuration exists: endpoint rejection must win.
        const script="import {openProtectedWallet} from './midnight/experiments/custody/protected-wallet.mjs'; try {await openProtectedWallet(process.argv[1]);process.exitCode=2;} catch(error) {if(error.message!=='endpoint outside approved Preprod route')process.exitCode=3;}";
        const result=spawnSync(process.execPath,['--input-type=module','-e',script,configuration],{env,encoding:'utf8'});
        assert.equal(result.status,0,`${key} must reject before credential access`);
        assert.equal(result.stdout,'');assert.equal(result.stderr,'');
      }
    }
  }finally{rmSync(directory,{recursive:true,force:true});}
});
