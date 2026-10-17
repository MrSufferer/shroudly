// Expected outcomes of the live Node journey. A run is evidence only when every
// step matches: each action lands as exactly one ledger round, interruptions
// reconcile the original action, and an older Recovery Kit cannot act.
const settled=round=>s=>s.exit===0&&s.outcome?.ledger?.round===String(round)&&s.outcome.fresh===true&&s.outcome.journal?.unresolved?.length===0;
const killed=s=>s.exit==='SIGKILL';
const EXPECTED={
  'register':settled(0),
  'crash-before-submission':killed,'restart-reconcile-original':settled(1),
  'crash-during-observation':killed,'restart-reconcile-observed':settled(2),
  'crash-after-finality':killed,'restart-reconcile-persist':settled(3),
  'crash-during-handoff':killed,'restart-reconcile-handoff':settled(4),
  'restore-current-kit-fresh-profile':settled(4),
  'advance-from-restored-kit':settled(5),
  'restore-older-kit-is-stale':s=>s.exit===0&&s.outcome?.fresh===false,
  'stale-kit-cannot-act':s=>s.exit===1&&/stale/.test(s.failed??''),
  'bob-unregistered-while-alice-registered':s=>s.exit===0&&s.outcome?.ledger?.registered===false,
};

export function assessJourney({steps,submissions}) {
  const failures=Object.entries(EXPECTED).filter(([name,check])=>{const s=steps.find(x=>x.name===name);return !s||!check(s);}).map(([name])=>name);
  const count=c=>submissions.filter(s=>s.circuit===c).length;
  const allFinal=submissions.every(s=>s.finalStatus==='SUCCESS');
  if(count('register')!==1||count('advance')!==5||submissions.length!==6||!allFinal)failures.push('submissions');
  return {passed:failures.length===0,failures};
}
