import AddressUtil from "@/utilities/addressUtil";
import { QRNS } from "@theqrl/web3-qrl-qrns";

/**
 * Check if input looks like a QRNS name (e.g. alice.qrl, sub.alice.qrl).
 */
export function isQrnsName(input: string): boolean {
  return /^[a-z0-9.-]+\.qrl$/i.test(input.trim());
}

/**
 * Resolve a QRNS name to a Q-address using on-chain lookup.
 * Throws if resolution fails (no contract, name not registered, network error)
 * or if the registry returns something that is not a valid QRL address.
 */
export async function resolveQrnsName(
  name: string,
  rpcUrl: string,
  registryAddress?: string,
): Promise<string> {
  const qrns = new QRNS(registryAddress, rpcUrl);
  const address = await qrns.getAddress(name);
  const addr = String(address);
  // Convert 0x-prefixed address to Q-prefixed
  const candidate = addr.startsWith("0x") ? "Q" + addr.slice(2) : addr;

  // The resolved value is supplied by an on-chain registry, reached over the
  // chain's configured RPC endpoint — neither of which the wallet controls. It
  // becomes the transaction recipient, so it must be validated here rather than
  // trusted: the form schema only ever validated the *name*. See CIPH-QRLW326-4.
  if (!AddressUtil.isQrlAddress(candidate)) {
    throw new Error(
      `QRNS resolution for "${name}" returned an invalid QRL address`,
    );
  }
  return candidate;
}
