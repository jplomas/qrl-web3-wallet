import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrateStoredAddresses } from "./storedAddressMigration";

// The shared mock is a bare stub whose `get` always resolves `{}`. This module is
// all about reading and rewriting the whole store, so it needs a functioning
// in-memory `storage.local` — including `get(null)`, which returns everything.
const memory: Record<string, unknown> = {};

vi.mock("webextension-polyfill", () => ({
  default: {
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[] | null) => {
          if (keys === null || keys === undefined) return { ...memory };
          const wanted = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(
            wanted.filter((k) => k in memory).map((k) => [k, memory[k]]),
          );
        }),
        set: vi.fn(async (items: Record<string, unknown>) => {
          Object.assign(memory, items);
        }),
        clear: vi.fn(async () => {
          for (const k of Object.keys(memory)) delete memory[k];
        }),
      },
    },
  },
}));

// Assertions index freely into the stored tree, so read it back loosely typed.
const store = () => memory as Record<string, any>;

const OLD = "Q20B714091cF2a62DADda2847803e3f1B9D2D3779";
const NEW =
  "Q0000000000000000000000000000000000000000000000000000000020b714091cf2a62dadda2847803e3f1b9d2d377900000000000000000000000000000000";
const OTHER_OLD = "Qfb08ff1f1376a14c055e9f56df80563e16722baa";
const OTHER_NEW =
  "Q00000000000000000000000000000000000000000000000000000000fb08ff1f1376a14c055e9f56df80563e16722baa00000000000000000000000000000000";

const seed = async (data: Record<string, unknown>) => {
  for (const k of Object.keys(memory)) delete memory[k];
  Object.assign(memory, data);
};

describe("storedAddressMigration", () => {
  beforeEach(() => {
    for (const k of Object.keys(memory)) delete memory[k];
  });

  it("does nothing when there are no remaps", async () => {
    await seed({ ACCOUNT_LABELS: { [OLD]: "Cold savings" } });
    expect(await migrateStoredAddresses([])).toEqual([]);
    expect(store().ACCOUNT_LABELS).toEqual({ [OLD]: "Cold savings" });
  });

  it("remaps the account list and the active account", async () => {
    await seed({
      ACCOUNTS: {
        ALL_ACCOUNTS: [OLD, OTHER_OLD],
        ACTIVE_ACCOUNT: OLD,
      },
    });

    const changed = await migrateStoredAddresses([
      { from: OLD, to: NEW },
      { from: OTHER_OLD, to: OTHER_NEW },
    ]);

    expect(changed).toContain("ACCOUNTS");
    expect(store().ACCOUNTS.ALL_ACCOUNTS).toEqual([NEW, OTHER_NEW]);
    expect(store().ACCOUNTS.ACTIVE_ACCOUNT).toBe(NEW);
  });

  it("remaps addresses used as object keys, preserving their values", async () => {
    await seed({
      ACCOUNT_LABELS: { [OLD]: "Cold savings" },
      HIDDEN_ACCOUNTS: { [OLD]: true },
      TOKENS: { ALL_TOKENS: { [OLD]: [{ symbol: "ZRC" }] } },
      NFT_COLLECTIONS: { ALL_NFT_COLLECTIONS: { [OLD]: ["kitty"] } },
    });

    await migrateStoredAddresses([{ from: OLD, to: NEW }]);

    expect(store().ACCOUNT_LABELS).toEqual({ [NEW]: "Cold savings" });
    expect(store().HIDDEN_ACCOUNTS).toEqual({ [NEW]: true });
    expect(store().TOKENS.ALL_TOKENS[NEW]).toEqual([{ symbol: "ZRC" }]);
    expect(store().NFT_COLLECTIONS.ALL_NFT_COLLECTIONS[NEW]).toEqual(["kitty"]);
  });

  it("remaps addresses nested in records, arrays and per-origin grants", async () => {
    await seed({
      CONTACTS: { ALL_CONTACTS: [{ name: "Bob", address: OTHER_OLD }] },
      LEDGER: { LEDGER_ACCOUNTS: [{ address: OLD, index: 0 }] },
      DAPPS: {
        ALL_DAPPS: {
          "https://dex.example": {
            urlOrigin: "https://dex.example",
            accounts: [OLD, OTHER_OLD],
          },
        },
      },
      "0x1_TRANSACTION_VALUES": { receiverAddress: OTHER_OLD, amount: 5 },
    });

    await migrateStoredAddresses([
      { from: OLD, to: NEW },
      { from: OTHER_OLD, to: OTHER_NEW },
    ]);

    expect(store().CONTACTS.ALL_CONTACTS[0].address).toBe(OTHER_NEW);
    expect(store().LEDGER.LEDGER_ACCOUNTS[0]).toEqual({
      address: NEW,
      index: 0,
    });
    expect(
      store().DAPPS.ALL_DAPPS["https://dex.example"].accounts,
    ).toEqual([NEW, OTHER_NEW]);
    expect(store()["0x1_TRANSACTION_VALUES"]).toEqual({
      receiverAddress: OTHER_NEW,
      amount: 5,
    });
  });

  it("remaps the transaction-history key and the from/to inside each entry", async () => {
    await seed({
      TX_HISTORY: {
        ALL_TX_HISTORY: {
          [OLD]: [
            { id: "0xabc", from: OLD, to: OTHER_OLD, amount: 1 },
            { id: "0xdef", from: OTHER_OLD, to: OLD, amount: 2 },
          ],
        },
      },
    });

    await migrateStoredAddresses([
      { from: OLD, to: NEW },
      { from: OTHER_OLD, to: OTHER_NEW },
    ]);

    const history = store().TX_HISTORY.ALL_TX_HISTORY;
    expect(Object.keys(history)).toEqual([NEW]);
    expect(history[NEW][0]).toEqual({
      id: "0xabc",
      from: NEW,
      to: OTHER_NEW,
      amount: 1,
    });
    // Transaction hashes must survive untouched — only addresses are rewritten.
    expect(history[NEW][1].id).toBe("0xdef");
  });

  it("matches case-insensitively, since addresses are stored both checksummed and lower-cased", async () => {
    await seed({ ACCOUNT_LABELS: { [OLD.toLowerCase()]: "lower" } });

    await migrateStoredAddresses([{ from: OLD, to: NEW }]);

    expect(store().ACCOUNT_LABELS).toEqual({ [NEW]: "lower" });
  });

  it("never rewrites the keystores, which own their own labels", async () => {
    const keystores = JSON.stringify([{ address: OLD, crypto: {} }]);
    await seed({ KEYSTORES: keystores, ACCOUNT_LABELS: { [OLD]: "x" } });

    const changed = await migrateStoredAddresses([{ from: OLD, to: NEW }]);

    expect(changed).not.toContain("KEYSTORES");
    expect(store().KEYSTORES).toBe(keystores);
    expect(store().ACCOUNT_LABELS).toEqual({ [NEW]: "x" });
  });

  it("leaves unrelated data alone and only reports the keys it touched", async () => {
    await seed({
      ACCOUNT_LABELS: { [OLD]: "Cold savings" },
      SETTINGS: { autoLockMinutes: 15 },
      PRICE_CACHE: { usd: 1.23 },
    });

    const changed = await migrateStoredAddresses([{ from: OLD, to: NEW }]);

    expect(changed).toEqual(["ACCOUNT_LABELS"]);
    expect(store().SETTINGS).toEqual({ autoLockMinutes: 15 });
    expect(store().PRICE_CACHE).toEqual({ usd: 1.23 });
  });

  it("is idempotent — a second run changes nothing", async () => {
    await seed({
      ACCOUNTS: { ALL_ACCOUNTS: [OLD], ACTIVE_ACCOUNT: OLD },
      ACCOUNT_LABELS: { [OLD]: "Cold savings" },
    });

    await migrateStoredAddresses([{ from: OLD, to: NEW }]);
    const afterFirst = JSON.stringify(store());

    expect(await migrateStoredAddresses([{ from: OLD, to: NEW }])).toEqual([]);
    expect(JSON.stringify(store())).toBe(afterFirst);
  });
});
