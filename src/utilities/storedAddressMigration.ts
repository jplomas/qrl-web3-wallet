/**
 * Remaps every stored reference to an account address after that account's
 * canonical address changes — specifically across the 20-byte → 64-byte QRL
 * address change, where `keystoreAddressMigration` recovers each account's new
 * address and this module repoints the data keyed by the old one.
 *
 * WHY A GENERIC WALK RATHER THAN PER-DATASET CODE
 * -----------------------------------------------
 * Account addresses are used as object keys, as array members, and as record
 * fields across at least eleven stored datasets: the account list and active
 * account, account labels, hidden-account flags, contacts, transaction history
 * (both the per-account key and the `from`/`to` inside each entry), per-account
 * token and NFT-collection lists, per-origin dApp grants, Ledger accounts, and
 * the pending transaction values. Enumerating them by hand means a dataset added
 * later is silently missed, and a missed dataset is invisible data loss.
 *
 * A rename is naturally a whole-store operation, so this walks the stored tree
 * and rewrites any string that *exactly* equals a known old address, whether it
 * appears as a key or as a value. Exact full-string matching (case-insensitive,
 * since addresses are stored both checksummed and lower-cased) is what keeps it
 * safe: it cannot corrupt keystore ciphertext, hashes, or unrelated values,
 * because none of those equal a whole 41-character `Q`-prefixed address.
 */

import browser from "webextension-polyfill";

export type StoredAddressRemap = {
  /** The address as previously stored. */
  from: string;
  /** The canonical address to repoint it to. */
  to: string;
};

/** Storage areas that must never be rewritten. */
const PROTECTED_TOP_LEVEL_KEYS = new Set([
  // Keystore labels are migrated by keystoreAddressMigration, which owns the
  // relationship between a keystore's label and its ciphertext.
  "KEYSTORES",
]);

const buildLookup = (remaps: StoredAddressRemap[]): Map<string, string> => {
  const lookup = new Map<string, string>();
  for (const { from, to } of remaps) {
    if (typeof from === "string" && typeof to === "string" && from && to) {
      lookup.set(from.toLowerCase(), to);
    }
  }
  return lookup;
};

/**
 * Returns the remapped value, plus whether anything changed, without mutating
 * the input.
 */
const remapValue = (
  value: unknown,
  lookup: Map<string, string>,
): { value: unknown; changed: boolean } => {
  if (typeof value === "string") {
    const replacement = lookup.get(value.toLowerCase());
    return replacement !== undefined
      ? { value: replacement, changed: true }
      : { value, changed: false };
  }

  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const result = remapValue(item, lookup);
      if (result.changed) changed = true;
      return result.value;
    });
    return changed ? { value: next, changed } : { value, changed: false };
  }

  if (value !== null && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      const remappedKey = lookup.get(key.toLowerCase());
      const nextKey = remappedKey ?? key;
      if (remappedKey !== undefined) changed = true;

      const result = remapValue(child, lookup);
      if (result.changed) changed = true;

      // If two old addresses somehow collapse onto one new key, merge rather
      // than silently dropping the first — objects win over primitives.
      if (
        nextKey in next &&
        next[nextKey] !== null &&
        typeof next[nextKey] === "object" &&
        result.value !== null &&
        typeof result.value === "object" &&
        !Array.isArray(next[nextKey]) &&
        !Array.isArray(result.value)
      ) {
        next[nextKey] = {
          ...(next[nextKey] as Record<string, unknown>),
          ...(result.value as Record<string, unknown>),
        };
      } else {
        next[nextKey] = result.value;
      }
    }
    return changed ? { value: next, changed } : { value, changed: false };
  }

  return { value, changed: false };
};

/**
 * Rewrite every stored reference to the given old addresses.
 *
 * Idempotent: once migrated, no stored string matches an old address any more,
 * so a repeat run writes nothing. Returns the top-level storage keys that were
 * rewritten, which is useful for logging and for asserting in tests.
 */
export const migrateStoredAddresses = async (
  remaps: StoredAddressRemap[],
): Promise<string[]> => {
  const lookup = buildLookup(remaps);
  if (!lookup.size) return [];

  const everything = (await browser.storage.local.get(null)) as Record<
    string,
    unknown
  >;
  const updates: Record<string, unknown> = {};

  for (const [topLevelKey, value] of Object.entries(everything)) {
    if (PROTECTED_TOP_LEVEL_KEYS.has(topLevelKey)) continue;
    const result = remapValue(value, lookup);
    if (result.changed) updates[topLevelKey] = result.value;
  }

  const changedKeys = Object.keys(updates);
  if (changedKeys.length) {
    await browser.storage.local.set(updates);
  }
  return changedKeys;
};
