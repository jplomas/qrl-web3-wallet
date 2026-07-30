import { recoverTransaction } from "@theqrl/web3-qrl-accounts";

/**
 * Assert that a signed transaction really was signed by the account the wallet
 * believes is sending it.
 *
 * This exists as a shared helper because it was previously implemented on the
 * software signing path only. The Ledger path serialised and broadcast without
 * any equivalent check, so a stored account whose address had drifted from the
 * key that actually signs — for instance one imported before the 64-byte address
 * change — would broadcast successfully while the wallet filed the history,
 * nonce and balance under an address that is not the on-chain sender. Both paths
 * now call this, and any future signing path should too. See CIPH-QRLW326-26.
 *
 * @throws when the recovered sender does not match `expectedFrom`.
 */
export const assertSignedTransactionSender = (
  rawTransaction: string,
  expectedFrom: string,
): void => {
  const recoveredSender = recoverTransaction(rawTransaction);
  if (recoveredSender?.toLowerCase() !== expectedFrom?.toLowerCase()) {
    throw new Error(
      `Signed transaction sender mismatch. expected=${expectedFrom} recovered=${recoveredSender}`,
    );
  }
};
