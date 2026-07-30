const QRL_MAINNET_DATA = {
  chainId: "0x1",
  chainName: "Zond Mainnet",
  rpcUrls: ["http://127.0.0.1:8545"],
  blockExplorerUrls: ["https://www.theqrl.org/markets/"],
  nativeCurrency: {
    name: "Quanta",
    symbol: "QRL",
    decimals: 18,
  },
  iconUrls: ["icons/chains/zond_mainnet.svg"],
};

const QRL_TESTNET_DATA = {
  chainId: "0x539",
  chainName: "QRL Zond Testnet v2",
  rpcUrls: ["http://209.250.255.226:8545"],
  blockExplorerUrls: ["https://www.theqrl.org/markets/"],
  nativeCurrency: {
    name: "Quanta",
    symbol: "QRL",
    decimals: 18,
  },
  iconUrls: ["icons/chains/zond_testnet.svg"],
};

export type BlockchainBaseDataType = typeof QRL_MAINNET_DATA;

export type BlockchainAdditionalDataType = {
  defaultRpcUrl: string;
  defaultBlockExplorerUrl: string;
  defaultIconUrl: string;
  isTestnet: boolean;
  /**
   * Optional WebSocket/subscription RPC endpoint. Optional because there is no
   * sensible default: it used to be hardcoded to a loopback address for every
   * chain, so subscriptions never reached the chain in use and any page could
   * drive POSTs to a fixed local port. Absent means subscriptions are
   * unsupported for that chain. See CIPH-QRLW326-20.
   */
  defaultWsRpcUrl?: string;
  isCustomChain: boolean;
  qrnsRegistryAddress?: string;
};

export type BlockchainDataType = BlockchainBaseDataType &
  BlockchainAdditionalDataType;

export const QRL_BLOCKCHAINS: BlockchainDataType[] = [
  {
    ...QRL_MAINNET_DATA,
    defaultRpcUrl: QRL_MAINNET_DATA.rpcUrls[0],
    defaultBlockExplorerUrl: QRL_MAINNET_DATA.blockExplorerUrls[0],
    defaultIconUrl: QRL_MAINNET_DATA.iconUrls[0],
    isTestnet: false,
    isCustomChain: false,
  },
  {
    ...QRL_TESTNET_DATA,
    defaultRpcUrl: QRL_TESTNET_DATA.rpcUrls[0],
    defaultBlockExplorerUrl: QRL_TESTNET_DATA.blockExplorerUrls[0],
    defaultIconUrl: QRL_TESTNET_DATA.iconUrls[0],
    isTestnet: true,
    isCustomChain: false,
  },
];

export const DEFAULT_BLOCKCHAIN = QRL_BLOCKCHAINS[1]; // Testnet
