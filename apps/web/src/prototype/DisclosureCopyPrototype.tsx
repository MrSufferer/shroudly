// PROTOTYPE — throwaway. Issue #71: disclosure copy for public retirement and
// interim operator selection. Three variants on the existing `/` route, switched
// with `?variant=A|B|C`. Lives on branch prototype/issue-71-disclosure-copy only.
// Acknowledgements are in memory; nothing persists.
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDownToLine, ArrowRight, Check, ChevronLeft, ChevronRight, Eye, EyeOff, KeyRound, Link2, LockKeyhole, RefreshCw, Scale, Trophy, UserCog, X } from "lucide-react";

const VARIANTS = ["D", "A", "B", "C"] as const;
type Variant = (typeof VARIANTS)[number];
const NAMES: Record<Variant, string> = { D: "Visual cards", A: "Acknowledgement gate", B: "Point of action", C: "Who sees what" };

export type Slot = "trust-chip" | "cohort-hint" | "pre-contribute" | "contribute-detail" | "withdraw-detail" | "draw-hint" | "boundaries";

// Copy shared by every variant: these correct strings that contradict the amendment today.
const TRUST_CHIP = "Operator-selected draws (Preprod)";
const COHORT_HINT = "A draw settles only with five eligible commitments. One person can hold several, so five commitments are not five people.";

function readVariant(): Variant {
  const value = new URLSearchParams(window.location.search).get("variant");
  return (VARIANTS as readonly string[]).includes(value ?? "") ? (value as Variant) : "D";
}

export function useDisclosurePrototype(deploymentId: string) {
  const [variant, setVariant] = useState<Variant>(readVariant);
  const [lineageAck, setLineageAck] = useState(false);
  const [operatorAck, setOperatorAck] = useState(false);
  const [combinedAck, setCombinedAck] = useState(false);

  const go = useCallback((step: number) => {
    setVariant((current) => {
      const next = VARIANTS[(VARIANTS.indexOf(current) + step + VARIANTS.length) % VARIANTS.length];
      const url = new URL(window.location.href);
      url.searchParams.set("variant", next);
      window.history.replaceState(null, "", url);
      return next;
    });
    setLineageAck(false); setOperatorAck(false); setCombinedAck(false);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      if (event.key === "ArrowLeft") go(-1);
      if (event.key === "ArrowRight") go(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const acknowledged = variant === "A" || variant === "D" ? lineageAck && operatorAck : combinedAck;

  const slot = (name: Slot): ReactNode => {
    if (name === "trust-chip") return <span><Scale size={14} /> {TRUST_CHIP}</span>;
    if (name === "cohort-hint") return <p>Six-decimal integer accounting · {COHORT_HINT}</p>;
    if (variant === "D") return slotD(name, { lineageAck, setLineageAck, operatorAck, setOperatorAck });
    if (variant === "A") return slotA(name, { deploymentId, lineageAck, setLineageAck, operatorAck, setOperatorAck });
    if (variant === "B") return slotB(name, { combinedAck, setCombinedAck });
    return slotC(name, { combinedAck, setCombinedAck });
  };

  const switcher = (
    <div style={bar} role="toolbar" aria-label="Prototype variant switcher">
      <button style={barButton} onClick={() => go(-1)} aria-label="Previous variant"><ChevronLeft size={16} /></button>
      <span>PROTOTYPE #71 · {variant} ({NAMES[variant]}) · ack: {acknowledged ? "yes" : "no"}</span>
      <button style={barButton} onClick={() => go(1)} aria-label="Next variant"><ChevronRight size={16} /></button>
    </div>
  );

  return { variant, acknowledged, slot, switcher };
}

// ── Variant A: one blocking card before Contribute, one checkbox per loss ──────────

function slotA(name: Slot, s: { deploymentId: string; lineageAck: boolean; setLineageAck: (v: boolean) => void; operatorAck: boolean; setOperatorAck: (v: boolean) => void }): ReactNode {
  if (name === "pre-contribute") return (
    <div className="backup-box" style={{ borderColor: "rgba(255,190,120,.35)", background: "rgba(255,190,120,.05)" }}>
      <p><strong>Before you contribute: two things this Preprod deployment does not keep private</strong></p>
      <p><strong>1. A withdrawal links your note history.</strong> When you withdraw, the contract publicly retires the note you withdraw from, by its leaf index or nullifier. Anyone reading the public ledger can connect that withdrawal to the contribution that created the note and to every earlier action in the same note's history. Your amounts and balance stay private.</p>
      <label style={check}><input type="checkbox" checked={s.lineageAck} onChange={(e) => s.setLineageAck(e.target.checked)} /> I understand that a withdrawal publicly links my note's history.</label>
      <p><strong>2. The Operator picks each winner and sees your weight.</strong> Until an unattended selection method qualifies, the Shroudly maintainer, acting as Operator, reads the weight and balance of every commitment and computes the weighted winner from the contract's combined randomness. The contract enforces the randomness threshold, records the Winning Commitment and checks your private claim. It cannot confirm the Operator picked fairly: you are trusting the Operator to do so. The same maintainer holds all three randomness keys, so neither the randomness nor the selection is independent.</p>
      <label style={check}><input type="checkbox" checked={s.operatorAck} onChange={(e) => s.setOperatorAck(e.target.checked)} /> I understand that the Operator sees my weight and balance and that I am trusting it to select fairly.</label>
      <small>These apply to deployment {s.deploymentId}. Contribute stays disabled until both boxes are checked. You will be asked again if this notice changes.</small>
    </div>
  );
  if (name === "contribute-detail") return null; // falls back to existing detail
  if (name === "withdraw-detail") return null;
  if (name === "draw-hint") return "2-of-3 canonical reveals · no fallback randomness · winner computed by the Operator";
  if (name === "boundaries") return <BoundariesProse />;
  return null;
}

// ── Variant B: short copy where each loss happens, one combined checkbox ──────────

function slotB(name: Slot, s: { combinedAck: boolean; setCombinedAck: (v: boolean) => void }): ReactNode {
  if (name === "pre-contribute") return (
    <label style={{ ...check, margin: "12px 0 0", fontSize: 11 }}>
      <input type="checkbox" checked={s.combinedAck} onChange={(e) => s.setCombinedAck(e.target.checked)} />
      <span>I have read <a href="#boundaries">what Preprod does not keep private</a>: a withdrawal publicly links my note's history, and the Operator sees my weight and balance and is trusted to pick winners fairly.</span>
    </label>
  );
  if (name === "contribute-detail") return s.combinedAck ? "Principal custody and TWAB start immediately" : "Read and accept the Preprod privacy losses first";
  if (name === "withdraw-detail") return "Publicly links this note's history to its contribution";
  if (name === "draw-hint") return "Winner computed by the Operator, not the contract · 2-of-3 reveals, all three keys held by one maintainer";
  if (name === "boundaries") return <BoundariesProse />;
  return null;
}

// ── Variant C: a visibility table replaces the prose, one checkbox under it ───────

const ROWS: { item: string; ledger: string; operator: string; loss?: boolean }[] = [
  { item: "Your balance", ledger: "Hidden", operator: "Sees it", loss: true },
  { item: "Your weight in a draw", ledger: "Hidden", operator: "Sees it", loss: true },
  { item: "Which contribution a withdrawal came from", ledger: "Visible", operator: "Visible", loss: true },
  { item: "When you contribute or withdraw", ledger: "Visible", operator: "Visible" },
  { item: "The Winning Commitment", ledger: "Visible", operator: "Picks it", loss: true },
  { item: "Who owns the Winning Commitment", ledger: "Hidden", operator: "Not published" },
];

function slotC(name: Slot, s: { combinedAck: boolean; setCombinedAck: (v: boolean) => void }): ReactNode {
  if (name === "pre-contribute") return (
    <div className="backup-box">
      <p><strong>What this Preprod deployment reveals</strong></p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead><tr style={{ textAlign: "left", color: "var(--cream)" }}><th style={cell}></th><th style={cell}>Public ledger</th><th style={cell}>Operator</th></tr></thead>
        <tbody>{ROWS.map((row) => (
          <tr key={row.item} style={row.loss ? { background: "rgba(255,190,120,.07)" } : undefined}>
            <td style={cell}>{row.loss && <AlertTriangle size={11} />} {row.item}</td><td style={cell}>{row.ledger}</td><td style={cell}>{row.operator}</td>
          </tr>))}
        </tbody>
      </table>
      <p>Highlighted rows are Preprod losses. A withdrawal publicly retires its note by leaf index or nullifier, which links the note's history. The Operator computes each weighted winner itself and is trusted to do so fairly; the contract cannot check the pick. The same maintainer holds all three randomness keys.</p>
      <label style={check}><input type="checkbox" checked={s.combinedAck} onChange={(e) => s.setCombinedAck(e.target.checked)} /> I have read what this deployment reveals and want to contribute.</label>
    </div>
  );
  if (name === "contribute-detail") return null;
  if (name === "withdraw-detail") return "Visible on the ledger: which contribution this came from";
  if (name === "draw-hint") return "Operator-computed winner · 2-of-3 reveals from one maintainer's keys";
  if (name === "boundaries") return <BoundariesProse />;
  return null;
}

// ── Variant D: visual cards, few words, exact wording one click away ────────────

function slotD(name: Slot, s: { lineageAck: boolean; setLineageAck: (v: boolean) => void; operatorAck: boolean; setOperatorAck: (v: boolean) => void }): ReactNode {
  if (name === "pre-contribute") return (
    <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
      <p style={{ margin: 0, color: "var(--cream)", font: "600 15px Fraunces, serif" }}>Before you contribute: 2 things to know</p>
      <div style={card}>
        <div style={cardHead}><Link2 size={18} /> Withdrawing links back to your deposit</div>
        <div style={flow}>
          <Node icon={<ArrowDownToLine size={16} />} label="Your deposit" />
          <div style={link}><Eye size={13} /> anyone can see this link</div>
          <Node icon={<RefreshCw size={16} />} label="Your withdrawal" />
        </div>
        <div style={chips}><Chip seen>That they're connected</Chip><Chip seen>When you act</Chip><Chip>How much</Chip><Chip>Your balance</Chip></div>
        <Ack checked={s.lineageAck} onChange={s.setLineageAck}>Got it: withdrawing links back to my deposit.</Ack>
      </div>
      <div style={card}>
        <div style={cardHead}><UserCog size={18} /> The Operator picks the winner</div>
        <div style={flow}>
          <Node icon={<LockKeyhole size={16} />} label="Your weight" sub="hidden from the public" />
          <ArrowRight size={16} color="var(--muted)" />
          <Node icon={<Eye size={16} />} label="Operator sees it" sub="and computes the pick" warn />
          <ArrowRight size={16} color="var(--muted)" />
          <Node icon={<Trophy size={16} />} label="Winner" />
        </div>
        <div style={chips}>
          <Chip ok>Contract checks the randomness</Chip><Chip ok>Contract checks your claim</Chip>
          <Chip bad>No one checks the pick was fair</Chip><Chip bad><KeyRound size={11} /> One person holds all 3 randomness keys</Chip>
        </div>
        <Ack checked={s.operatorAck} onChange={s.setOperatorAck}>Got it: I'm trusting the Operator, who sees my weight and balance.</Ack>
      </div>
      <details style={{ color: "var(--muted)", fontSize: 11, lineHeight: 1.6 }}>
        <summary style={{ cursor: "pointer", color: "var(--aqua)" }}>Read the exact wording</summary>
        <p>A withdrawal publicly retires the note you withdraw from, by its leaf index or nullifier. Anyone reading the public ledger can connect that withdrawal to the contribution that created the note and to every earlier action in the same note's history. Your amounts and balance stay private.</p>
        <p>Until an unattended selection method qualifies, the Shroudly maintainer, acting as Operator, reads the weight and balance of every commitment and computes the weighted winner from the contract's combined randomness. The contract enforces the randomness threshold, records the Winning Commitment and checks your private claim, but it cannot confirm the pick was fair. The same maintainer holds all three randomness keys, so neither the randomness nor the selection is independent.</p>
      </details>
    </div>
  );
  if (name === "contribute-detail") return s.lineageAck && s.operatorAck ? "Principal custody and TWAB start immediately" : "Tick both \"Got it\" boxes above first";
  if (name === "withdraw-detail") return "👁 Publicly links back to your deposit";
  if (name === "draw-hint") return "👁 Winner picked by the Operator · 2-of-3 reveals, one person holds all keys";
  if (name === "boundaries") return <BoundariesProse />;
  return null;
}

function Node({ icon, label, sub, warn }: { icon: ReactNode; label: string; sub?: string; warn?: boolean }) {
  return <div style={{ display: "grid", justifyItems: "center", gap: 4, minWidth: 92, textAlign: "center" }}>
    <span style={{ display: "grid", placeItems: "center", width: 38, height: 38, borderRadius: 12, background: warn ? "rgba(255,190,120,.14)" : "rgba(155,140,255,.14)", color: warn ? "#ffbe78" : "var(--violet)" }}>{icon}</span>
    <strong style={{ fontSize: 11, color: "var(--cream)" }}>{label}</strong>{sub && <small style={{ fontSize: 9.5, color: "var(--muted)" }}>{sub}</small>}
  </div>;
}
function Chip({ children, seen, ok, bad }: { children: ReactNode; seen?: boolean; ok?: boolean; bad?: boolean }) {
  const [icon, color] = bad ? [<X size={11} />, "#ff9b8a"] : ok ? [<Check size={11} />, "var(--aqua)"] : seen ? [<Eye size={11} />, "#ffbe78"] : [<LockKeyhole size={11} />, "var(--aqua)"];
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 9px", borderRadius: 999, fontSize: 10.5, color, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)" }}>{icon}{!ok && !bad && <b style={{ fontWeight: 600 }}>{seen ? "Public:" : "Private:"}</b>} {children}</span>;
}
function Ack({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return <label style={{ ...check, fontSize: 11.5, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,.07)" }}><input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {children}</label>;
}
const card = { display: "grid", gap: 12, padding: 16, borderRadius: 14, border: "1px solid rgba(255,190,120,.25)", background: "rgba(255,190,120,.04)" } as const;
const cardHead = { display: "flex", alignItems: "center", gap: 8, color: "var(--cream)", fontWeight: 600, fontSize: 14 } as const;
const flow = { display: "flex", alignItems: "center", justifyContent: "center", gap: 10, flexWrap: "wrap", padding: "6px 0" } as const;
const link = { flex: "1 1 120px", maxWidth: 220, display: "flex", alignItems: "center", justifyContent: "center", gap: 5, padding: "4px 0", borderTop: "2px dashed #ffbe78", color: "#ffbe78", fontSize: 10.5 } as const;
const chips = { display: "flex", flexWrap: "wrap", gap: 6 } as const;

// Replaces "Know the test boundaries" in every variant.
function BoundariesProse() {
  return (
    <section className="disclosure" id="boundaries"><EyeOff size={22} /><div>
      <h2>What Preprod does not keep private</h2>
      <p><strong>Withdrawals link note history.</strong> A withdrawal publicly retires its note by leaf index or nullifier. Anyone reading the ledger can link the withdrawal to the contribution that created the note. Amounts and balances stay private. The timing of every contract action is public.</p>
      <p><strong>The Operator selects winners.</strong> During Preprod the maintainer, acting as Operator, reads commitment weights and balances and computes each weighted winner from the contract's combined randomness. The contract enforces the randomness threshold and the private claim but cannot check that the pick was fair. All three randomness keys belong to that same maintainer, so neither randomness nor selection is independent custody. A successful draw is evidence of protocol behaviour, not of independent selection.</p>
      <p><strong>Five commitments are not five people.</strong> {COHORT_HINT} The Disclosure Cohort is not an anonymity guarantee. Simulated Yield is at most 100 tMIX per completed 15-minute draw, and tMIX has no monetary value.</p>
    </div></section>
  );
}

const check = { display: "flex", gap: 8, alignItems: "flex-start", color: "var(--cream)", cursor: "pointer" } as const;
const cell = { padding: "5px 6px", borderBottom: "1px solid rgba(255,255,255,.07)" } as const;
const bar = { position: "fixed", bottom: 64, left: "50%", transform: "translateX(-50%)", zIndex: 1000, display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 999, background: "#fff", color: "#111", font: "600 12px system-ui", boxShadow: "0 6px 24px rgba(0,0,0,.45)" } as const;
const barButton = { display: "grid", placeItems: "center", width: 26, height: 26, borderRadius: 999, border: "1px solid #ccc", background: "#f4f4f4", cursor: "pointer" } as const;
