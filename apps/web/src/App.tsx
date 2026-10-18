import { useCallback, useEffect, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  Check,
  Clock3,
  Download,
  ExternalLink,
  EyeOff,
  Gift,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trophy,
  WalletCards,
} from "lucide-react";
import { formatTokenAmount, parseTokenAmount } from "./lib/amount";
import { MIDNIGHT_NETWORK_CONFIG, MIDNIGHT_PROVIDER_STATUS, PREPROD_DISCLOSURES } from "./lib/midnight/config";
import { createParticipantApplication, DeterministicPreprodAdapter } from "./lib/midnight/application";
import { MidnightPreprodAdapter } from "./lib/midnight/preprod-adapter";
import { serializeRecoveryBundle, parseRecoveryBundle } from "./lib/midnight/recovery";
import { PROGRAM_CONSTANTS } from "./lib/midnight/constants";
import { nextDrawAction, formatDuration } from "./lib/draw";
import type { ParticipantApplication } from "./lib/midnight/application";
import type { ParticipantError } from "./lib/midnight/types";
import "./styles.css";
import { useDisclosurePrototype } from "./prototype/DisclosureCopyPrototype"; // PROTOTYPE #71

// Development builds use the deterministic reference adapter so every journey can
// be exercised without a wallet. Production bundles contain only the genuine Lace
// connector and never ship an automated wallet bridge.
const adapter = import.meta.env.DEV ? new DeterministicPreprodAdapter() : new MidnightPreprodAdapter();
const application: ParticipantApplication = createParticipantApplication(adapter);

export default function App() {
  const subscribe = useCallback((listener: (next: ParticipantApplication["snapshot"]) => void) => application.subscribe(listener), []);
  const snapshot = useSyncExternalStore(subscribe, () => application.snapshot, () => application.snapshot);
  const [walletId, setWalletId] = useState("evidence-wallet-1");
  const [amount, setAmount] = useState("10");
  const [notice, setNotice] = useState("Connect a supported Lace wallet to begin.");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [backupText, setBackupText] = useState<string | null>(null);
  const [showRecovery, setShowRecovery] = useState(false);
  const [clock, setClock] = useState(() => Date.now());
  const proto = useDisclosurePrototype(snapshot.deployment.deploymentId); // PROTOTYPE #71
  const localAdapter = adapter instanceof DeterministicPreprodAdapter ? adapter : null;

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const run = useCallback(async (label: string, operation: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    setNotice(`${label}…`);
    try {
      await operation();
      setNotice(`${label} confirmed after finality, indexer visibility, and a fresh ledger query.`);
    } catch (cause) {
      const typed = cause as Partial<ParticipantError>;
      const message = cause instanceof Error ? cause.message : "The participant action failed.";
      setError(typed.code ? `${typed.code}: ${message}` : message);
      setNotice("No success was fabricated; resolve the displayed condition and retry.");
    } finally {
      setBusy(null);
    }
  }, []);

  const connect = () => void run("Connecting", () => application.connect(walletId));
  const disconnect = () => void run("Disconnecting", () => application.disconnect());
  const contribute = () => {
    let parsed: bigint;
    try { parsed = parseTokenAmount(amount); } catch (cause) { setError(cause instanceof Error ? cause.message : "Enter a valid tMIX amount."); return; }
    void run("Contributing", () => application.contribute(parsed));
  };
  const withdraw = () => {
    let parsed: bigint;
    try { parsed = parseTokenAmount(amount); } catch (cause) { setError(cause instanceof Error ? cause.message : "Enter a valid tMIX amount."); return; }
    void run("Withdrawing", () => application.withdraw(parsed));
  };

  const connected = snapshot.connection === "connected";
  const stateReady = connected && snapshot.stateStatus === "available";
  const action = stateReady ? nextDrawAction({ phase: snapshot.draw.phase, now: BigInt(Math.floor(clock / 1_000)), revealClosesAt: snapshot.draw.revealClosesAt, hasPrize: snapshot.unclaimedPrizeMicroUnits > 0n }) : null;
  const timeLeft = snapshot.draw.revealClosesAt > 0n ? snapshot.draw.revealClosesAt - BigInt(Math.floor(clock / 1_000)) : 0n;
  const formattedTime = formatDuration(timeLeft > 0n ? timeLeft : 0n);

  const exportRecovery = async () => {
    await run("Exporting Recovery Kit", async () => {
      const bundle = await application.exportRecoveryBundle();
      const serialized = serializeRecoveryBundle(bundle);
      setBackupText(serialized);
      download("shroudly-recovery-kit.json", serialized, "application/json");
    });
  };

  const restoreRecovery = async (file: File | undefined) => {
    if (!file) return;
    await run("Restoring Recovery Kit", async () => application.restoreRecovery(parseRecoveryBundle(await file.text())));
  };

  const resetArchive = () => {
    window.localStorage.setItem(`shroudly-reset-${MIDNIGHT_NETWORK_CONFIG.deploymentId}`, new Date().toISOString());
    setNotice("Local archive invalidated for this deployment. Connect again to start a new participant session.");
  };

  const busyNow = busy !== null;
  const networkLabel = `${snapshot.deployment.environment} · ${snapshot.deployment.deploymentId}`;

  return (
    <div className="app-shell">
      <div className="motes" aria-hidden>{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ "--i": i } as CSSProperties} />)}</div>
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="Shroudly home"><span className="mark"><ShieldCheck size={18} /></span>Shroudly</a>
        <div className="header-actions">
          <span className="header-separator" aria-hidden="true">·</span>
          <span className="network-pill"><i /> Preprod only</span>
          {connected ? <button className="wallet-control" onClick={disconnect}><span>{short(snapshot.wallet?.address ?? "")}</span><span aria-hidden>×</span></button> : <button className="connect-button" onClick={connect} disabled={busyNow}><WalletCards size={16} /> {busy === "Connecting" ? "Connecting…" : "Connect Lace"}</button>}
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow"><Sparkles size={13} /> Private savings, public fairness</p>
            <h1>Save privately.<br /><em>Draw fairly.</em></h1>
            <p className="lede">Shroudly is a shielded Preprod proving ground for private time-weighted balances and threshold-selected prizes. Every displayed tMIX amount is valueless test currency.</p>
            <div className="trust-row"><span><LockKeyhole size={14} /> Private balances</span>{proto.slot("trust-chip")}<span><EyeOff size={14} /> Selective disclosure</span></div>
          </div>
          <div className="orb-stage" aria-label="Current prize reserve"><div className="orb-halo" /><div className="prize-orb"><div className="orb-glint" /><Trophy size={28} /><span>Prize reserve</span><strong>{stateReady ? formatTokenAmount(snapshot.draw.prizeMicroUnits) : "—"}</strong><small>tMIX</small></div><p><i /> {stateReady ? `simulated yield · ${(PROGRAM_CONSTANTS.simulatedYieldPerDrawMicroUnits / 1_000_000n).toString()} tMIX / draw` : "verified ledger state unavailable"}</p></div>
        </section>

        <div className="deployment-banner"><ShieldCheck size={16} /> <span><strong>{PREPROD_DISCLOSURES.identity}</strong> · {networkLabel} · Mainnet transactions are absent from this build.</span></div>
        <div className="deployment-banner"><AlertTriangle size={16} /> <span>{PREPROD_DISCLOSURES.trust} {PREPROD_DISCLOSURES.governance} {PREPROD_DISCLOSURES.deployer}</span></div>

        <section className="dashboard">
          <div className="panel savings-panel">
            <div className="panel-heading"><div><p className="kicker">Participant journey</p><h2>Your private position</h2></div><LockKeyhole className="panel-icon" /></div>
            {!connected ? <div className="empty-state"><WalletCards size={27} /><h3>Connect a supported wallet</h3><p>Use the qualified desktop Chrome/Lace profile. The app never exposes raw provider objects to React.</p><button className="primary-button" onClick={connect} disabled={busyNow}>Connect to Preprod</button></div> : <>
              {stateReady ? <div className="balance-grid" aria-live="polite"><Balance label="Private wallet" value={snapshot.privateBalanceMicroUnits} /><Balance label="Time-Weighted Principal" value={snapshot.principalMicroUnits} /><Balance label="Unclaimed prize" value={snapshot.unclaimedPrizeMicroUnits} prize /><p className="privacy-note"><EyeOff size={14} /> Private state is encrypted locally.</p></div> : <div className="data-unavailable" role="status"><AlertTriangle size={20} /><div><strong>Verified ledger state unavailable</strong><p>{snapshot.stateMessage ?? "The application is waiting for a genuine Preprod state reader."}</p></div></div>}
              <div className="amount-control"><label htmlFor="amount">Amount (1–1,000 tMIX)</label><div className="amount-input"><input id="amount" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" /><span>tMIX</span></div>{proto.slot("cohort-hint")}</div>
              <div className="sponsorship-choice" aria-label="Transaction fee choice">
                <div><strong>Transaction fees</strong><p>Choose how DUST is supplied for eligible actions.</p></div>
                <div className="sponsorship-options" role="group" aria-label="DUST sponsorship">
                  <button className={snapshot.sponsorship === "sponsored" ? "selected" : ""} onClick={() => { application.setSponsorship("sponsored"); setNotice("DUST sponsor selected. A rejection leaves this action available with wallet-funded DUST; an unresolved timeout must reconcile first."); }} disabled={busyNow}>Use DUST sponsor</button>
                  <button className={snapshot.sponsorship === "participant-funded" ? "selected" : ""} onClick={() => { application.setSponsorship("participant-funded"); setNotice("Wallet-funded DUST selected; the participant signs and submits directly."); }} disabled={busyNow}>Wallet-funded DUST</button>
                </div>
                <small>A rejected sponsorship can fall back to wallet-funded DUST. If the sponsor times out before its provider result is known, wait for reconciliation before retrying the same action.</small>
              </div>
              {proto.slot("pre-contribute")}
              <div className="journey">
                <JourneyStep number="01" icon={<Gift size={18} />} title="Claim faucet allocation" detail="1,000 tMIX per 24-hour epoch" action="Claim" onClick={() => void run("Faucet claim", () => application.faucetClaim())} disabled={busyNow || !stateReady} />
                <JourneyStep number="02" icon={<ArrowDownToLine size={18} />} title="Contribute to the pool" detail={!snapshot.recoveryReady ? "Export and restore your Recovery Kit first" : (proto.slot("contribute-detail") as string | null) ?? "Principal custody and TWAB start immediately"} action="Contribute" onClick={contribute} disabled={busyNow || !stateReady || !snapshot.recoveryReady || !proto.acknowledged} />
                <JourneyStep number="03" icon={<RefreshCw size={18} />} title="Withdraw principal" detail={(proto.slot("withdraw-detail") as string | null) ?? "Partial or full withdrawal, no prize reserve mixing"} action="Withdraw" onClick={withdraw} disabled={busyNow || !stateReady || snapshot.principalMicroUnits === 0n} />
              </div>
              <div className="secondary-actions"><button onClick={() => void run("Yield checkpoint", () => application.checkpointYield())} disabled={busyNow || !stateReady}>Checkpoint yield</button><button onClick={() => setShowRecovery(true)} disabled={busyNow || snapshot.recoveryReady}>{snapshot.recoveryReady ? "Recovery Kit ready" : "Prepare Recovery Kit"}</button><button onClick={() => setShowRecovery((value) => !value)}>{showRecovery ? "Hide backup" : "Backup & restore"}</button><button onClick={resetArchive}>Reset archive</button></div>
              {showRecovery && <div className="backup-box"><p><strong>Recovery Kit</strong> is a participant-held export. It binds encrypted state to {snapshot.deployment.deploymentId}; export and restore it before your first contribution. Retired deployments are read-only and cannot be imported.</p><button className="soft-button" onClick={() => void exportRecovery()} disabled={busyNow}><Download size={14} /> Export Recovery Kit</button><label className="soft-button file-button">Restore Recovery Kit<input type="file" accept="application/json" onChange={(event) => void restoreRecovery(event.target.files?.[0])} /></label>{backupText && <small>Recovery Kit staged for download. Restore that file to enable contribution.</small>}</div>}
            </>}
          </div>

          <aside className="side-column">
            <div className="panel draw-panel"><div className="panel-heading"><div><p className="kicker">{stateReady ? `Threshold draw #${snapshot.draw.drawId.toString()}` : "Verified state unavailable"}</p><h2>{!stateReady ? "Awaiting verified state" : snapshot.draw.phase === "finalized" ? "Winner selected" : "Next draw"}</h2></div><Clock3 className="panel-icon" /></div><div className="phase-track"><Phase label="Open" active={stateReady && snapshot.draw.phase === "open"} /><Phase label="Commit" active={stateReady && snapshot.draw.eligibleCommitments > 0} /><Phase label="Reveal" active={stateReady && snapshot.draw.revealClosesAt > 0n && snapshot.draw.phase !== "finalized"} /><Phase label="Finalized" active={stateReady && snapshot.draw.phase === "finalized"} /></div><div className="timer-row"><div><span>{stateReady ? snapshot.draw.phase === "finalized" ? "Claim window" : "Reveal deadline" : "Ledger state"}</span><strong>{stateReady ? formattedTime : "—"}</strong></div><Clock3 size={19} /></div><p className="draw-hint">{stateReady ? `${proto.slot("draw-hint")} · ${snapshot.draw.disclosureCohortMet ? "cohort met" : "cohort pending"}` : snapshot.stateMessage ?? "Connect to a configured Preprod deployment to read draw state."}</p>{action === "finalizeDraw" && <button className="primary-button full" onClick={() => void run("Finalize draw", () => application.finalizeDraw())} disabled={busyNow}>Finalize permissionlessly</button>}{action === "claimPrize" && <button className="primary-button full" onClick={() => void run("Claim prize", () => application.claimPrize())} disabled={busyNow}>Claim private prize</button>}<button className="soft-button full" onClick={() => localAdapter?.advanceTime(900n)} disabled={!localAdapter || !stateReady}>Advance deterministic clock 15m</button></div>
            <div className="panel panel-midnight"><div className="panel-heading"><div><p className="kicker">Provider boundary</p><h2>Midnight profile</h2></div><ShieldCheck className="panel-icon" /></div><p className="midnight-copy">Official wallet, proof, public-data, private-state, ZK-config, and logging providers are composed behind one deep module.</p><div className="provider-status-grid">{MIDNIGHT_PROVIDER_STATUS.map(([name, status]) => <span key={name}><small>{name}</small><strong>{status}</strong></span>)}</div></div>
          </aside>
        </section>

        {proto.slot("boundaries")}
      </main>
      <div className={error ? "status-bar error" : "status-bar"} role="status"><span>{error ? <AlertTriangle size={15} /> : <Check size={15} />}</span><div className="status-copy"><strong>{error ?? notice}</strong>{snapshot.wallet && <small>{snapshot.wallet.network} · API {snapshot.wallet.apiVersion} · sponsorship: {snapshot.sponsorship}</small>}</div>{error && <button onClick={() => setError(null)}>Dismiss</button>}</div>
      {import.meta.env.DEV && proto.switcher}
      <footer><span>Shroudly</span><p>Preprod / mainnet-test-build · qualified desktop Chrome/Lace profile</p><a href="https://docs.midnight.network" target="_blank" rel="noreferrer">Midnight docs <ExternalLink size={12} /></a></footer>
    </div>
  );
}

function Balance({ label, value, prize = false }: { label: string; value: bigint; prize?: boolean }) { return <div className={prize ? "balance-item prize" : "balance-item"}><span>{label}</span><strong>{prize && <Trophy size={17} />} {formatTokenAmount(value)} <small>tMIX</small></strong></div>; }
function JourneyStep({ number, icon, title, detail, action, onClick, disabled }: { number: string; icon: ReactNode; title: string; detail: string; action: string; onClick: () => void; disabled?: boolean }) { return <div className="journey-step"><span className="step-number">{number}</span><span className="step-icon">{icon}</span><span className="step-copy"><strong>{title}</strong><small>{detail}</small></span><button className="soft-button" onClick={onClick} disabled={disabled}>{action}</button></div>; }
function Phase({ label, active }: { label: string; active: boolean }) { return <div className={active ? "phase active" : "phase"}><span>{active ? <Check size={11} /> : "·"}</span><small>{label}</small></div>; }
function short(value: string): string { return value.length > 12 ? `${value.slice(0, 7)}…${value.slice(-4)}` : value; }
function download(name: string, content: string, type: string): void { const link = document.createElement("a"); const url = URL.createObjectURL(new Blob([content], { type })); link.href = url; link.download = name; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1_000); }
