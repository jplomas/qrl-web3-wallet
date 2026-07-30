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
import {
  isLegacyKeystoreLabel,
  recoverKeystoreAddress,
  relabelKeystore,
  type KeystoreAddressMigration,
} from "@/scripts/lockManager/keystoreAddressMigration";
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
      // KDF parameters, or had a stale pre-64-byte address label rewritten. The
      // popup-side persists these in place of the old keystores so the user does
      // not need to take any explicit action.
      upgradedKeystores?: KeyStore[];
      // Old -> new address pairs for every keystore whose label was migrated, so
      // the popup-side can remap the datasets keyed by those addresses.
      addressMigrations?: KeystoreAddressMigration[];
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
    const addressMigrations: KeystoreAddressMigration[] = [];
    for (const keyStore of keystores) {
      // A keystore written before the 64-byte address change carries a stale
      // 41-character label that the current `decrypt()` rejects outright. Repair
      // the label first, otherwise the whole vault fails and the user is told
      // their password is wrong.
      let effectiveKeyStore = keyStore;
      if (isLegacyKeystoreLabel(keyStore)) {
        const recovered = await recoverKeystoreAddress(
          keyStore,
          normalisedPassword,
        );
        if (recovered) {
          effectiveKeyStore = relabelKeystore(keyStore, recovered.address);
          addressMigrations.push({
            from: String(keyStore.address),
            to: recovered.address,
          });
          if (!upgradedKeystores) upgradedKeystores = [...keystores];
          const migratedIdx = upgradedKeystores.findIndex(
            (k) => k.address === keyStore.address,
          );
          if (migratedIdx >= 0) {
            upgradedKeystores[migratedIdx] = effectiveKeyStore;
          }
        }
      }
      const { address, seed } = await decrypt(
        effectiveKeyStore,
        normalisedPassword,
      );
      keys.push({
        address,
        seed,
        mnemonicPhrases: getMnemonicFromHexSeed(seed),
      });
      if (shouldUpgradeKeystoreParams(effectiveKeyStore)) {
        if (!upgradedKeystores) {
          upgradedKeystores = [...keystores];
        }
        const reEncrypted = await encrypt(seed, normalisedPassword);
        const idx = upgradedKeystores.findIndex(
          (k) =>
            k.address?.toLowerCase() === effectiveKeyStore.address?.toLowerCase(),
        );
        if (idx >= 0) upgradedKeystores[idx] = reEncrypted;
      }
    }
    // Reference the constant so tree-shaking does not drop the import.
    void RECOMMENDED_KEYSTORE_KDF_PARAMS;
    self.postMessage({
      success: true,
      keys,
      upgradedKeystores,
      addressMigrations: addressMigrations.length ? addressMigrations : undefined,
    } satisfies UnlockWorkerResponse);
  } catch {
    // decrypt() throws when the password is wrong
    self.postMessage({ success: false } satisfies UnlockWorkerResponse);
  }
};
