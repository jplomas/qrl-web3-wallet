import StorageUtil, { LockState } from "@/utilities/storageUtil";
import { Bytes, KeyStore } from "@theqrl/web3";
import { decrypt, encrypt } from "@theqrl/web3-qrl-accounts";
import { getMnemonicFromHexSeed } from "@/functions/getMnemonicFromHexSeed";
import {
  isLegacyKeystoreLabel,
  recoverKeystoreAddress,
  relabelKeystore,
} from "@/scripts/lockManager/keystoreAddressMigration";
import {
  migrateStoredAddresses,
  type StoredAddressRemap,
} from "@/utilities/storedAddressMigration";
import browser from "webextension-polyfill";

type MessageType = {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
};

export type EncryptAccountType = {
  seed: Bytes;
  password: string;
};

export type DecryptedKeyType = {
  address: string;
  seed: string;
  mnemonicPhrases: string;
};

// SET_DECRYPTED_KEYS payload: keys are stored alongside the wallet password
// so the SW can re-encrypt new accounts during the unlock session, but the
// password is held in a separate field (not interleaved with each key) and
// is excluded from the session-storage backup.
export type SetDecryptedKeysPayload = {
  keys: DecryptedKeyType[];
  walletPassword: string;
};

/**
 * Messages that are emitted by the extension itself rather than by a user
 * action, and so must not be treated as activity for auto-lock purposes.
 */
const MACHINE_GENERATED_MESSAGES: ReadonlySet<string> = new Set([
  "LOCK_MANAGER_IS_LOCKED",
]);

export const LOCK_MANAGER_MESSAGES = {
  PORT: "LOCK_MANGER_PORT",
  IS_LOCK_MANAGER_READY: "IS_LOCK_MANAGER_READY",
  IS_LOCKED: "LOCK_MANAGER_IS_LOCKED",
  ENCRYPT_ACCOUNT: "ENCRYPT_ACCOUNT",
  LOCK: "LOCK_MANAGER_LOCK",
  UNLOCK: "LOCK_MANAGER_UNLOCK",
  LOCK_MANAGER_KEEP_LIVE: "LOCK_MANAGER_KEEP_LIVE",
  GET_DECRYPTED_KEYS: "GET_DECRYPTED_KEYS",
  GET_WALLET_PASSWORD: "GET_WALLET_PASSWORD",
  SET_DECRYPTED_KEYS: "SET_DECRYPTED_KEYS",
  UPDATE_AUTO_LOCK: "LOCK_MANAGER_UPDATE_AUTO_LOCK",
  SEND_TX_NOTIFICATION: "SEND_TX_NOTIFICATION",
} as const;

/**
 * The lock manager, which is part of the extension service worker handles lock related data and functions.
 *
 * IMPORTANT: CPU-heavy cryptographic operations (decrypt / encrypt via scrypt)
 * are performed in the popup, NOT in the service worker.  The popup sends the
 * resulting keys to the SW via the SET_DECRYPTED_KEYS message so that the SW
 * only stores them in memory.  This avoids Chrome killing the SW mid-decrypt.
 */
class LockManager {
  private static decryptedKeys?: DecryptedKeyType[];
  // Held in memory only — never written to session storage. Separating the
  // password from `decryptedKeys` reduces blast radius if either store leaks.
  private static walletPassword?: string;
  static readonly AUTO_LOCK_ALARM = "QRL_AUTO_LOCK";
  static readonly KEEP_ALIVE_ALARM = "QRL_KEEP_ALIVE";
  private static readonly SESSION_KEYS_KEY = "_LM_CACHED_KEYS";

  static async lock() {
    this.clearDecryptedKeys();
    this.walletPassword = undefined;
    try {
      await this.clearSessionKeys();
    } finally {
      // The alarms must be cleared even if removing the session backup fails.
      // Previously a rejection here left the keep-alive running, and its next
      // tick restored the keys from the backup that was never removed — the
      // wallet silently unlocked itself. See CIPH-QRLW326-16.
      await this.stopKeepAlive();
      await this.clearAutoLockAlarm();
    }
  }

  static async startKeepAlive() {
    await browser.alarms.create(this.KEEP_ALIVE_ALARM, {
      periodInMinutes: 0.4, // ~24 seconds — under Chrome's 30s kill threshold
    });
  }

  static async stopKeepAlive() {
    await browser.alarms.clear(this.KEEP_ALIVE_ALARM);
  }

  /**
   * Called when the keep-alive alarm fires.
   * Writes to session storage to reset Chrome's inactivity timer.
   * Also restores keys from session backup if SW was restarted.
   */
  static async handleKeepAliveAlarm() {
    // Restore keys from session backup if SW restarted (lost in-memory keys)
    if (this.decryptedKeys === undefined) {
      await this.restoreKeysFromSession();
    }
    // Write to session storage to keep the SW alive
    await browser.storage.session.set({ keepAlive: Date.now() });
  }

  static async setupAutoLockAlarm() {
    const settings = await StorageUtil.getSettings();
    const minutes = settings.autoLockMinutes ?? 15;
    if (minutes > 0) {
      await browser.alarms.create(this.AUTO_LOCK_ALARM, {
        delayInMinutes: minutes,
      });
    } else {
      await this.clearAutoLockAlarm();
    }
  }

  static async clearAutoLockAlarm() {
    await browser.alarms.clear(this.AUTO_LOCK_ALARM);
  }

  static async handleAutoLockAlarm() {
    // Record the LOCKED transition *before* clearing state. `lock()`'s first
    // storage write raises `storage.onChanged` in any open extension page, whose
    // recovery path decides "intentional lock vs service-worker restart" by
    // comparing these timestamps. Writing the marker afterwards meant the page
    // read a stale value, concluded the worker had restarted, and re-sent the
    // keys and password — undoing the auto-lock. See CIPH-QRLW326-17.
    await StorageUtil.updateLockStateTimeStamp(LockState.LOCKED);
    await this.lock();
  }

  /**
   * Backup decrypted keys to session storage.
   * Session storage survives SW restarts but clears on browser close.
   */
  private static async backupKeysToSession() {
    if (this.decryptedKeys) {
      await browser.storage.session.set({
        [this.SESSION_KEYS_KEY]: this.decryptedKeys,
      });
    }
  }

  private static async clearSessionKeys() {
    await browser.storage.session.remove(this.SESSION_KEYS_KEY);
  }

  /**
   * Restore keys from session storage after SW restart.
   * Returns true if keys were restored.
   */
  static async restoreKeysFromSession(): Promise<boolean> {
    try {
      // A backup only authorises a restore if the last recorded transition was an
      // unlock. Without this check any stale backup — one left behind by a lock
      // whose session clear was interrupted — silently unlocked the wallet with
      // no password, on the next IS_LOCKED query or keep-alive tick. The popup's
      // equivalent recovery path has always applied this test; the service worker
      // did not. See CIPH-QRLW326-16.
      const [lockedAt, unlockedAt] = await Promise.all([
        StorageUtil.getLockStateTimeStamp(LockState.LOCKED),
        StorageUtil.getLockStateTimeStamp(LockState.UNLOCKED),
      ]);
      if (lockedAt > unlockedAt) {
        // The wallet was deliberately locked. Discard the backup rather than
        // leaving it to authorise a later restore.
        await this.clearSessionKeys();
        return false;
      }

      const data = await browser.storage.session.get(this.SESSION_KEYS_KEY);
      const keys = data?.[this.SESSION_KEYS_KEY] as
        | DecryptedKeyType[]
        | undefined;
      if (keys?.length) {
        this.decryptedKeys = keys;
        return true;
      }
    } catch {
      // Session storage read failed — accept locked state
    }
    return false;
  }

  /**
   * Decrypt all keystores with the given password.
   * Called via a dedicated port connection so there is no message-channel
   * timeout — the port stays open as long as needed.
   * Returns true on success, false on wrong password or empty keystores.
   */
  static async unlock(password: string): Promise<boolean> {
    try {
      // Normalise to NFC so the same visual password yields the same bytes
      // regardless of the platform / IME the user typed it on.
      const normalisedPassword = password.normalize("NFC");
      const keyStores = await StorageUtil.getKeystores();
      if (!keyStores.length) return false;
      const decryptedKeys: DecryptedKeyType[] = [];
      let migratedKeystores: KeyStore[] | undefined;
      const addressRemaps: StoredAddressRemap[] = [];
      for (const keyStore of keyStores) {
        // Yield the event loop between decryptions so Chrome
        // doesn't consider the service worker unresponsive.
        await new Promise((r) => setTimeout(r, 0));
        // Repair a stale pre-64-byte address label before decrypting; the
        // current library rejects the keystore outright otherwise. See
        // keystoreAddressMigration.ts.
        let effectiveKeyStore = keyStore;
        if (isLegacyKeystoreLabel(keyStore)) {
          const recovered = await recoverKeystoreAddress(
            keyStore,
            normalisedPassword,
          );
          if (recovered) {
            effectiveKeyStore = relabelKeystore(keyStore, recovered.address);
            addressRemaps.push({
              from: String(keyStore.address),
              to: recovered.address,
            });
            if (!migratedKeystores) migratedKeystores = [...keyStores];
            const idx = migratedKeystores.findIndex(
              (k) => k.address === keyStore.address,
            );
            if (idx >= 0) migratedKeystores[idx] = effectiveKeyStore;
          }
        }
        const { address, seed } = await decrypt(
          effectiveKeyStore,
          normalisedPassword,
        );
        decryptedKeys.push({
          address,
          seed,
          mnemonicPhrases: getMnemonicFromHexSeed(seed),
        });
      }
      if (migratedKeystores) {
        try {
          // Order matters: repoint the data that references the old addresses
          // before the keystores stop advertising them, so an interrupted
          // migration leaves the labels stale and retryable rather than leaving
          // orphaned data behind a completed relabel.
          await migrateStoredAddresses(addressRemaps);
          await StorageUtil.setKeystores(migratedKeystores);
        } catch (error) {
          // Non-fatal: the unlock itself succeeded. Both steps are idempotent and
          // will be retried on the next unlock.
          console.warn(
            "QrlWeb3Wallet: failed to complete stored address migration",
            error,
          );
        }
      }
      this.walletPassword = normalisedPassword;
      await this.setDecryptedKeys(
        Array.from(
          new Map(
            decryptedKeys.map((item) => [item.address.toLowerCase(), item]),
          ).values(),
        ),
      );
      return true;
    } catch {
      this.clearDecryptedKeys();
      this.walletPassword = undefined;
      return false;
    }
  }

  static async isLocked() {
    const keyStores = await StorageUtil.getKeystores();
    const accounts = await StorageUtil.getAllAccounts();
    const hasPasswordSet = keyStores.length > 0 && accounts.length > 0;
    if (!hasPasswordSet) {
      // Storage looks like a first-run / partial-reset state. Drop any
      // in-memory keys but do NOT wipe persistent storage from a query
      // path — the popup's onboarding flow will guide the user. An
      // explicit factory-reset action lives in settings for intentional
      // wipes.
      this.clearDecryptedKeys();
      this.walletPassword = undefined;
    }
    // If SW restarted (lost in-memory keys), try restoring from session backup.
    if (this.decryptedKeys === undefined && hasPasswordSet) {
      await this.restoreKeysFromSession();
    }
    return {
      isLocked: this.decryptedKeys === undefined,
      hasPasswordSet,
    };
  }

  /**
   * Accept pre-decrypted keys from the popup.
   * The popup performs the CPU-heavy decrypt, then sends the results here.
   * Accepts either the new {keys, walletPassword} payload or a bare keys
   * array (the latter for SW-restart re-sends, where the popup may have
   * lost the password but still has cached keys).
   */
  static async setDecryptedKeysFromPopup(
    payload: SetDecryptedKeysPayload | DecryptedKeyType[],
  ) {
    const keys = Array.isArray(payload) ? payload : payload.keys;
    if (!Array.isArray(payload) && payload.walletPassword) {
      this.walletPassword = payload.walletPassword;
    }
    await this.setDecryptedKeys(
      Array.from(
        new Map(
          keys.map((item) => [item.address.toLowerCase(), item]),
        ).values(),
      ),
    );
  }

  static async encryptAccount(accountData: EncryptAccountType) {
    const { password: rawPassword, seed } = accountData;
    const password = rawPassword.normalize("NFC");
    const keystores = await StorageUtil.getKeystores();
    const encryptedKeyStore = await encrypt(seed, password);
    const updatedKeyStores = [...keystores, encryptedKeyStore];
    await StorageUtil.setKeystores(
      Array.from(
        new Map(
          updatedKeyStores.map((item) => [item.address.toLowerCase(), item]),
        ).values(),
      ),
    );
    // Add the new account key directly to in-memory keys
    // instead of re-decrypting everything (which would block the SW).
    const newKey: DecryptedKeyType = {
      address: encryptedKeyStore.address,
      seed: seed as string,
      mnemonicPhrases: getMnemonicFromHexSeed(seed as string),
    };
    this.walletPassword = password;
    const existingKeys = this.decryptedKeys ?? [];
    await this.setDecryptedKeys(
      Array.from(
        new Map(
          [...existingKeys, newKey].map((item) => [
            item.address.toLowerCase(),
            item,
          ]),
        ).values(),
      ),
    );
  }

  private static async setDecryptedKeys(decryptedKeys: DecryptedKeyType[]) {
    this.decryptedKeys = decryptedKeys;
    // Awaited: as a floating promise, a `lock()` interleaving between the write
    // being issued and completing left the decrypted seeds in session storage
    // after the manager had reported itself locked. See CIPH-QRLW326-16.
    try {
      await this.backupKeysToSession();
    } catch (error) {
      console.warn(
        "QrlWeb3Wallet: failed to back up decrypted keys to session storage",
        error,
      );
    }
  }

  static getWalletPassword() {
    // Force the locked-state error if keys are gone.
    this.getDecryptedKeys();
    return this.walletPassword ?? "";
  }

  static getDecryptedKeys() {
    if (!this.decryptedKeys) {
      this.clearDecryptedKeys();
      throw new Error("QRL Web3 Wallet is locked");
    }
    return this.decryptedKeys;
  }

  private static clearDecryptedKeys() {
    this.decryptedKeys = undefined;
  }

  static async lockManagerListener(
    message: MessageType,
    sender?: browser.Runtime.MessageSender,
  ) {
    // Reject any same-extension caller that is not an extension page (popup,
    // options, side panel). Content scripts are part of the same extension
    // but run with `sender.url === <page-url>`; the only legitimate callers
    // for these messages are extension pages, whose `sender.url` starts with
    // the extension's own origin. Defence in depth: today no content script
    // sends LOCK_MANAGER messages, but a future code-path that forwards
    // arbitrary messages should not be able to read decrypted keys.
    if (sender !== undefined) {
      const extensionUrlPrefix = browser.runtime.getURL("");
      if (
        typeof sender.url === "string" &&
        !sender.url.startsWith(extensionUrlPrefix)
      ) {
        return undefined;
      }
    }
    let result;
    if (message.name === LOCK_MANAGER_MESSAGES.IS_LOCKED) {
      result = await LockManager.isLocked();
    } else if (message.name === LOCK_MANAGER_MESSAGES.SET_DECRYPTED_KEYS) {
      // The popup decrypted the keystores locally and is sending us the results.
      await LockManager.setDecryptedKeysFromPopup(message?.data ?? []);
      await LockManager.startKeepAlive();
      await LockManager.setupAutoLockAlarm();
      result = { success: true };
    } else if (message.name === LOCK_MANAGER_MESSAGES.LOCK) {
      result = await LockManager.lock();
    } else if (message.name === LOCK_MANAGER_MESSAGES.UPDATE_AUTO_LOCK) {
      await LockManager.setupAutoLockAlarm();
      result = { success: true };
    } else if (message.name === LOCK_MANAGER_MESSAGES.GET_DECRYPTED_KEYS) {
      result = LockManager.getDecryptedKeys();
    } else if (message.name === LOCK_MANAGER_MESSAGES.GET_WALLET_PASSWORD) {
      result = LockManager.getWalletPassword();
    } else if (message.name === LOCK_MANAGER_MESSAGES.ENCRYPT_ACCOUNT) {
      result = await LockManager.encryptAccount(message?.data ?? {});
    }

    // User activity while unlocked resets the auto-lock timer.
    //
    // "Activity" must mean *user* activity. IS_LOCKED is machine-generated: the
    // service worker's own keep-alive writes session storage every ~24 s, every
    // open extension page answers that storage event with an IS_LOCKED query, and
    // treating those as activity re-armed the alarm forever — so the configured
    // auto-lock never fired in side-panel or tab mode. See CIPH-QRLW326-3.
    if (
      LockManager.decryptedKeys !== undefined &&
      !MACHINE_GENERATED_MESSAGES.has(message.name)
    ) {
      await LockManager.setupAutoLockAlarm();
    }

    return result;
  }
}

export default LockManager;
