import { getMnemonicFromHexSeed } from "@/functions/getMnemonicFromHexSeed";
import { Web3BaseWalletAccount } from "@theqrl/web3";
import AddressUtil from "./addressUtil";

// Control (Cc) chars except tab/newline/cr, plus all format (Cf) chars
// (zero-width, bidi overrides, BOM, etc.). Stripping these prevents a
// dApp from showing a different glyph string than the bytes being signed.
const HIDDEN_DISPLAY_CHAR_REGEX = /[^\P{Cc}\t\n\r]|\p{Cf}/gu;

export type SanitizedDisplay = {
  sanitized: string;
  hadHidden: boolean;
};

export const sanitizeForDisplay = (input: string): SanitizedDisplay => {
  const sanitized = input.replace(HIDDEN_DISPLAY_CHAR_REGEX, "");
  return { sanitized, hadHidden: sanitized !== input };
};

/**
 * A utility for handling string related operations
 */
class StringUtil {
  /**
   * Render an address in checksummed form, falling back to the input when it is
   * not a valid QRL address.
   *
   * The fallback is deliberate — several call sites pass values that are not
   * addresses at all — but it used to swallow *every* error, so an invalid
   * address, a validation failure and an outright bug in the checksum function
   * were indistinguishable from success. That is how a total failure of
   * checksummed display went unnoticed. Anything other than a rejected address is
   * now reported. See CIPH-QRLW326-19.
   */
  static getDisplayAddress(address: string): string {
    if (!AddressUtil.isQrlAddress(address?.trim?.() ?? "")) {
      // Not an address (or not a valid one): nothing to checksum, and no error.
      return address;
    }
    try {
      return AddressUtil.toChecksumQrlAddress(address);
    } catch (error) {
      // The address validated but checksumming still failed, which means the
      // display-integrity control is not working. Do not hide that.
      console.error(
        "QrlWeb3Wallet: failed to checksum a valid QRL address for display",
        error,
      );
      return address;
    }
  }

  /**
   * Group a long value into fixed-width chunks for readability, keeping its
   * leading prefix (`Q` or `0x`) separate.
   *
   * Address-agnostic on purpose: use this for anything that is not an address —
   * notably hex seeds, which must not be passed through the address-checksum path
   * in {@link getDisplayAddress}. See CIPH-QRLW326-19.
   */
  static splitForDisplay(
    value: string,
    splitLength: number = 5,
    prefixLength?: number,
  ) {
    const resolvedPrefixLength =
      prefixLength ?? (value?.startsWith("Q") ? 1 : 2);
    const prefix = value?.substring(0, resolvedPrefixLength);
    const addressSplit: string[] = [];
    for (let i = resolvedPrefixLength; i < value?.length; i += splitLength) {
      addressSplit.push(value?.substring(i, i + splitLength));
    }
    return { prefix, addressSplit };
  }

  /**
   * A function for splitting the address with spaces between them, making the address more readable.
   */
  static getSplitAddress(
    accountAddress: string,
    splitLength: number = 5,
    prefixLength?: number,
  ) {
    return StringUtil.splitForDisplay(
      StringUtil.getDisplayAddress(accountAddress),
      splitLength,
      prefixLength,
    );
  }

  /**
   * A function for downloading the secret mnemonic phrases to the system.
   */
  static downloadRecoveryPhrases = (account: Web3BaseWalletAccount) => {
    const accountAddress = account?.address;
    const displayAddress = StringUtil.getDisplayAddress(accountAddress);
    const accountHexSeed = account?.seed;
    const mnemonicPhrases = getMnemonicFromHexSeed(accountHexSeed);
    const mnemonicObject = {
      "Public Information": {
        Address: displayAddress,
        Note: "This is your public account address, and can be shared with others for receiving QRL to your account.",
      },
      "Private Information": {
        "Hex Seed": accountHexSeed,
        "Mnemonic Phrases": mnemonicPhrases,
        Note: "This is your secret key(mnemomic phrases, a 32 words combination), and should be kept safe somewhere. This is required to recover your account and to send QRL from your account to others account. If lost, you will lose access to your account and funds.",
      },
    };
    const blobData = JSON.stringify(mnemonicObject, null, 2);
    const blob = new Blob([blobData], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchorElement = document.createElement("a");
    anchorElement.href = url;
    anchorElement.download = "Secret Mnemonic Phrases.json";
    document.body.appendChild(anchorElement);
    anchorElement.click();
    document.body.removeChild(anchorElement);
    URL.revokeObjectURL(url);
  };
}

export default StringUtil;
