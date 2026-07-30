> [!CAUTION]
> **Pre-release software. Do not use it to hold anything of value.**
>
> This extension is unreleased, unaudited-in-production code under active
> development. It has not been through a full release cycle and its behaviour
> may change without notice.
>
> - **There is no public network to use it on yet.** This code targets QRL v2.0
>   (Zond) Testnet, which is **not yet publicly available**. Without access to a
>   Zond node there is nothing for the wallet to connect to.
> - **It is not suitable for QRL Mainnet (v1)** and cannot send real QRL.
> - **Do not import an existing seed or mnemonic that holds funds on any
>   network.** Create throwaway accounts only.
>
> Watch [theqrl.org](https://theqrl.org) for testnet and release announcements.


![QRL Web3 Wallet Preview Cover](misc/zond_web3_wallet_preview_cover.png)

# QRL Web3 Wallet

A wallet for creating accounts, importing accounts and sending transactions over the QRL blockchain. This is an extension for Chromium-based web browsers (Chrome, Brave, Edge, Vivaldi), for performing operations on the [QRL](https://www.theqrl.org/) blockchain.

## :package: Install (recommended for users)

The pre-built extension is published as a `.zip` on every tagged release. To install:

1. Open the [latest release](https://github.com/theQRL/qrl-web3-wallet/releases/latest) page.
2. Under **Assets**, download `qrl-web3-wallet-chrome-vX.Y.Z.zip`.
3. Unzip the file. You'll get a folder named `qrl-web3-wallet-chrome-vX.Y.Z/`.
4. Open Chrome and navigate to `chrome://extensions`.
5. Toggle **Developer mode** on (top-right).
6. Click **Load unpacked** and select the unzipped folder from step 3.
7. The QRL Web3 Wallet icon appears in your browser toolbar and can be pinned for easy access.

The same flow works on Brave, Edge, Vivaldi, and other Chromium-based browsers. Firefox is not currently supported.

Always download from the official `theQRL/qrl-web3-wallet` GitHub releases page. **Never** download or install from a third-party mirror.

### Verifying a release

Release assets carry a SHA-256 checksum and a [build-provenance attestation](https://docs.github.com/en/actions/security-guides/using-artifact-attestations), so you can confirm a zip was produced by this repository's own pipeline from a specific commit:

```sh
# Checksum: compare against the published .sha256 file
shasum -a 256 -c qrl-web3-wallet-chrome-vX.Y.Z.zip.sha256

# Provenance: confirm which workflow and commit built it
gh attestation verify qrl-web3-wallet-chrome-vX.Y.Z.zip --repo theQRL/qrl-web3-wallet
```

If either check fails, do not install the extension. Note that releases published *before* provenance was enabled carry no attestation and cannot be verified this way.

> [!WARNING]
> **Seeing a "Manifest file is missing or unreadable" error?**
>
> You're loading the wrong folder. Read the instructions again.
>
> - **If you downloaded the release zip**: make sure you selected the **unzipped folder** (e.g. `qrl-web3-wallet-chrome-v0.2.0/`) — not the `.zip` file itself, and not a parent directory.
> - **If you cloned the repo**: the project root is *not* a loadable extension. Run `npm run build` first, then load the generated `Extension/` folder: see below.

> [!WARNING]
> **Wallet won't unlock after updating, and you're sure the password is right?**
>
> Accounts created by an early pre-release build used a shorter address format and cannot be opened by the current one. The wallet detects this and says so rather than blaming your password. Remove the extension, reinstall it, and import each account again from its recovery phrase — the phrase itself is unchanged and still derives the same account. Locally stored contacts, imported tokens and transaction history are not carried over.

## :keyboard: Build from source (for developers)

Building from source produces the same `Extension/` folder that's published on the release page. The CI pipeline (`.github/workflows/release.yml`) uses these steps.

### Prerequisites

- Node.js 22.x ([nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) recommended)
- npm
- git

### Build the extension

```sh
git clone https://github.com/theQRL/qrl-web3-wallet.git
cd qrl-web3-wallet
npm ci          # `npm ci`, not `npm install` — installs exactly the pinned lockfile
npm run build
```

Output is to the `Extension/` folder. Load it in Chrome via `chrome://extensions` → **Developer mode** → **Load unpacked**, and select the `Extension/` folder.

### Development with watch mode

```sh
npm run dev
```

Rebuilds `Extension/` on every source change. Reload the extension in Chrome (`chrome://extensions` → reload icon next to the wallet entry) to pick up changes.

### Tests and lint

```sh
npm test       # vitest run
npm run lint   # eslint
```

## :dna: Features list

| Feature              | Description                                                                                                                                                                                                                                           | Related files                                                                                                                                                                                                                                                               | Status         |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| Extension manifest   | Source manifest template that Vite reads at build time, transforms (injects version), and emits to `Extension/manifest.json`. Kept under `src/` so the repo root cannot be mistakenly loaded as an unpacked extension. | [src/manifest.json](src/manifest.json)                                                                                                                                                                                                                                              | :green_circle: |
| Theming              | Based on the system theme, extension will be displayed in light or dark theme.                                                                                                                                                                        | [index.css](src/index.css) [tailwind.config.js](tailwind.config.js)                                                                                                                                                                                                         | :green_circle: |
| Blockchain selection | Connect to a Zond node, and add or edit custom chains. The built-in "Zond Mainnet" entry points at `127.0.0.1:8545` and so requires a locally-running node; the testnet entry points at a QRL-operated node over **plain HTTP, which is a pre-release configuration and not supported for production** — on an untrusted network, treat anything it reports as modifiable in transit. Subscriptions (`qrl_subscribe`) require a WebSocket endpoint to be configured explicitly and are unsupported otherwise. Real-value QRL Mainnet (v1) is **not** supported — see the warning at the top of this file.                                                                       | [ChainBadge.tsx](src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Header/ChainBadge/ChainBadge.tsx)                                                                                                                                                                         | :green_circle: |
| Create account       | The user can create a new account just with the click of a button. The newly created account address along with its secret recovery phrases will be presented to the user for download.                                                              | [CreateAccount.tsx](src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/CreateAccount/CreateAccount.tsx)                                                                                                                                                                  | :green_circle: |
| Import account       | If the user has recovery phrases of an account created in the past, that account can be imported to the wallet.                                                                                                                                       | [ImportAccount.tsx](src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportAccount/ImportAccount.tsx)                                                                                                                                                                  | :green_circle: |
| Account list         | List of accounts created or imported are stored locally, and displayed to the user. The user can switch to a different account in the wallet.                                                                                                         | [AccountList.tsx](src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/AccountList/AccountList.tsx)                                                                                                                                                                        | :green_circle: |
| User Password        | Account seeds are encrypted at rest with a password-derived key (Argon2id, 256 MiB / t=8) under AES-256-GCM, and unlocked into memory for the session. An idle auto-lock clears them again. | [Lock.tsx](src/components/QrlWeb3Wallet/ScreenLoader/Lock/Lock.tsx) [lockManager.ts](src/scripts/lockManager/lockManager.ts)                                                                                                                                                | :green_circle: |
| Transaction          | Send the native coin to another address, or to a QRNS (`*.qrl`) name that the wallet resolves on chain. Signing uses the seed held in the unlocked session — no mnemonic re-entry per transaction. | [TokenTransfer.tsx](src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/TokenTransfer/TokenTransfer.tsx)                                                                                                                                                                  | :green_circle: |
| Gas Fee              | Before making a transaction, the user can see an estimated gas fee amount.                                                                                                                                                                            | [GasFeeNotice.tsx](src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/TokenTransfer/GasFeeNotice/GasFeeNotice.tsx)                                                                                                                                                       | :green_circle: |
| Wallet connect       | Online dApps present the user with a `Connect` button. To connect the wallet with the dApps, multi-wallet support based on EIP-6963 is implemented.                                                                                                   | [DAppRequest.tsx](src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequest.tsx) [middlewares](src/scripts/middlewares) [inPageScript.ts](src/scripts/inPageScript.ts)                                                                                              | :green_circle: |
| ZRC-20 Tokens        | The wallet supports `ZRC-20` tokens. The users can import and send the ZRC-20 tokens from the wallet.                                                                                                                                                 | [ImportToken.tsx](src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportToken/ImportToken.tsx) [TokensCardContent.tsx](src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Home/AccountCreateImport/ActiveAccountDisplay/TokensCardContent/TokensCardContent.tsx)    | :green_circle: |
| ZRC-721 NFTs         | Import NFT collections, view them per account, and transfer a token. | [NFTTransfer.tsx](src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/NFTTransfer/NFTTransfer.tsx) [ImportNFTCollection](src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/ImportNFTCollection) | :green_circle: |
| Ledger hardware wallet | Derive and import accounts from a Ledger device over WebHID and sign transactions on-device with ML-DSA-87. | [ledgerService.ts](src/services/ledger/ledgerService.ts) [ledgerStore.ts](src/stores/ledgerStore.ts) | :yellow_circle: |
| Typed-data signing   | `personal_sign` and `qrl_signTypedData_v4`, with the domain and message shown for review before signing. | [QrlSignTypedDataV4](src/components/QrlWeb3Wallet/ScreenLoader/DAppRequest/DAppRequestContentSelection/PermissionRequiredContent/DAppRequestWebsite/DAppRequestFeature/QrlSignTypedDataV4) | :green_circle: |
| QRNS name resolution | Resolve a `*.qrl` name to an address on chain when sending. The resolved address is validated before it is used as the recipient. | [qrnsResolver.ts](src/utilities/qrnsResolver.ts) | :green_circle: |
| Contacts             | A local address book, selectable as a transfer recipient. | [ContactsPage.tsx](src/components/QrlWeb3Wallet/ScreenLoader/Wallet/Body/Contacts/ContactsPage.tsx) | :green_circle: |
| Auto-lock            | Clears decrypted seeds from memory after a configurable idle period. | [lockManager.ts](src/scripts/lockManager/lockManager.ts) | :green_circle: |
| Phishing detection   | Warns on dApp requests from domains on the MetaMask `eth-phishing-detect` list, refreshed daily. Advisory for approval-gated methods; account enumeration and raw broadcast are refused outright. | [phishingDetector.ts](src/scripts/phishing/phishingDetector.ts) | :yellow_circle: |
| Side panel           | The wallet can be opened in the browser side panel or a full tab as well as the toolbar popup. | [serviceWorker.ts](src/scripts/serviceWorker.ts) | :green_circle: |
| Transaction history  | Per-account, per-chain history with pending-state polling. | [transactionHistoryStore.ts](src/stores/transactionHistoryStore.ts) | :green_circle: |

## :hammer_and_wrench: Built with

[The QRL](https://github.com/theQRL/QRL), [Vite](https://vitejs.dev/), [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vitest](https://vitest.dev/), [MobX](https://mobx.js.org/README.html), [Shadcn](https://ui.shadcn.com/), [React Hook Form](https://www.react-hook-form.com/), [TailwindCSS](https://tailwindcss.com/), and [@theqrl/qrl-wallet-provider](https://github.com/theQRL/qrl-wallet-provider) for EIP-1193 / EIP-6963 dApp connectivity.
