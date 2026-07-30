import { QRL_ADDRESS_LENGTH } from "@/constants/address";
import {
  isAddressString,
  toChecksumAddress,
} from "@theqrl/web3-validator";

class AddressUtil {
  static isQrlAddress(address: string): boolean {
    return isAddressString(address);
  }

  static isLegacyQrlAddress(address: string): boolean {
    return /^Q[0-9a-fA-F]{40}$/.test(address);
  }

  static normalizeQrlAddress(address: string): string {
    const trimmed = address.trim();
    if (!AddressUtil.isQrlAddress(trimmed)) {
      throw new Error(`Expected ${QRL_ADDRESS_LENGTH}-character QRL address`);
    }
    return AddressUtil.toChecksumQrlAddress(trimmed);
  }

  static toChecksumQrlAddress(address: string): string {
    const trimmed = address.trim();
    if (!AddressUtil.isQrlAddress(trimmed)) {
      throw new Error(`Expected ${QRL_ADDRESS_LENGTH}-character QRL address`);
    }
    return toChecksumAddress(trimmed);
  }
}

// `shortenQrlAddress` (first 10 + last 8 characters) was removed: it had no
// production caller, and head/tail truncation in a confirmation surface is the
// setup for address-poisoning. Every UI site uses `StringUtil.getSplitAddress`,
// which renders the address in full. If a shortened form is wanted later, it
// needs a test asserting two distinct real addresses do not render identically.
// See CIPH-QRLW326-34.

export default AddressUtil;
