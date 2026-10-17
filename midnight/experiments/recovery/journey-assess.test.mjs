import test from 'node:test';
import assert from 'node:assert/strict';
import {assessJourney} from './journey-assess.mjs';

const ok=(name,round,extra={})=>({name,exit:0,outcome:{journal:{unresolved:[]},ledger:{round:String(round),registered:round>=0},fresh:true,...extra}});
const killed=name=>({name,exit:'SIGKILL'});
const passingSteps=()=>[
  ok('register',0),
  killed('crash-before-submission'),ok('restart-reconcile-original',1),
  killed('crash-during-observation'),ok('restart-reconcile-observed',2),
  killed('crash-after-finality'),ok('restart-reconcile-persist',3),
  killed('crash-during-handoff'),ok('restart-reconcile-handoff',4),
  ok('restore-current-kit-fresh-profile',4),ok('advance-from-restored-kit',5),
  ok('restore-older-kit-is-stale',5,{fresh:false}),
  {name:'stale-kit-cannot-act',exit:1,failed:'private state is stale against the ledger; reconcile or restore a newer Recovery Kit'},
  ok('bob-unregistered-while-alice-registered',-1),
];
const passingSubmissions=()=>[{circuit:'register',finalStatus:'SUCCESS'},...Array.from({length:5},()=>({circuit:'advance',finalStatus:'SUCCESS'}))];

test('a journey passes only when every interruption reconciles to exactly one ledger round per action', ()=>{
  assert.deepEqual(assessJourney({steps:passingSteps(),submissions:passingSubmissions()}),{passed:true,failures:[]});
});

test('a failed action, a duplicate submission or a usable stale kit fails the journey', ()=>{
  const steps=passingSteps();
  steps[0]={name:'register',exit:1,failed:'type error'};
  steps[12]={name:'stale-kit-cannot-act',exit:0,outcome:{journal:{unresolved:[]},ledger:{round:'6',registered:true},fresh:true}};
  const submissions=[...passingSubmissions(),{circuit:'advance',finalStatus:'SUCCESS'}];
  const {passed,failures}=assessJourney({steps,submissions});
  assert.equal(passed,false);
  assert.deepEqual(failures.sort(),['register','stale-kit-cannot-act','submissions'].sort());
});

test('a missing step is a failure, not a pass', ()=>{
  const steps=passingSteps().filter(s=>s.name!=='restart-reconcile-handoff');
  assert.deepEqual(assessJourney({steps,submissions:passingSubmissions()}).failures,['restart-reconcile-handoff']);
});
