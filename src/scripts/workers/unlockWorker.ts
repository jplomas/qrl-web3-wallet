/**
 * Web Worker that performs the CPU-heavy keystore decryption (scrypt / argon2id).
 *
 * Running in a dedicated worker thread keeps the popup UI fully responsive
 * while the decryption is in progress AND avoids Chrome's MV3 service-worker
 * lifecycle issues (Chrome can't kill a worker that runs inside the popup).
 */

import { decrypt, encrypt } from "@theqrl/web3-qrl-accounts";
import { getMnemonicFromHexSeed } from "@/functions/getMnemonicFromHexSeed";
import {
  RECOMMENDED_KEYSTORE_KDF_PARAMS,
  shouldUpgradeKeystoreParams,
} from "@/scripts/lockManager/keystoreParams";
import type { KeyStore } from "@theqrl/web3";

export type UnlockWorkerRequest = {
  keystores: KeyStore[];
  password: string;
};

export type DecryptedKey = {
  address: string;
  seed: string;
  mnemonicPhrases: string;
};

export type UnlockWorkerResponse =
  | {
      success: true;
      keys: DecryptedKey[];
      // Populated when one or more keystores were re-encrypted with stronger
      // KDF parameters. The popup-side persists these in place of the old
      // keystores so the user does not need to take any explicit action.
      upgradedKeystores?: KeyStore[];
    }
  | { success: false };

self.onmessage = async (event: MessageEvent<UnlockWorkerRequest>) => {
  const { keystores, password } = event.data;
  // Normalise to NFC so the same visual password yields the same bytes
  // regardless of the platform / IME the user typed it on.
  const normalisedPassword = password.normalize("NFC");
  try {
    const keys: DecryptedKey[] = [];
    let upgradedKeystores: KeyStore[] | undefined;
    // Keystores predating the 64-byte address format are rejected before the
    // worker is ever started, by `assertNoLegacyKeystores` on the caller's side,
    // so that the failure can be reported as a format problem rather than a
    // wrong password. See legacyKeystoreCheck.ts.
    for (const keyStore of keystores) {
      const { address, seed } = await decrypt(keyStore, normalisedPassword);
      keys.push({
        address,
        seed,
        mnemonicPhrases: getMnemonicFromHexSeed(seed),
      });
      if (shouldUpgradeKeystoreParams(keyStore)) {
        // The KDF upgrade is opportunistic: the seed is already recovered and
        // the user's password was correct. A failure here must not reach the
        // outer catch, which reports `success: false` — surfaced to the user as
        // "the entered password is incorrect". Skip the upgrade and stay
        // unlocked; `shouldUpgradeKeystoreParams` will ask again next time.
        try {
          const reEncrypted = await encrypt(
            seed,
            normalisedPassword,
            RECOMMENDED_KEYSTORE_KDF_PARAMS,
          );
          // Match by position, not by address. Comparing `k.address?.toLowerCase()`
          // pairs `undefined === undefined`, so a keystore with no label matched
          // the first other unlabelled entry and overwrote it.
          const idx = keystores.indexOf(keyStore);
          if (idx >= 0) {
            if (!upgradedKeystores) upgradedKeystores = [...keystores];
            upgradedKeystores[idx] = reEncrypted;
          }
        } catch (error) {
          console.warn(
            "QrlWeb3Wallet: keystore KDF upgrade failed; keeping existing parameters",
            error,
          );
        }
      }
    }
    self.postMessage({
      success: true,
      keys,
      upgradedKeystores,
    } satisfies UnlockWorkerResponse);
  } catch {
    // decrypt() throws when the password is wrong
    self.postMessage({ success: false } satisfies UnlockWorkerResponse);
  }
};
