# Security Policy — QRL Web3 Wallet

> [!CAUTION]
> Pre-release software targeting QRL v2.0 (Zond) Testnet, which is not yet
> publicly available. It holds no real value and should not be used with a seed or
> mnemonic that does. See the warning at the top of the [README](README.md).

## Reporting a vulnerability

If you find a security issue in this extension, please tell us privately rather than opening a public issue:

1. Email `security@theqrl.org`
2. Or open a [GitHub Security Advisory](https://github.com/theQRL/qrl-web3-wallet/security/advisories/new)

Helpful to include: what the issue is, the conditions needed to trigger it, a proof of concept if you have one, and the commit you tested.

The QRL security programme, including reward terms and scope, is documented at [theqrl.org/security-report](https://theqrl.org/security-report/), which is the single source of truth. Given the rapid changing security landscape, terms are continually evolving. Note that this repository is **pre-release and therefore outside the scope of rewards**; we do still credit reporters in the hall of fame, and we would rather hear about a problem now than after launch.

## What cryptography is used, and where

This extension is not a cryptography implementation. Every primitive comes from an upstream QRL library, and this document records which one is used at which point so a reviewer knows where to look. Issues in the primitives themselves belong upstream, principally [go-qrllib](https://github.com/theQRL/go-qrllib), [wallet.js](https://github.com/theQRL/wallet.js) and [web3.js](https://github.com/theQRL/web3.js).

### Signatures

| | |
|---|---|
| Scheme | ML-DSA-87 (FIPS 204), NIST security category 5 |
| Public key | 2,592 bytes |
| Signature | 4,627 bytes |
| Implementation | `@theqrl/mldsa87`, via `@theqrl/wallet.js` |
| Used for | Transaction signing, `personal_sign`, `qrl_signTypedData_v4` |

Transactions are EIP-1559 (type-2) and are signed by `@theqrl/web3-qrl-accounts`. Typed-data hashing uses `getEncodedEip712Data` from `@theqrl/web3-qrl-abi`. After signing, the wallet recovers the sender from the serialised transaction and refuses to broadcast if it does not match the account that was asked to sign on both the software and Ledger paths (`src/utilities/signedTransactionGuard.ts`).

### Seeds and mnemonics

| | |
|---|---|
| Seed | 48 bytes, plus a 3-byte descriptor = 51-byte extended seed |
| Mnemonic | 34 words, 12 bits per word, from a fixed 4,096-word list |
| Implementation | `@theqrl/wallet.js`; the encoding helpers are vendored in `src/functions/mnemonicHelper.ts` because the package does not export them |

The mnemonic is a direct encoding of the extended seed and carries **no checksum** by design: a typo produces a different valid-looking seed rather than an error. Validation happens downstream: an unknown word, an odd word count, or a decoded value that is not exactly 51 bytes with a recognised descriptor is rejected.

The 48-byte length is a QRL-wide convention rather than an ML-DSA-87 parameter. go-qrllib describes "a common 48-byte seed that is derived differently for each signature algorithm", so one seed (and therefore one mnemonic) can produce an ML-DSA-87, (future) SPHINCS+-256s or (legacy) XMSS wallet, with the descriptor recording which. Each scheme adapts the same input to its own requirement: ML-DSA-87 takes `SHA-256(seed)` to obtain the 32-byte key-generation seed (ξ) that FIPS 204
expects.

The effective key space for this wallet is therefore 256 bits.

### Addresses

| | |
|---|---|
| Derivation | `SHAKE-256(descriptor ‖ public key)`, 64-byte output |
| String form | `Q` + 128 hex characters (129 characters total) |
| Checksum | Mixed-case, EIP-55 style, over a SHAKE-256 digest of the lowercase body |
| Implementation | `@theqrl/wallet.js` (derivation), `@theqrl/web3-validator` (validation and checksum) |

All 128 hex characters carry entropy; the format has no structural padding.

**Why 64 bytes.** The address is the last link in the chain that binds a key to an identity, so it should not be the weakest one. A 512-bit digest gives 256-bit collision resistance and 512-bit preimage resistance, which puts the address layer at the same NIST post-quantum category, 5, that ML-DSA-87 targets. The 160-bit address size conventional in EVM chains yields an 80-bit collision work factor, short of even category 1, and would leave the identity layer materially weaker than the signature protecting it.

NIST's post-quantum categories are defined against specific reference problems: key search on AES for categories 1, 3 and 5, and collision search on SHA-2 for 2 and 4. Equating a digest length with a signature scheme's category is, therefore, an approximation rather than a formal correspondence. The design objective is narrower and precise: the work factor required to attack the address layer should not be the binding constraint on the security of the system as a whole.

A practical consequence: addresses must be compared in full. A matching head and tail, which is all a truncated UI rendering shows, is not identity, and grinding a key to match a visible prefix and suffix is far cheaper than a real collision.

### Keystore encryption at rest

| | |
|---|---|
| KDF | Argon2id — m = 262,144 KiB (256 MiB), t = 8, p = 1, dkLen = 32 |
| Salt | 32 bytes, fresh per encryption |
| Cipher | AES-256-GCM, 12-byte IV fresh per encryption, 128-bit authentication tag |
| Implementation | `@noble/hashes` (Argon2id) and WebCrypto via `@theqrl/qrl-cryptography` |
| Stored in | `chrome.storage.local`, ciphertext only |

The Argon2id output *is* the AES key, so the parameters recorded in a keystore cannot be rewritten to weaken an offline attack. A changed parameter set yields a different key and the GCM tag check fails. Parameters are additionally bounded on both the encrypt and decrypt paths, and the wallet passes its own recommended set explicitly (`src/scripts/lockManager/keystoreParams.ts`) rather than relying on library defaults. Passwords are NFC-normalised before use so the same typed password produces the same bytes across platforms and input methods.

`decrypt()` also checks that the address derived from the recovered seed matches the address recorded in the keystore, for parity with go-qrl's `keystore.GetKey`.

### Keys in memory

Decrypted seeds live in the service worker for the duration of an unlock session, and are mirrored to `chrome.storage.session` so they survive a service-worker restart. That area is memory-backed, cleared when the browser closes, and pinned to `TRUSTED_CONTEXTS` so content scripts cannot read it. The wallet password is held in memory only and is never written to any storage area. An idle auto-lock clears seeds, password and session backup together.

Note the limits of this: JavaScript offers no reliable zeroization, so the wallet cannot guarantee that key material is scrubbed from memory after use. Anything able to read the browser's process memory can read the seeds of an unlocked wallet.

### Randomness

All key material and all salts and IVs come from `crypto.getRandomValues`, via `@theqrl/qrl-cryptography`. There is no fallback path: if the platform CSPRNG is unavailable the operation throws, and an all-zero result is treated as a fault rather than returned.

### Hardware wallet

Ledger support derives accounts at `m/44'/238'/0'/0/i` and signs on-device with ML-DSA-87 over WebHID. The device's public key and signature exceed the 255-byte APDU frame limit, so both are transferred in chunks and reassembled with length validation at each step. A malicious or faulty device is not a threat this wallet can defend against (see below).

### Transport

RPC traffic is sent to whichever endpoint the selected chain specifies. Chains supplied by a dApp are constrained to HTTPS or a loopback address; chains the user configures are not.

**Cleartext HTTP is a pre-release and local-development configuration only. It is not a supported production configuration.** The built-in testnet entry currently uses plain HTTP, which is acceptable solely because the network it points at is a pre-release testnet carrying no value. Any deployment intended to hold value must use TLS: without it, responses are modifiable in transit and the user's full address set and transaction activity are visible to any observer on the path. TLS for the public endpoints is a prerequisite for release, not a hardening step.

## What we cannot protect against

Stated so reviewers do not spend time here, and so users understand the boundary.

- **Code execution on the user's machine, or anything able to read browser process memory.** An unlocked wallet's seeds are readable in that situation.
- **A malicious or compromised Ledger device.** The wallet validates response lengths and checks the recovered sender, but it trusts the device's screen.
- **Timing, power and electromagnetic side channels** against ML-DSA-87. That is upstream in the signing library.
- **A hostile or on-path RPC endpoint** deciding what chain state to report. We do validate anything from an endpoint that could reach a signature, a recipient or a permission decision (a name-service result becoming a transaction recipient, for instance) but a lying endpoint can still misreport balances, receipts and gas.
- **Phishing-list gaps.** Detection uses a third-party blocklist refreshed regularly; a fresh domain will not be on it. It is defence in depth, not a control.
- **The user approving something they did not read.**

## Supported versions

Pre-release: only the latest tagged release is supported, and there are no backports. Fixes land on `main` and ship in the next release.

## Verifying a release

Release assets carry a SHA-256 checksum and a build-provenance attestation. The verification commands are in the [README](README.md#verifying-a-release).

## Contact

`security@theqrl.org`
