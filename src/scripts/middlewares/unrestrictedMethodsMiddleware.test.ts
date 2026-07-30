import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(() => Promise.resolve("0x1")),
}));

vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: { tabs: { sendMessage: mockSendMessage } },
}));

const grants: Record<string, unknown> = {};
const { mockClearGrants } = vi.hoisted(() => ({ mockClearGrants: vi.fn() }));

vi.mock("@/utilities/storageUtil", () => ({
  __esModule: true,
  default: {
    getDAppsConnectedAccountsData: vi.fn((origin: string) =>
      Promise.resolve(grants[origin]),
    ),
    clearDAppsConnectedAccountsData: mockClearGrants,
    getSettings: vi.fn(() =>
      Promise.resolve({ phishingDetectionEnabled: true }),
    ),
  },
}));

const { mockCheckDomain } = vi.hoisted(() => ({
  mockCheckDomain: vi.fn(() => ({ isDomainPhishing: false })),
}));

vi.mock("../phishing/phishingDetector", () => ({
  checkDomain: mockCheckDomain,
}));

vi.mock("../utils/restrictedMethodsMiddlewareUtils", async () => {
  const actual = await vi.importActual<
    typeof import("../utils/restrictedMethodsMiddlewareUtils")
  >("../utils/restrictedMethodsMiddlewareUtils");
  return {
    checkUrlOriginHasBeenConnected: vi.fn(() =>
      Promise.resolve({ canProceed: true }),
    ),
    // Keep the real origin derivation so the opaque-origin behaviour is exercised.
    getRequestOrigin: actual.getRequestOrigin,
  };
});

import { unrestrictedMethodsMiddleware } from "./unrestrictedMethodsMiddleware";

const makeReq = (
  senderData: Record<string, unknown>,
  method = "qrl_blockNumber",
) =>
  ({
    id: 1,
    jsonrpc: "2.0" as const,
    method,
    params: [],
    senderData,
  }) as never;

const run = async (
  senderData: Record<string, unknown>,
  method?: string,
) => {
  const res = {} as Record<string, unknown>;
  await unrestrictedMethodsMiddleware(
    makeReq(senderData, method),
    res as never,
    vi.fn() as never,
    vi.fn() as never,
  );
  return res;
};

describe("unrestrictedMethodsMiddleware — reply targeting", () => {
  beforeEach(() => {
    mockSendMessage.mockClear();
    mockCheckDomain.mockReturnValue({ isDomainPhishing: false });
  });

  // CIPH-QRLW326-27. The phishing check ran only on the restricted path, so a
  // listed domain could still enumerate accounts and broadcast a pre-signed
  // transaction with no check at all.
  it("blocks account enumeration from a known-phishing origin", async () => {
    mockCheckDomain.mockReturnValue({ isDomainPhishing: true });
    grants["https://evil.example"] = { accounts: ["Qalice"], permissions: [] };

    const res = await run(
      { tabId: 7, frameId: 0, url: "https://evil.example/app" },
      "qrl_accounts",
    );

    expect(res.result).toBeUndefined();
    expect((res.error as Error).message).toMatch(/phishing/i);
  });

  it("blocks raw transaction broadcast from a known-phishing origin", async () => {
    mockCheckDomain.mockReturnValue({ isDomainPhishing: true });

    const res = await run(
      { tabId: 7, frameId: 0, url: "https://evil.example/app" },
      "qrl_sendRawTransaction",
    );

    expect((res.error as Error).message).toMatch(/phishing/i);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("leaves read-only chain queries open even for a flagged origin", async () => {
    // Blocking these would degrade the wallet without denying the attacker
    // anything they could not read from a public node themselves.
    mockCheckDomain.mockReturnValue({ isDomainPhishing: true });

    const res = await run(
      { tabId: 7, frameId: 0, url: "https://evil.example/app" },
      "qrl_blockNumber",
    );

    expect(res.error).toBeUndefined();
    expect(mockSendMessage).toHaveBeenCalled();
  });

  // CIPH-QRLW326-21. Without `frameId` the message reaches every frame in the tab
  // and each independently performs the upstream RPC, so a page with N iframes
  // amplified one provider call into N — and executed side-effecting methods
  // (`qrl_sendRawTransaction`, `qrl_subscribe`) N times.
  it("addresses the reply to the frame that made the request", async () => {
    await run({ tabId: 7, frameId: 3, url: "https://dapp.example" });

    expect(mockSendMessage).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ data: expect.anything() }),
      { frameId: 3 },
    );
  });

  it("targets the top-level frame explicitly when frameId is 0", async () => {
    await run({ tabId: 7, frameId: 0, url: "https://dapp.example" });

    expect(mockSendMessage).toHaveBeenCalledWith(
      7,
      expect.anything(),
      { frameId: 0 },
    );
  });

  it("falls back to the whole tab only when no frameId was stamped", async () => {
    await run({ tabId: 7, url: "https://dapp.example" });

    expect(mockSendMessage).toHaveBeenCalledWith(7, expect.anything(), undefined);
  });

  // CIPH-QRLW326-24. These read and write the per-origin permission store and used
  // to run in the content script — injected into every frame of every URL, with no
  // need for storage access. They are answered in the service worker now, so the
  // content script is never asked.
  it("answers qrl_accounts in the service worker without dispatching to the page", async () => {
    grants["https://dex.example"] = { accounts: ["Qalice"], permissions: [] };

    const res = await run(
      { tabId: 7, frameId: 0, url: "https://dex.example/app" },
      "qrl_accounts",
    );

    expect(res.result).toEqual(["Qalice"]);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("answers wallet_getPermissions in the service worker", async () => {
    grants["https://dex.example"] = {
      accounts: [],
      permissions: [{ parentCapability: "qrl_accounts" }],
    };

    const res = await run(
      { tabId: 7, frameId: 0, url: "https://dex.example/app" },
      "wallet_getPermissions",
    );

    expect(res.result).toEqual([{ parentCapability: "qrl_accounts" }]);
    expect(mockSendMessage).not.toHaveBeenCalled();
  });

  it("revokes only for an identifiable origin", async () => {
    mockClearGrants.mockClear();

    await run(
      { tabId: 7, frameId: 0, url: "https://dex.example/app" },
      "wallet_revokePermissions",
    );
    expect(mockClearGrants).toHaveBeenCalledWith("https://dex.example");

    // An opaque origin is shared by every file:// document, so a revoke there
    // would clear a bucket that belongs to nobody. See CIPH-QRLW326-31.
    mockClearGrants.mockClear();
    await run(
      { tabId: 7, frameId: 0, url: "file:///tmp/local.html" },
      "wallet_revokePermissions",
    );
    expect(mockClearGrants).not.toHaveBeenCalled();
  });

  it("surfaces a dispatch failure as a provider error rather than throwing", async () => {
    mockSendMessage.mockRejectedValueOnce(new Error("no receiving end"));

    const res = await run({ tabId: 7, frameId: 1, url: "https://dapp.example" });

    expect(res.error).toBeDefined();
    expect((res.error as Error).message).toMatch(/no receiving end/);
  });
});
