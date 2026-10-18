import test from 'node:test';
import assert from 'node:assert/strict';
import {dustView,dustReady,waitForIndexerAtNode,waitForFreshDust} from './dust-freshness.mjs';

// Fake facade state shaped like WalletFacade.state(): dust.progress, coins, balance(time).
const state=({balance=5n,available=1,pending=0,applied=10n,relevant=10n,connected=true}={})=>({dust:{
  progress:{appliedIndex:applied,highestRelevantWalletIndex:relevant,isConnected:connected},
  availableCoins:Array(available).fill({}),pendingCoins:Array(pending).fill({}),balance:()=>balance,
}});
const clock=()=>{let t=0;return {now:()=>t,sleep:async ms=>{t+=ms;}};};

test('DUST is ready only when synced to the indexer tip, positive, available and not pending', () => {
  assert.equal(dustReady(dustView(state())),true);
  assert.equal(dustReady(dustView(state({balance:0n}))),false);
  assert.equal(dustReady(dustView(state({available:0}))),false);
  assert.equal(dustReady(dustView(state({pending:1}))),false);
  assert.equal(dustReady(dustView(state({applied:9n}))),false,'behind the indexer tip');
  assert.equal(dustReady(dustView(state({connected:false}))),false,'restored but not yet connected');
  assert.deepEqual(dustView(state({applied:7n,relevant:10n})),{dustPositive:true,dustAvailable:1,dustPending:0,dustSynced:false,dustGap:3});
  assert.deepEqual(dustView({}),{});
});

test('waits (bounded) for the indexer to reach the node finalized height', async () => {
  const {now,sleep}=clock();
  const heights=[90,95,100];
  const result=await waitForIndexerAtNode({nodeHeight:async()=>100,indexerHeight:async()=>heights.shift()??100,now,sleep,intervalMs:5000,timeoutMs:60000});
  assert.deepEqual(result,{caughtUp:true,nodeHeight:100,indexerHeight:100,waitedMs:10000});
});

test('indexer wait expires instead of aborting, and tolerates provider errors', async () => {
  const {now,sleep}=clock();
  const lagging=await waitForIndexerAtNode({nodeHeight:async()=>100,indexerHeight:async()=>50,now,sleep,intervalMs:5000,timeoutMs:20000});
  assert.equal(lagging.caughtUp,false);
  assert.equal(lagging.indexerHeight,50);
  const broken=await waitForIndexerAtNode({nodeHeight:async()=>{throw Error('down');},indexerHeight:async()=>1,now,sleep,intervalMs:5000,timeoutMs:10000});
  assert.equal(broken.caughtUp,false);
});

test('waits for a fresh synced state until DUST is ready, re-reading each poll', async () => {
  const {now,sleep}=clock();
  const states=[state({pending:1}),state({applied:9n}),state()];
  let reads=0;
  const result=await waitForFreshDust({syncedState:async()=>{reads+=1;return states.shift();},now,sleep,intervalMs:10000,timeoutMs:600000});
  assert.equal(result.ready,true);
  assert.equal(reads,3);
  assert.equal(result.waitedMs,20000);
});

test('DUST wait is bounded: it reports not-ready instead of aborting, even if a read hangs', async () => {
  const {now,sleep}=clock();
  const notReady=await waitForFreshDust({syncedState:async()=>state({balance:0n}),now,sleep,intervalMs:10000,timeoutMs:30000});
  assert.equal(notReady.ready,false);
  assert.equal(notReady.view.dustPositive,false);
  const hanging=await waitForFreshDust({syncedState:()=>new Promise(()=>{}),readTimeoutMs:5,now,sleep,intervalMs:10000,timeoutMs:20000});
  assert.equal(hanging.ready,false);
});
