import { describe, expect, it, vi } from "vitest";
import AddressUtil from "./addressUtil";
import StringUtil from "./stringUtil";

const CANONICAL =
  "Q000000000000000000000000000000000000000000000000000000008a8eAfB1CF62bFbEb1741769DaE1A9dd4799619200000000000000000000000000000000";
const HEX_SEED =
  "0x010000aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

describe("StringUtil.getDisplayAddress — failures must not be silent", () => {
  it("returns a valid address in checksummed form", () => {
    expect(StringUtil.getDisplayAddress(CANONICAL)).toBe(CANONICAL);
  });

  it("returns non-address input unchanged without reporting an error", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(StringUtil.getDisplayAddress("not an address")).toBe(
      "not an address",
    );
    expect(StringUtil.getDisplayAddress("")).toBe("");
    // A value that was never an address is an expected input, not a fault.
    expect(error).not.toHaveBeenCalled();
    error.mockRestore();
  });

  // CIPH-QRLW326-19. The bare `catch` used to make an invalid address, a
  // validation failure and an outright bug in the checksum function all look
  // identical to success — which is how a total failure of checksummed display
  // went unnoticed across the entire UI.
  it("reports an error when a valid address cannot be checksummed", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const checksum = vi
      .spyOn(AddressUtil, "toChecksumQrlAddress")
      .mockImplementation(() => {
        throw new Error("checksum unavailable");
      });

    // Still degrades to the raw address so the UI renders…
    expect(StringUtil.getDisplayAddress(CANONICAL)).toBe(CANONICAL);
    // …but the failure is no longer hidden.
    expect(error).toHaveBeenCalledOnce();

    checksum.mockRestore();
    error.mockRestore();
  });
});

describe("StringUtil.splitForDisplay — grouping without address handling", () => {
  it("groups a hex seed without routing it through address checksumming", () => {
    const checksum = vi.spyOn(AddressUtil, "toChecksumQrlAddress");

    const { prefix, addressSplit } = StringUtil.splitForDisplay(HEX_SEED, 3);

    expect(prefix).toBe("0x");
    expect(addressSplit[0]).toBe(HEX_SEED.slice(2, 5));
    expect(addressSplit.join("")).toBe(HEX_SEED.slice(2));
    // A secret must not be handed to address-checksum code. See CIPH-QRLW326-19.
    expect(checksum).not.toHaveBeenCalled();

    checksum.mockRestore();
  });

  it("keeps the Q prefix separate for addresses and loses nothing", () => {
    const { prefix, addressSplit } = StringUtil.splitForDisplay(CANONICAL);
    expect(prefix).toBe("Q");
    expect(addressSplit.join("")).toBe(CANONICAL.slice(1));
  });

  it("still checksums when called through getSplitAddress", () => {
    const { prefix, addressSplit } = StringUtil.getSplitAddress(CANONICAL);
    expect(prefix).toBe("Q");
    expect(`${prefix}${addressSplit.join("")}`).toBe(CANONICAL);
  });
});
