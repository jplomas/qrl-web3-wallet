import {
  QRL_ADDRESS_LENGTH,
  QRL_EXAMPLE_ADDRESS,
  QRL_EXAMPLE_ADDRESS_2,
} from "@/constants/address";
import { describe, expect, it } from "vitest";
import AddressUtil from "./addressUtil";

describe("addressUtil", () => {
  it("accepts 64-byte Q-prefixed QRL addresses", () => {
    expect(QRL_EXAMPLE_ADDRESS).toHaveLength(QRL_ADDRESS_LENGTH);
    expect(AddressUtil.isQrlAddress(QRL_EXAMPLE_ADDRESS)).toBe(true);
    expect(AddressUtil.isQrlAddress(QRL_EXAMPLE_ADDRESS_2)).toBe(true);
  });

  it("validates mixed-case checksum addresses", () => {
    const checksummedAddress =
      "QabaBABabaBAbAbAbABaBABaBabaBabaBAbabaBABABAbAbabababAbaBaBABABabABaBaBABABaBabaBABaBabABAbABabaBAbABAbABAbaBabABababAbaBaBabaBAB";
    const invalidChecksumAddress =
      "QaBababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababababab";

    expect(AddressUtil.isQrlAddress(checksummedAddress)).toBe(true);
    expect(AddressUtil.isQrlAddress(invalidChecksumAddress)).toBe(false);
  });

  it("rejects legacy 20-byte QRL addresses as current addresses", () => {
    const legacyAddress = "Q20B714091cF2a62DADda2847803e3f1B9D2D3779";

    expect(AddressUtil.isQrlAddress(legacyAddress)).toBe(false);
    expect(AddressUtil.isLegacyQrlAddress(legacyAddress)).toBe(true);
  });

  it("normalizes only valid current QRL addresses", () => {
    // The fixtures are already canonical checksummed addresses, so normalising
    // one is the identity — asserting that is stronger than asserting a literal,
    // because it cannot drift when the fixtures change. See CIPH-QRLW326-33.
    expect(AddressUtil.normalizeQrlAddress(` ${QRL_EXAMPLE_ADDRESS} `)).toBe(
      QRL_EXAMPLE_ADDRESS,
    );
    expect(() => AddressUtil.normalizeQrlAddress("Q1234")).toThrow(
      "Expected 129-character QRL address",
    );
  });

  it("converts current QRL addresses to SHAKE256 checksum form", () => {
    expect(AddressUtil.toChecksumQrlAddress(QRL_EXAMPLE_ADDRESS_2)).toBe(
      QRL_EXAMPLE_ADDRESS_2,
    );
    // Checksumming is case-recovering: an all-lowercase form must produce the
    // canonical mixed-case one.
    expect(
      AddressUtil.toChecksumQrlAddress(QRL_EXAMPLE_ADDRESS_2.toLowerCase()),
    ).toBe(QRL_EXAMPLE_ADDRESS_2);
  });

  it("identifies pre-64-byte legacy addresses", () => {
    // Replaces the old `shortenQrlAddress` test, which asserted the all-zero
    // string `"Q000000000...00000000"` — a value identical for every padded
    // fixture, i.e. it was asserting a collision without noticing.
    // See CIPH-QRLW326-34 and CIPH-QRLW326-33.
    expect(
      AddressUtil.isLegacyQrlAddress("Q20B714091cF2a62DADda2847803e3f1B9D2D3779"),
    ).toBe(true);
    expect(AddressUtil.isLegacyQrlAddress(QRL_EXAMPLE_ADDRESS)).toBe(false);
    expect(AddressUtil.isLegacyQrlAddress("Q1234")).toBe(false);
  });
});
