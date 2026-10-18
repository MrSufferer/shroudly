import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COMPACT_PROFILE, CONTRACT_COMPONENTS } from "./index";

const midnightRoot = resolve(import.meta.dirname, "../../../midnight");
const sources = Object.fromEntries(CONTRACT_COMPONENTS.map((name) => [name, readFileSync(resolve(midnightRoot, `${name}.compact`), "utf8")])) as Record<(typeof CONTRACT_COMPONENTS)[number], string>;

describe("Shroudly Compact release profile", () => {
  test("contains exactly the four native contract components", () => {
    expect(CONTRACT_COMPONENTS).toEqual([
      "TmixAsset",
      "RandomnessThreshold",
      "YieldAdapter",
      "PrizePool",
    ]);
  });

  test("pins the reviewed Preprod compatibility set", () => {
    expect(COMPACT_PROFILE).toMatchObject({
      compactCli: "0.5.2",
      language: "0.23.0",
      compiler: "0.31.1",
      runtime: "0.16.0",
      midnightJs: "4.1.1",
      walletSdk: "1.2.0",
      dappConnector: "4.0.1",
      node: "1.0.400",
      indexer: "4.3.302",
      proofServer: "8.1.3",
    });
  });

  test("pins real shielded custody and source-level authorization seams", () => {
    expect(sources.TmixAsset).toContain("mintShieldedToken");
    expect(sources.TmixAsset).toContain("authorityCommitment");
    expect(sources.TmixAsset).toContain("faucetNullifiers");
    expect(sources.TmixAsset).toContain("seedPrizeReserve");
    expect(sources.TmixAsset).toContain("reserveSeeded");
    expect(sources.TmixAsset).toContain("assert(disclose(owner == participant),");

    expect(sources.PrizePool).toContain("receiveShielded");
    expect(sources.PrizePool).toContain("sendShielded");
    expect(sources.PrizePool).toContain("participantTwab");
    expect(sources.PrizePool).toContain("selectionIndex");
    expect(sources.PrizePool).toContain("selection_bits");
    expect(sources.PrizePool).toContain("rolloverSubthreshold");
    expect(sources.PrizePool).toContain("replenishPrizeReserve");
    expect(sources.PrizePool).toContain("drawId = (drawId + 1) as Uint<64>");
    expect(sources.PrizePool).not.toMatch(/finalize\([^)]*winnerOwner/);

    expect(sources.RandomnessThreshold).toContain("canonical order");
    expect(sources.RandomnessThreshold).toContain("revealCount >= 2");
    expect(sources.RandomnessThreshold).toContain("duplicate reveal");
    expect(sources.YieldAdapter).toContain("draw == completedDraws + 1");
    expect(sources.YieldAdapter).toContain("replenishment timelock has not elapsed");
  });

  test("does not reintroduce legacy or prover-controlled authorization patterns", () => {
    for (const source of Object.values(sources)) {
      expect(source).not.toMatch(/\bownPublicKey\s*\(/);
      expect(source).not.toContain("getOrDefault");
      expect(source).not.toMatch(/\.set\s*\(/);
    }
  });
});
