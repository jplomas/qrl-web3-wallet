// @vitest-environment node
//
// Real cryptography, no mocks: this file must prove that a genuinely
// pre-64-byte keystore is undecryptable and that the migration restores it.
// It runs in the node environment because jsdom supplies its own `Uint8Array`,
// which fails the `bytes` validation inside @theqrl/web3-utils.
import { QRL_ADDRESS_LENGTH } from "@/constants/address";
import { create, decrypt, encrypt } from "@theqrl/web3-qrl-accounts";
import type { KeyStore } from "@theqrl/web3";
import { beforeAll, describe, expect, it } from "vitest";
import {
  isLegacyKeystoreLabel,
  recoverKeystoreAddress,
  relabelKeystore,
} from "./keystoreAddressMigration";

const PASSWORD = "correct horse battery staple";
const LEGACY_LABEL = "Q20b714091cf2a62dadda2847803e3f1b9d2d3779";

// The library's own minimum (ARGON2ID_BOUNDS.m.min). Real parameters, but ~13x
// less memory and 4x fewer passes than the production default of m=262144/t=8,
// which keeps the suite fast without weakening what is being tested.
const CHEAP_BUT_VALID_KDF = { m: 19456, t: 2, p: 1, dklen: 32 } as const;

let canonicalAddress: string;
let seed: string;
/** A keystore shaped exactly as one written before the 64-byte change. */
let legacyKeyStore: KeyStore;

beforeAll(async () => {
  const account = create();
  seed = String(account.seed);
  const written = JSON.parse(
    JSON.stringify(await encrypt(account.seed, PASSWORD, CHEAP_BUT_VALID_KDF)),
  ) as KeyStore;
  canonicalAddress = String(written.address);
  legacyKeyStore = { ...written, address: LEGACY_LABEL };
}, 60_000);

const cloneLegacy = (): KeyStore => JSON.parse(JSON.stringify(legacyKeyStore));

describe("keystoreAddressMigration", () => {
  it("identifies pre-64-byte keystore labels and leaves current ones alone", () => {
    expect(isLegacyKeystoreLabel(legacyKeyStore)).toBe(true);
    expect(
      isLegacyKeystoreLabel(relabelKeystore(legacyKeyStore, canonicalAddress)),
    ).toBe(false);
    expect(isLegacyKeystoreLabel(undefined)).toBe(false);
    expect(isLegacyKeystoreLabel({})).toBe(false);
  });

  it("confirms the unmigrated keystore is undecryptable — the lockout being fixed", async () => {
    // The regression under test: the correct password fails, and the wallet
    // surfaces that to the user as a wrong password.
    await expect(decrypt(cloneLegacy(), PASSWORD)).rejects.toThrow();
  });

  it("recovers the canonical address from a stale label and restores unlock", async () => {
    const recovered = await recoverKeystoreAddress(cloneLegacy(), PASSWORD);

    expect(recovered).toBeDefined();
    expect(recovered?.address).toHaveLength(QRL_ADDRESS_LENGTH);
    expect(recovered?.address.toLowerCase()).toBe(
      canonicalAddress.toLowerCase(),
    );
    expect(recovered?.seed).toBe(seed);

    // After relabelling, the normal decrypt path works and yields the same seed.
    const account = await decrypt(
      relabelKeystore(cloneLegacy(), recovered!.address),
      PASSWORD,
    );
    expect(account.seed).toBe(seed);
    expect(account.address.toLowerCase()).toBe(canonicalAddress.toLowerCase());
  });

  it("is idempotent — an already-migrated keystore is left alone and still opens", async () => {
    const migrated = relabelKeystore(cloneLegacy(), canonicalAddress);

    expect(isLegacyKeystoreLabel(migrated)).toBe(false);
    await expect(decrypt(migrated, PASSWORD)).resolves.toBeDefined();
  });

  it("rejects a wrong password rather than silently migrating", async () => {
    await expect(
      recoverKeystoreAddress(cloneLegacy(), "not the password"),
    ).rejects.toThrow();
  });

  it("declines keystores it cannot confidently migrate", async () => {
    const nonArgon = cloneLegacy();
    // The KeyStore type narrows `kdf` to "argon2id"; a keystore from another
    // tool can still carry something else, which is exactly what we must decline.
    (nonArgon.crypto as { kdf: string }).kdf = "scrypt";
    await expect(
      recoverKeystoreAddress(nonArgon, PASSWORD),
    ).resolves.toBeUndefined();

    const missingParams = cloneLegacy();
    missingParams.crypto.kdfparams = { salt: "00" } as never;
    await expect(
      recoverKeystoreAddress(missingParams, PASSWORD),
    ).resolves.toBeUndefined();

    const missingIv = cloneLegacy();
    missingIv.crypto.cipherparams = {} as never;
    await expect(
      recoverKeystoreAddress(missingIv, PASSWORD),
    ).resolves.toBeUndefined();
  });
});
