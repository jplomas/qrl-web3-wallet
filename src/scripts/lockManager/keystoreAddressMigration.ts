/**
 * One-time migration of keystore address labels across the 20-byte → 64-byte
 * QRL address change.
 *
 * WHY THIS EXISTS
 * ---------------
 * A keystore written by the pre-64-byte `@theqrl/web3-qrl-accounts` line records
 * a 20-byte (41-character) address in its unauthenticated `address` label. The
 * current library derives a 64-byte (129-character) address from the same seed
 * and, for parity with go-qrl's `keystore.GetKey`, throws `KeyStoreMismatchError`
 * when the derived address does not match that label.
 *
 * The consequence for an existing installation is total: every keystore fails to
 * decrypt, `LockManager.unlock()` treats one failure as a whole-vault failure,
 * and the worker reports only `{success: false}` — so the user is told their
 * password is wrong and can never get in. The seeds are intact; only the label
 * is stale.
 *
 * WHAT THIS DOES
 * --------------
 * For a keystore whose label is in the legacy format, recover the seed using the
 * same three steps `decrypt()` performs, minus the label comparison, then derive
 * the canonical address and rewrite the label. `decrypt()` succeeds from then on.
 *
 * WHY IT REPLICATES LIBRARY INTERNALS
 * -----------------------------------
 * `decrypt()` is all-or-nothing: the label check happens after the seed has been
 * successfully recovered, and `KeyStoreMismatchError` carries the derived address
 * only inside its message string. Rather than parse an error message, this module
 * composes the same public primitives the library itself uses
 * (`argon2idSync` + AES-256-GCM from `@theqrl/qrl-cryptography`, then
 * `seedToAccount`). It is deliberately narrow: it runs only for legacy-format
 * labels, requires the argon2id KDF, and validates the recovered address before
 * returning, so a keystore it cannot confidently migrate is left untouched for
 * `decrypt()` to reject normally.
 */

import { decrypt as aesDecrypt } from "@theqrl/qrl-cryptography/aes.js";
import { argon2idSync } from "@theqrl/qrl-cryptography/argon2id.js";
import { seedToAccount } from "@theqrl/web3-qrl-accounts";
import { hexToBytes, utf8ToHex } from "@theqrl/web3-utils";
import type { KeyStore } from "@theqrl/web3";
import {
  QRL_ADDRESS_LENGTH,
  QRL_ADDRESS_PREFIX,
} from "@/constants/address";
import AddressUtil from "@/utilities/addressUtil";

/** A canonical label: `Q` + 128 hex characters (64 bytes). */
const CURRENT_KEYSTORE_LABEL_REGEX = /^Q[0-9a-fA-F]{128}$/;

export type KeystoreAddressMigration = {
  /** The stale label as it was stored, e.g. `Q20b714…`. */
  from: string;
  /** The canonical address derived from the seed, e.g. `Q000…8a8e…000`. */
  to: string;
};

/**
 * True when this keystore's `address` label predates the 64-byte address change
 * and therefore cannot be decrypted by the current library.
 */
export const isLegacyKeystoreLabel = (keyStore: unknown): boolean => {
  const label = (keyStore as KeyStore | undefined)?.address;
  return (
    typeof label === "string" && AddressUtil.isLegacyQrlAddress(label)
  );
};

type Argon2idKdfParams = {
  salt?: string | Uint8Array;
  t?: number;
  m?: number;
  p?: number;
  dklen?: number;
};

const asBytes = (value: string | Uint8Array): Uint8Array =>
  typeof value === "string" ? hexToBytes(value) : value;

/**
 * Recover the canonical address (and seed) from a keystore whose stored label is
 * stale, without going through `decrypt()`'s label comparison.
 *
 * Returns `undefined` — rather than throwing — whenever the keystore is not one
 * this migration should touch, so callers can fall through to the library's own
 * error handling. Throws only if the password is wrong or the ciphertext fails
 * its GCM tag check, which is the same failure the normal path would produce.
 */
export const recoverKeystoreAddress = async (
  keyStore: KeyStore,
  normalisedPassword: string,
): Promise<{ address: string; seed: string } | undefined> => {
  const crypto = keyStore?.crypto;
  if (!crypto || crypto.kdf !== "argon2id") return undefined;

  const kdfparams = crypto.kdfparams as Argon2idKdfParams | undefined;
  const { salt, t, m, p, dklen } = kdfparams ?? {};
  if (
    salt === undefined ||
    typeof t !== "number" ||
    typeof m !== "number" ||
    typeof p !== "number" ||
    typeof dklen !== "number"
  ) {
    return undefined;
  }
  const iv = crypto.cipherparams?.iv;
  if (!crypto.ciphertext || !iv) return undefined;

  // Same derivation the library performs, so a correct password yields the same
  // key and an incorrect one fails the GCM tag check exactly as it would there.
  const passwordBytes = hexToBytes(utf8ToHex(normalisedPassword));
  const derivedKey = argon2idSync(passwordBytes, asBytes(salt), t, m, p, dklen);
  const seedBytes = await aesDecrypt(
    hexToBytes(crypto.ciphertext),
    derivedKey,
    hexToBytes(iv),
  );

  const account = seedToAccount(seedBytes);
  const address = account?.address;
  // Only accept a result that is unambiguously a canonical address; anything
  // else means our assumptions about the keystore format no longer hold and the
  // keystore should be left for `decrypt()` to reject.
  if (
    typeof address !== "string" ||
    address.length !== QRL_ADDRESS_LENGTH ||
    !address.startsWith(QRL_ADDRESS_PREFIX) ||
    !CURRENT_KEYSTORE_LABEL_REGEX.test(address)
  ) {
    return undefined;
  }
  return { address, seed: String(account.seed) };
};

/** A copy of `keyStore` carrying the corrected `address` label. */
export const relabelKeystore = (
  keyStore: KeyStore,
  address: string,
): KeyStore => ({ ...keyStore, address });
