# Applies the drafted amendment to a copy of the PRD body and reports sizes.
import sys
src, out, moved_out = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(src).read()
LIMIT = 65536
MAP = "https://github.com/MrSufferer/shroudly/issues/57"
MOVED = "MOVED_COMMENT_URL"

edits = []
def rep(old, new):
    edits.append((old, new))

# Stories (#59, #63, #69)
rep("33. As a Preprod reviewer, I want the interface and runbook to disclose that all three randomness keys are controlled by the same maintainer so that provider isolation is not described as independent custody.",
    "33. As a Preprod reviewer, I want the interface and runbook to disclose that all three randomness keys are controlled by the same maintainer, who also computes interim Preprod selection, so that neither provider isolation nor selection is described as independent custody.")
rep("45. As a participant, I want my private balance, action amounts, weight, identity linkages, and winning identity excluded from public application state and operational telemetry so that private participant data stays private.",
    "45. As a participant, I want my private balance, action amounts, weight, identity linkages, and winning identity excluded from public application state and operational telemetry, with the accepted Preprod losses of the 2026-10-18 amendment stated before I contribute, so that private participant data stays private and every loss is disclosed.")
rep("47. As a participant, I want an explanation that public contract action timing remains observable so that Shroudly does not promise invisible transactions.",
    "47. As a participant, I want an explanation that public contract action timing remains observable, and that a Preprod withdrawal publicly links the retired note's lineage, so that Shroudly does not promise invisible transactions.")
rep("98. As a maintainer, I want a runbook that starts from empty GitHub, Vercel, Render, Supabase, Resend, Better Stack, DNS, and Midnight account state",
    "98. As a maintainer, I want a runbook that starts from empty GitHub, Vercel, Render, Supabase, Resend, Better Stack, Blockfrost, DNS, and Midnight account state")
rep("102. As a maintainer, I want free-tier Preprod limitations for Render, Supabase, Resend, Better Stack, GitHub Actions, and Vercel documented",
    "102. As a maintainer, I want free-tier Preprod limitations for Render, Supabase, Resend, Better Stack, GitHub Actions, Vercel, and Blockfrost documented")

# Implementation Decisions
rep("Supabase, Render, GitHub Actions, Vercel, and telemetry are non-authoritative and cannot reconstruct private state or change financial outcomes.",
    "Supabase, Render, GitHub Actions, Vercel, Blockfrost, the Chain Data Proxy, and telemetry are non-authoritative and cannot reconstruct private state or change financial outcomes. Sole exception: interim Preprod selection is Operator-computed (ADR 0031; see the amendment).")
rep("Host the static web application on Vercel, the stateless sponsor on Render,",
    "Host the static web application on Vercel, the stateless sponsor and read-only Chain Data Proxy on Render, Preprod chain data on Blockfrost,")
rep("Midnight endpoints, contracts, keys, DUST, and roles;",
    "Blockfrost accounts and Chain Data Proxy; Midnight contracts, keys, DUST registration, and roles;")

# Testing Decisions
rep("finalize permissionlessly, identify the contract-selected wallet, and have that wallet claim.",
    "finalize permissionlessly, identify the selected wallet (Operator-computed under ADR 0031 until #22 qualifies an alternative), and have that wallet claim.")

# Out of Scope
rep("multiple winners per draw, discretionary winner selection, or a randomness fallback.",
    "multiple winners per draw, discretionary winner selection (the ADR 0031 interim computation must apply the contract's combined randomness), or a randomness fallback.")

# Technical refinement
rep("remaining pins in `midnight/version-profile.json`. These are candidates to qualify together, not certified compatibility. Node 1.0.2 in that profile denotes the Midnight node, distinct from Node.js >=22.",
    "remaining pins in `midnight/version-profile.json` (amended 2026-10-18). These are candidates to qualify together, not certified compatibility. Node 1.0.400 in that profile denotes the Midnight node, distinct from Node.js >=22.")
rep("If infeasible, return an evidenced trade-off for decision before weakening privacy or requiring check-ins.",
    "If infeasible, return an evidenced trade-off for decision before weakening privacy or requiring check-ins; ADR 0031 records the accepted trade-off.")

AMEND = open(sys.argv[4]).read().rstrip("\n").replace("MAP_URL", MAP)
rep("# Accepted technical refinement — 2026-10-16\n", AMEND + "\n\n# Accepted technical refinement — 2026-10-16\n")

# Overflow: move two subsections verbatim to a comment on #2
start = s.index("## Selected participant experience\n")
end = s.index("## Four required qualification experiments\n")
moved = s[start:end]
for old, new in edits:
    n = s.count(old)
    assert n == 1, (n, old[:70])
    s = s.replace(old, new)
start = s.index("## Selected participant experience\n")
end = s.index("## Four required qualification experiments\n")
pointer = ("## Selected participant experience and acceptance cases\n\n"
           "Moved verbatim to [this comment](" + MOVED + ") on 2026-10-18 to stay within GitHub's body limit. It remains part of this specification.\n\n")
s = s[:start] + pointer + s[end:]
open(out, "w").write(s)
header = ("**Part of PRD #2's accepted technical refinement, moved from the issue body on 2026-10-18 to stay within GitHub's body limit. It is unchanged and still binding.**\n\n")
open(moved_out, "w").write(header + moved.rstrip("\n") + "\n")
print("before", len(open(src).read()), "after", len(s), "headroom", LIMIT - len(s), "moved", len(header + moved))
