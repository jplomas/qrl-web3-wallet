import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(() => Promise.resolve("0x1")),
}));

vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: { tabs: { sendMessage: mockSendMessage } },
}));

vi.mock("../utils/restrictedMethodsMiddlewareUtils", () => ({
  checkUrlOriginHasBeenConnected: vi.fn(() =>
    Promise.resolve({ canProceed: true }),
  ),
}));

import { unrestrictedMethodsMiddleware } from "./unrestrictedMethodsMiddleware";

const makeReq = (senderData: Record<string, unknown>) =>
  ({
    id: 1,
    jsonrpc: "2.0" as const,
    method: "qrl_blockNumber",
    params: [],
    senderData,
  }) as never;

const run = async (senderData: Record<string, unknown>) => {
  const res = {} as Record<string, unknown>;
  await unrestrictedMethodsMiddleware(
    makeReq(senderData),
    res as never,
    vi.fn() as never,
    vi.fn() as never,
  );
  return res;
};

describe("unrestrictedMethodsMiddleware — reply targeting", () => {
  beforeEach(() => {
    mockSendMessage.mockClear();
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

  it("surfaces a dispatch failure as a provider error rather than throwing", async () => {
    mockSendMessage.mockRejectedValueOnce(new Error("no receiving end"));

    const res = await run({ tabId: 7, frameId: 1, url: "https://dapp.example" });

    expect(res.error).toBeDefined();
    expect((res.error as Error).message).toMatch(/no receiving end/);
  });
});
