export const QRL_ADDRESS_PREFIX = "Q";
export const QRL_ADDRESS_BYTES = 64;
export const QRL_ADDRESS_HEX_LENGTH = QRL_ADDRESS_BYTES * 2;
export const QRL_ADDRESS_LENGTH = QRL_ADDRESS_PREFIX.length + QRL_ADDRESS_HEX_LENGTH;

export const QRL_ZERO_ADDRESS =
  `${QRL_ADDRESS_PREFIX}${"0".repeat(QRL_ADDRESS_HEX_LENGTH)}` as const;

/**
 * Example addresses for tests, fixtures and UI mocks.
 *
 * These are real canonical QRL addresses: `SHAKE-256(descriptor || pk, 64)` in
 * checksummed form, derived from fixed seeds via `@theqrl/web3-qrl-accounts` and
 * verified to pass `isAddressString`. All 128 hex characters carry entropy.
 *
 * They replace a previous `expandLegacyFixture` helper that embedded a 40-hex
 * legacy address inside zero padding (`Q` + 56 zeros + core + 32 zeros). No such
 * address can occur on chain, and the shape was actively misleading — it implied a
 * 64-byte address is a legacy address in padding, when the two are unrelated
 * values derived from the same key at different output lengths. It also meant no
 * test exercised a realistic address: every fixture shared an identical head and
 * tail, so nothing could catch a truncation or distinguishability bug.
 * See CIPH-QRLW326-33.
 */
export const QRL_EXAMPLE_ADDRESS =
  "Q428d047198445023e32a2C714759c1e779c29D13073B476607013d9ECBF131B785237125693f9B634fFf922Ac3f5ED44A1bfD3090b4d378502c67fe9bde6E732";

export const QRL_EXAMPLE_ADDRESS_2 =
  "Q9533D96156773207D75A5e71391C47486C43755D73d5aFB360C312322B2205B502aA01d6AE5dd224A26cC7EE2b7B294793746A0024C86c74173AB4cB5bD96D5d";

export const QRL_EXAMPLE_ADDRESS_3 =
  "QC1217f83A8F17A4824F37DFd6215757c17071fDCc714871912Bd265150025adce6A94061EA217Ea4e716B9CC37618B5301Fda8cCe0Cdb999cb2bcD82C4e892e4";
