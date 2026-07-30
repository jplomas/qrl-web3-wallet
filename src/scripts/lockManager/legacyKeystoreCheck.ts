/**
 * Detects keystores written before the 64-byte address change, so unlock can
 * fail with an accurate message instead of a misleading one.
 *
 * WHY DETECT RATHER THAN MIGRATE
 * ------------------------------
 * A keystore whose label is a pre-64-byte address is rejected by the current
 * `decrypt()`, which compares the address derived from the recovered seed
 * against the label. That surfaces as a failed unlock, and the unlock UI
 * reports a failed unlock as `lock.unlock.errorIncorrect` — "the entered
 * password is incorrect". The password is not incorrect. Left unhandled, a user
 * retypes a correct password until they conclude the wallet has lost their
 * accounts.
 *
 * An earlier revision recovered the canonical address and rewrote the label and
 * every stored reference to it. That was dropped deliberately: this is
 * pre-release software targeting a testnet that is not yet public, the data it
 * preserved (contacts, imported tokens, transaction history, dApp grants) has
 * no value, and the seed itself is always recoverable from the mnemonic the
 * wallet requires the user to keep. What the migration cost was an extra
 * Argon2id pass per keystore on the unlock path and a recursive rewrite of the
 * whole `chrome.storage.local` tree — a wide blast radius, exercised only
 * against synthetic keystores, guarding nothing of value.
 *
 * So the wallet detects the stale label with a regex, refuses to unlock, and
 * tells the user to re-import from the recovery phrase. If a format change ever
 * lands after launch, a real migration is required and the deleted modules are
 * the pattern to bring back.
 */

import AddressUtil from "@/utilities/addressUtil";

/** Distinguishes this from a wrong-password failure at the UI layer. */
export const LEGACY_KEYSTORE_FORMAT = "LEGACY_KEYSTORE_FORMAT";

/**
 * Thrown by `assertNoLegacyKeystores`. Carries the affected labels so the
 * caller can name the accounts the user needs to re-import.
 */
export class LegacyKeystoreFormatError extends Error {
  readonly code = LEGACY_KEYSTORE_FORMAT;
  readonly addresses: readonly string[];

  constructor(addresses: string[]) {
    super(
      `Keystore${addresses.length === 1 ? "" : "s"} written before the ` +
        `64-byte address format: ${addresses.join(", ")}`,
    );
    this.name = "LegacyKeystoreFormatError";
    this.addresses = Object.freeze([...addresses]);
  }
}

/**
 * True for a `LegacyKeystoreFormatError`, including one that has crossed a
 * message boundary and lost its prototype — the `code` field survives
 * structured cloning where `instanceof` does not.
 */
export const isLegacyKeystoreFormatError = (error: unknown): boolean =>
  error instanceof LegacyKeystoreFormatError ||
  (typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === LEGACY_KEYSTORE_FORMAT);

/**
 * Returns the labels of any keystores carrying a pre-64-byte address. Reads the
 * label only — it never touches the ciphertext and never needs the password, so
 * it is safe to call before any decryption work begins.
 */
export const findLegacyKeystoreLabels = (keyStores: unknown[]): string[] => {
  const legacy: string[] = [];
  for (const keyStore of keyStores) {
    const label = (keyStore as { address?: unknown } | null)?.address;
    if (typeof label === "string" && AddressUtil.isLegacyQrlAddress(label)) {
      legacy.push(label);
    }
  }
  return legacy;
};

/**
 * Throws `LegacyKeystoreFormatError` if any keystore predates the 64-byte
 * address format. Call before decrypting: the point is to fail with an accurate
 * message, and to fail before spending Argon2id time on a vault that cannot
 * open.
 */
export const assertNoLegacyKeystores = (keyStores: unknown[]): void => {
  const legacy = findLegacyKeystoreLabels(keyStores);
  if (legacy.length) throw new LegacyKeystoreFormatError(legacy);
};
