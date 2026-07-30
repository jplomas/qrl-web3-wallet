import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Plain object stores (hoisting-safe) ────────────────────────────
const localStore: Record<string, any> = {};
const sessionStore: Record<string, any> = {};
const alarmsStore: Record<string, any> = {};

vi.mock("webextension-polyfill", () => ({
  __esModule: true,
  default: {
    storage: {
      local: {
        get: vi.fn((key: string) =>
          Promise.resolve(
            key in localStore ? { [key]: localStore[key] } : {},
          ),
        ),
        set: vi.fn((data: Record<string, any>) => {
          Object.assign(localStore, data);
          return Promise.resolve();
        }),
        remove: vi.fn((key: string) => {
          delete localStore[key];
          return Promise.resolve();
        }),
        clear: vi.fn(() => {
          for (const k of Object.keys(localStore)) delete localStore[k];
          return Promise.resolve();
        }),
      },
      session: {
        get: vi.fn((key: string) =>
          Promise.resolve(
            key in sessionStore ? { [key]: sessionStore[key] } : {},
          ),
        ),
        set: vi.fn((data: Record<string, any>) => {
          Object.assign(sessionStore, data);
          return Promise.resolve();
        }),
        remove: vi.fn((key: string) => {
          delete sessionStore[key];
          return Promise.resolve();
        }),
      },
    },
    alarms: {
      create: vi.fn((name: string, info: any) => {
        alarmsStore[name] = info;
        return Promise.resolve();
      }),
      clear: vi.fn((name: string) => {
        delete alarmsStore[name];
        return Promise.resolve(true);
      }),
      get: vi.fn((name: string) =>
        Promise.resolve(alarmsStore[name] ?? null),
      ),
    },
  },
}));

vi.mock("@theqrl/web3", () => ({ Bytes: class {} }));
vi.mock("@theqrl/web3-qrl-accounts", () => ({
  decrypt: vi.fn(),
  encrypt: vi.fn(),
}));
vi.mock("@/functions/getMnemonicFromHexSeed", () => ({
  getMnemonicFromHexSeed: vi.fn(() => "mocked mnemonic"),
}));

import browser from "webextension-polyfill";
import LockManager, { LOCK_MANAGER_MESSAGES } from "./lockManager";
import type { DecryptedKeyType } from "./lockManager";

const mockAlarms = browser.alarms as any;

const clearStore = (store: Record<string, any>) => {
  for (const k of Object.keys(store)) delete store[k];
};

const MOCK_KEYS: DecryptedKeyType[] = [
  {
    address: "Q0000000000000000000000000000000000000000000000000000000020B714091cF2a62DADda2847803e3f1B9D2D377900000000000000000000000000000000",
    seed: "0x010000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    mnemonicPhrases: "mocked mnemonic",
  },
];

describe("LockManager – keep-alive & auto-lock", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    clearStore(localStore);
    clearStore(sessionStore);
    clearStore(alarmsStore);
    await LockManager.lock();
  });

  // ── startKeepAlive / stopKeepAlive (periodic alarm) ────────────

  describe("startKeepAlive", () => {
    it("should create a periodic alarm", async () => {
      await LockManager.startKeepAlive();

      expect(mockAlarms.create).toHaveBeenCalledWith(LockManager.KEEP_ALIVE_ALARM, {
        periodInMinutes: 0.4,
      });
    });
  });

  describe("stopKeepAlive", () => {
    it("should clear the keep-alive alarm", async () => {
      await LockManager.stopKeepAlive();

      expect(mockAlarms.clear).toHaveBeenCalledWith(LockManager.KEEP_ALIVE_ALARM);
    });
  });

  // ── handleKeepAliveAlarm ───────────────────────────────────────

  describe("handleKeepAliveAlarm", () => {
    it("should write to session storage", async () => {
      await LockManager.handleKeepAliveAlarm();

      expect(sessionStore.keepAlive).toBeDefined();
      expect(typeof sessionStore.keepAlive).toBe("number");
    });

    it("should restore keys from session if SW restarted", async () => {
      // Simulate: keys backed up in session, but in-memory is empty (SW restart)
      sessionStore["_LM_CACHED_KEYS"] = MOCK_KEYS;

      await LockManager.handleKeepAliveAlarm();

      // Keys should be restored — wallet unlocked
      localStore["KEYSTORES"] = JSON.stringify([{ address: "0x123" }]);
      localStore["ACCOUNTS"] = { ALL_ACCOUNTS: ["0x123"] };
      const { isLocked } = await LockManager.isLocked();
      expect(isLocked).toBe(false);

      await LockManager.lock();
    });
  });

  // ── Session key backup / restore ───────────────────────────────

  describe("auto-lock and session-backup safety", () => {
    it("records the LOCKED transition before clearing state", async () => {
      // CIPH-QRLW326-17. `lock()`'s first storage write raises onChanged in any
      // open page, whose recovery path compares these timestamps to tell an
      // intentional lock from a service-worker restart. Writing the marker after
      // clearing meant the page read a stale value, assumed a restart, and
      // re-sent the keys and password — undoing the auto-lock.
      localStore["SETTINGS"] = { autoLockMinutes: 5 };
      sessionStore["_LM_CACHED_KEYS"] = MOCK_KEYS;
      const writeOrder: string[] = [];
      const setSpy = vi
        .spyOn(browser.storage.local, "set")
        .mockImplementation((data: any) => {
          if ("LOCK_MANAGER_LOCKED_TIMESTAMP" in data) writeOrder.push("marker");
          Object.assign(localStore, data);
          return Promise.resolve();
        });
      const removeSpy = vi
        .spyOn(browser.storage.session, "remove")
        .mockImplementation((key: any) => {
          writeOrder.push("clear-session");
          delete sessionStore[key];
          return Promise.resolve();
        });

      await LockManager.handleAutoLockAlarm();

      expect(writeOrder).toEqual(["marker", "clear-session"]);
      setSpy.mockRestore();
      removeSpy.mockRestore();
    });

    it("clears the alarms even when removing the session backup fails", async () => {
      // CIPH-QRLW326-16. A rejection here used to leave the keep-alive running,
      // and its next tick restored the keys from the backup that was never
      // removed — the wallet silently unlocked itself.
      const removeSpy = vi
        .spyOn(browser.storage.session, "remove")
        .mockRejectedValue(new Error("storage unavailable"));
      mockAlarms.clear.mockClear();

      await expect(LockManager.lock()).rejects.toThrow("storage unavailable");

      expect(mockAlarms.clear).toHaveBeenCalledWith(LockManager.KEEP_ALIVE_ALARM);
      expect(mockAlarms.clear).toHaveBeenCalledWith(LockManager.AUTO_LOCK_ALARM);
      removeSpy.mockRestore();
    });

    it("refuses to restore a backup left behind by an intentional lock", async () => {
      // CIPH-QRLW326-16. Any stale backup used to unlock the wallet with no
      // password on the next IS_LOCKED query or keep-alive tick.
      sessionStore["_LM_CACHED_KEYS"] = MOCK_KEYS;
      localStore["LOCK_MANAGER_UNLOCKED_TIMESTAMP"] = 1_000;
      localStore["LOCK_MANAGER_LOCKED_TIMESTAMP"] = 2_000;

      await expect(LockManager.restoreKeysFromSession()).resolves.toBe(false);
      // The stale backup is discarded rather than left to authorise a later restore.
      expect(sessionStore["_LM_CACHED_KEYS"]).toBeUndefined();
    });

    it("still restores after a genuine service-worker restart", async () => {
      sessionStore["_LM_CACHED_KEYS"] = MOCK_KEYS;
      localStore["LOCK_MANAGER_LOCKED_TIMESTAMP"] = 1_000;
      localStore["LOCK_MANAGER_UNLOCKED_TIMESTAMP"] = 2_000;

      await expect(LockManager.restoreKeysFromSession()).resolves.toBe(true);
      expect(sessionStore["_LM_CACHED_KEYS"]).toEqual(MOCK_KEYS);

      await LockManager.lock();
    });
  });

  describe("session key backup", () => {
    it("should backup keys to session storage when keys are set", () => {
      LockManager.setDecryptedKeysFromPopup(MOCK_KEYS);

      expect(sessionStore["_LM_CACHED_KEYS"]).toEqual(MOCK_KEYS);
    });

    it("should clear session keys on lock", async () => {
      LockManager.setDecryptedKeysFromPopup(MOCK_KEYS);
      expect(sessionStore["_LM_CACHED_KEYS"]).toBeDefined();

      await LockManager.lock();

      expect(sessionStore["_LM_CACHED_KEYS"]).toBeUndefined();
    });

    it("should restore keys from session in isLocked()", async () => {
      localStore["KEYSTORES"] = JSON.stringify([{ address: "0x123" }]);
      localStore["ACCOUNTS"] = { ALL_ACCOUNTS: ["0x123"] };
      sessionStore["_LM_CACHED_KEYS"] = MOCK_KEYS;

      const { isLocked } = await LockManager.isLocked();
      expect(isLocked).toBe(false);

      await LockManager.lock();
    });

    it("should NOT restore from session when no keystores exist", async () => {
      // No keystores → clearAllData path → hasPasswordSet = false
      sessionStore["_LM_CACHED_KEYS"] = MOCK_KEYS;

      const { isLocked, hasPasswordSet } = await LockManager.isLocked();
      expect(isLocked).toBe(true);
      expect(hasPasswordSet).toBe(false);
    });
  });

  // ── setupAutoLockAlarm / clearAutoLockAlarm ────────────────────

  describe("setupAutoLockAlarm", () => {
    it("should create an alarm with the configured minutes", async () => {
      localStore["SETTINGS"] = { autoLockMinutes: 5 };

      await LockManager.setupAutoLockAlarm();

      expect(mockAlarms.create).toHaveBeenCalledWith(LockManager.AUTO_LOCK_ALARM, {
        delayInMinutes: 5,
      });
    });

    it("should use default of 15 minutes when not configured", async () => {
      await LockManager.setupAutoLockAlarm();

      expect(mockAlarms.create).toHaveBeenCalledWith(LockManager.AUTO_LOCK_ALARM, {
        delayInMinutes: 15,
      });
    });

    it("should clear alarm when autoLockMinutes is 0 (Never)", async () => {
      localStore["SETTINGS"] = { autoLockMinutes: 0 };

      await LockManager.setupAutoLockAlarm();

      expect(mockAlarms.create).not.toHaveBeenCalled();
      expect(mockAlarms.clear).toHaveBeenCalledWith(LockManager.AUTO_LOCK_ALARM);
    });
  });

  // ── handleAutoLockAlarm ────────────────────────────────────────

  describe("handleAutoLockAlarm", () => {
    it("should lock the wallet, save LOCKED timestamp, and clear session keys", async () => {
      localStore["KEYSTORES"] = JSON.stringify([{ address: "0x123" }]);
      localStore["ACCOUNTS"] = { ALL_ACCOUNTS: ["0x123"] };

      LockManager.setDecryptedKeysFromPopup(MOCK_KEYS);
      await LockManager.startKeepAlive();

      await LockManager.handleAutoLockAlarm();

      const { isLocked } = await LockManager.isLocked();
      expect(isLocked).toBe(true);
      expect(localStore["LOCK_MANAGER_LOCKED_TIMESTAMP"]).toBeDefined();
      // Session keys should be cleared so restore doesn't re-unlock
      expect(sessionStore["_LM_CACHED_KEYS"]).toBeUndefined();
    });
  });

  // ── lock() cleanup ─────────────────────────────────────────────

  describe("lock", () => {
    it("should clear keys, session backup, keep-alive alarm, and auto-lock alarm", async () => {
      LockManager.setDecryptedKeysFromPopup(MOCK_KEYS);
      await LockManager.startKeepAlive();
      alarmsStore[LockManager.AUTO_LOCK_ALARM] = { delayInMinutes: 5 };

      await LockManager.lock();

      localStore["KEYSTORES"] = JSON.stringify([{ address: "0x123" }]);
      localStore["ACCOUNTS"] = { ALL_ACCOUNTS: ["0x123"] };
      const { isLocked } = await LockManager.isLocked();
      expect(isLocked).toBe(true);

      expect(mockAlarms.clear).toHaveBeenCalledWith(LockManager.AUTO_LOCK_ALARM);
      expect(mockAlarms.clear).toHaveBeenCalledWith(LockManager.KEEP_ALIVE_ALARM);
      expect(sessionStore["_LM_CACHED_KEYS"]).toBeUndefined();
    });
  });

  // ── lockManagerListener ────────────────────────────────────────

  describe("lockManagerListener", () => {
    it("should start keep-alive and alarm on SET_DECRYPTED_KEYS", async () => {
      localStore["SETTINGS"] = { autoLockMinutes: 10 };

      const result = await LockManager.lockManagerListener({
        name: LOCK_MANAGER_MESSAGES.SET_DECRYPTED_KEYS,
        data: MOCK_KEYS,
      });

      expect(result).toEqual({ success: true });

      // Keep-alive alarm created
      expect(mockAlarms.create).toHaveBeenCalledWith(
        LockManager.KEEP_ALIVE_ALARM,
        expect.any(Object),
      );
      // Auto-lock alarm created
      expect(mockAlarms.create).toHaveBeenCalledWith(LockManager.AUTO_LOCK_ALARM, {
        delayInMinutes: 10,
      });
      // Keys backed up to session
      expect(sessionStore["_LM_CACHED_KEYS"]).toEqual(MOCK_KEYS);

      await LockManager.lock();
    });

    it("should handle UPDATE_AUTO_LOCK by recreating alarm", async () => {
      localStore["SETTINGS"] = { autoLockMinutes: 30 };

      const result = await LockManager.lockManagerListener({
        name: LOCK_MANAGER_MESSAGES.UPDATE_AUTO_LOCK,
        data: undefined,
      });

      expect(result).toEqual({ success: true });
      expect(mockAlarms.create).toHaveBeenCalledWith(LockManager.AUTO_LOCK_ALARM, {
        delayInMinutes: 30,
      });
    });

    it("should reset auto-lock timer on a user-driven message while unlocked", async () => {
      localStore["SETTINGS"] = { autoLockMinutes: 5 };
      localStore["KEYSTORES"] = JSON.stringify([{ address: "0x123" }]);
      localStore["ACCOUNTS"] = { ALL_ACCOUNTS: ["0x123"] };

      await LockManager.setDecryptedKeysFromPopup(MOCK_KEYS);
      mockAlarms.create.mockClear();

      await LockManager.lockManagerListener({
        name: LOCK_MANAGER_MESSAGES.GET_DECRYPTED_KEYS,
        data: undefined,
      });

      expect(mockAlarms.create).toHaveBeenCalledWith(LockManager.AUTO_LOCK_ALARM, {
        delayInMinutes: 5,
      });

      await LockManager.lock();
    });

    it("should NOT reset auto-lock timer on the machine-generated IS_LOCKED query", async () => {
      // CIPH-QRLW326-3. The service worker's own keep-alive writes session
      // storage every ~24 s; every open extension page answers that storage event
      // with IS_LOCKED. Counting those as user activity re-armed the alarm
      // forever, so the configured auto-lock never fired in side-panel or tab
      // mode. This test previously asserted the opposite.
      localStore["SETTINGS"] = { autoLockMinutes: 5 };
      localStore["KEYSTORES"] = JSON.stringify([{ address: "0x123" }]);
      localStore["ACCOUNTS"] = { ALL_ACCOUNTS: ["0x123"] };

      await LockManager.setDecryptedKeysFromPopup(MOCK_KEYS);
      mockAlarms.create.mockClear();

      await LockManager.lockManagerListener({
        name: LOCK_MANAGER_MESSAGES.IS_LOCKED,
        data: undefined,
      });

      expect(mockAlarms.create).not.toHaveBeenCalledWith(
        LockManager.AUTO_LOCK_ALARM,
        expect.anything(),
      );

      await LockManager.lock();
    });

    it("should NOT reset auto-lock timer when wallet is locked", async () => {
      localStore["SETTINGS"] = { autoLockMinutes: 5 };

      mockAlarms.create.mockClear();

      await LockManager.lockManagerListener({
        name: LOCK_MANAGER_MESSAGES.IS_LOCKED,
        data: undefined,
      });

      expect(mockAlarms.create).not.toHaveBeenCalled();
    });

    it("should lock wallet on LOCK message", async () => {
      localStore["KEYSTORES"] = JSON.stringify([{ address: "0x123" }]);
      localStore["ACCOUNTS"] = { ALL_ACCOUNTS: ["0x123"] };
      LockManager.setDecryptedKeysFromPopup(MOCK_KEYS);

      await LockManager.lockManagerListener({
        name: LOCK_MANAGER_MESSAGES.LOCK,
        data: undefined,
      });

      const { isLocked } = await LockManager.isLocked();
      expect(isLocked).toBe(true);
      // Session keys cleared — no restore after intentional lock
      expect(sessionStore["_LM_CACHED_KEYS"]).toBeUndefined();
    });
  });

  // ── Constants ──────────────────────────────────────────────────

  describe("AUTO_LOCK_ALARM", () => {
    it("should be publicly accessible", () => {
      expect(LockManager.AUTO_LOCK_ALARM).toBe("QRL_AUTO_LOCK");
    });
  });

  describe("KEEP_ALIVE_ALARM", () => {
    it("should be publicly accessible", () => {
      expect(LockManager.KEEP_ALIVE_ALARM).toBe("QRL_KEEP_ALIVE");
    });
  });

  describe("LOCK_MANAGER_MESSAGES", () => {
    it("should include UPDATE_AUTO_LOCK", () => {
      expect(LOCK_MANAGER_MESSAGES.UPDATE_AUTO_LOCK).toBe(
        "LOCK_MANAGER_UPDATE_AUTO_LOCK",
      );
    });
  });
});
