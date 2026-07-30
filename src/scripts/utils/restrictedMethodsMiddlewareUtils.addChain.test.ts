import { describe, expect, it } from "vitest";
import { checkWalletAddQrlChainParams } from "./restrictedMethodsMiddlewareUtils";
import type { BlockchainDataType } from "@/configuration/qrlBlockchainConfig";

const baseChain = (rpcUrls: string[]) =>
  ({
    chainName: "Test Chain",
    chainId: "0x3e9",
    nativeCurrency: { name: "Quanta", symbol: "QRL", decimals: 18 },
    rpcUrls,
    blockExplorerUrls: ["https://explorer.example"],
    iconUrls: [],
  }) as unknown as BlockchainDataType;

describe("checkWalletAddQrlChainParams — rpcUrls acceptability", () => {
  it("accepts a chain whose every RPC url is HTTPS", async () => {
    const result = await checkWalletAddQrlChainParams(
      baseChain(["https://a.example", "https://b.example"]),
    );
    expect(result.canProceed).toBe(true);
  });

  it("accepts loopback endpoints", async () => {
    const result = await checkWalletAddQrlChainParams(
      baseChain(["http://localhost:8545", "http://127.0.0.1:8545"]),
    );
    expect(result.canProceed).toBe(true);
  });

  // CIPH-QRLW326-7. `rpcUrls[0]` becomes the live provider, and the caller picks
  // the order — so validating on the strength of *some other* element let a dApp
  // install a cleartext, attacker-controlled endpoint as the active RPC.
  it("rejects a cleartext endpoint smuggled in alongside a valid HTTPS one", async () => {
    const result = await checkWalletAddQrlChainParams(
      baseChain(["http://rpc.mallory.example", "https://rpc.theqrl.org"]),
    );
    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.message).toMatch(/rpcUrls/);
  });

  it("rejects a cleartext endpoint in any position, not just the first", async () => {
    const result = await checkWalletAddQrlChainParams(
      baseChain(["https://rpc.theqrl.org", "http://rpc.mallory.example"]),
    );
    expect(result.canProceed).toBe(false);
  });

  it("rejects an empty or missing rpcUrls array", async () => {
    await expect(
      checkWalletAddQrlChainParams(baseChain([])).then((r) => r.canProceed),
    ).resolves.toBe(false);
    await expect(
      checkWalletAddQrlChainParams({
        ...baseChain(["https://a.example"]),
        rpcUrls: undefined,
      } as unknown as BlockchainDataType).then((r) => r.canProceed),
    ).resolves.toBe(false);
  });

  it("rejects a dApp-supplied defaultRpcUrl that is not acceptable", async () => {
    // `defaultRpcUrl` is an internal key, so a dApp cannot normally set it; this
    // guards the wallet's own Add/Edit Chain path, which passes hasInternalKeys.
    const result = await checkWalletAddQrlChainParams(
      {
        ...baseChain(["https://rpc.theqrl.org"]),
        defaultRpcUrl: "http://rpc.mallory.example",
      } as unknown as BlockchainDataType,
      true,
    );
    expect(result.canProceed).toBe(false);
    expect(result.proceedError?.message).toMatch(/defaultRpcUrl/);
  });

  it("accepts an acceptable defaultRpcUrl on the internal path", async () => {
    const result = await checkWalletAddQrlChainParams(
      {
        ...baseChain(["https://rpc.theqrl.org"]),
        defaultRpcUrl: "https://rpc.theqrl.org",
      } as unknown as BlockchainDataType,
      true,
    );
    expect(result.canProceed).toBe(true);
  });
});
