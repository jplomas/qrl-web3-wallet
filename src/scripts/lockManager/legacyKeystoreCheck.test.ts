import { describe, expect, it } from "vitest";
import {
  assertNoLegacyKeystores,
  findLegacyKeystoreLabels,
  isLegacyKeystoreFormatError,
  LEGACY_KEYSTORE_FORMAT,
  LegacyKeystoreFormatError,
} from "@/scripts/lockManager/legacyKeystoreCheck";
import { QRL_EXAMPLE_ADDRESS } from "@/constants/address";

const LEGACY = "Q20748573f26d81b7dbcecd3aa8f5cc4c2b3d2a51";
const CURRENT = QRL_EXAMPLE_ADDRESS;

describe("findLegacyKeystoreLabels", () => {
  it("should return nothing for keystores on the current address format", () => {
    expect(findLegacyKeystoreLabels([{ address: CURRENT }])).toEqual([]);
  });

  it("should return the label of a pre-64-byte keystore", () => {
    expect(findLegacyKeystoreLabels([{ address: LEGACY }])).toEqual([LEGACY]);
  });

  it("should report every legacy keystore in a mixed vault", () => {
    const other = "Q0123456789abcdef0123456789abcdef01234567";
    expect(
      findLegacyKeystoreLabels([
        { address: CURRENT },
        { address: LEGACY },
        { address: other },
      ]),
    ).toEqual([LEGACY, other]);
  });

  it("should ignore keystores with a missing or non-string label", () => {
    expect(
      findLegacyKeystoreLabels([{}, null, undefined, { address: 42 }]),
    ).toEqual([]);
  });

  it("should detect a legacy label regardless of hex case", () => {
    // Addresses are stored both lower-cased and checksummed, so a case-sensitive
    // detector would miss half of them and unlock would mis-report the failure.
    const checksummed = "Q20748573F26d81b7DBCEcd3aA8F5cc4C2b3D2a51";
    expect(findLegacyKeystoreLabels([{ address: checksummed }])).toEqual([
      checksummed,
    ]);
  });
});

describe("assertNoLegacyKeystores", () => {
  it("should not throw for an empty vault", () => {
    expect(() => assertNoLegacyKeystores([])).not.toThrow();
  });

  it("should not throw when every keystore is on the current format", () => {
    expect(() =>
      assertNoLegacyKeystores([{ address: CURRENT }, { address: CURRENT }]),
    ).not.toThrow();
  });

  it("should throw a LegacyKeystoreFormatError naming the affected labels", () => {
    let thrown: unknown;
    try {
      assertNoLegacyKeystores([{ address: CURRENT }, { address: LEGACY }]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(LegacyKeystoreFormatError);
    expect((thrown as LegacyKeystoreFormatError).addresses).toEqual([LEGACY]);
    expect((thrown as LegacyKeystoreFormatError).code).toBe(
      LEGACY_KEYSTORE_FORMAT,
    );
  });

  it("should read the label without touching the ciphertext", () => {
    // The check must be safe to run before decryption: reading anything other
    // than `address` would mean it needs the password, which defeats the point
    // of failing early.
    const touched: string[] = [];
    const keyStore = new Proxy(
      { address: LEGACY, crypto: {}, version: 3 },
      {
        get(target, prop, receiver) {
          if (typeof prop === "string") touched.push(prop);
          return Reflect.get(target, prop, receiver);
        },
      },
    );
    expect(() => assertNoLegacyKeystores([keyStore])).toThrow(
      LegacyKeystoreFormatError,
    );
    expect(touched).toEqual(["address"]);
  });
});

describe("isLegacyKeystoreFormatError", () => {
  it("should recognise the error type", () => {
    expect(isLegacyKeystoreFormatError(new LegacyKeystoreFormatError([LEGACY])))
      .toBe(true);
  });

  it("should recognise a structured-cloned copy that lost its prototype", () => {
    expect(
      isLegacyKeystoreFormatError({
        code: LEGACY_KEYSTORE_FORMAT,
        message: "whatever",
      }),
    ).toBe(true);
  });

  it("should not match an ordinary failure", () => {
    expect(isLegacyKeystoreFormatError(new Error("wrong password"))).toBe(false);
    expect(isLegacyKeystoreFormatError(undefined)).toBe(false);
    expect(isLegacyKeystoreFormatError(null)).toBe(false);
    expect(isLegacyKeystoreFormatError("LEGACY_KEYSTORE_FORMAT")).toBe(false);
  });
});
