import EthereumProvider from "@walletconnect/ethereum-provider";
import { ethers } from "ethers";

let ethereumProvider = null;
let web3Provider = null;

const REQUIRED_CHAIN = 1;
const OPTIONAL_CHAINS = [1, 56, 137, 42161, 10];

function ensureProjectId() {
  const projectId = 'b56e18d47c72ab683b10814fe9495694';
  if (!projectId) {
    throw new Error(
      "缺少 VUE_APP_WALLETCONNECT_PROJECT_ID，请先在 .env.local 中配置 WalletConnect Project ID"
    );
  }
  return projectId;
}

export async function getWalletConnectProvider() {
  if (ethereumProvider) {
    return ethereumProvider;
  }

  ethereumProvider = await EthereumProvider.init({
    projectId: ensureProjectId(),
    chains: [REQUIRED_CHAIN],
    optionalChains: OPTIONAL_CHAINS,
    showQrModal: true,
    methods: [
      "eth_sendTransaction",
      "personal_sign",
      "eth_sign",
      "eth_signTypedData",
      "eth_signTypedData_v4",
      "eth_chainId",
      "eth_accounts"
    ],
    events: ["connect", "disconnect", "accountsChanged", "chainChanged"]
  });

  return ethereumProvider;
}

export async function connectWalletConnect() {
  const provider = await getWalletConnectProvider();
  await provider.connect();

  web3Provider = new ethers.providers.Web3Provider(provider, "any");
  const signer = web3Provider.getSigner();

  const address = await signer.getAddress();
  const chainId = await signer.getChainId();

  return { address, chainId };
}

export async function signMessage(message) {
  if (!web3Provider) {
    throw new Error("钱包尚未连接，请先扫码连接 WalletConnect");
  }

  const signer = web3Provider.getSigner();
  return signer.signMessage(message);
}

export function recoverSignerAddress(message, signature) {
  return ethers.utils.verifyMessage(message, signature);
}

export function buildChallenge(address) {
  const nonce = Math.random().toString(36).slice(2, 10);
  const issuedAt = new Date().toISOString();

  return [
    "Wallet Address Ownership Verification",
    "",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    "",
    "Sign this message to prove you own this address."
  ].join("\n");
}

export async function disconnectWalletConnect() {
  if (!ethereumProvider) {
    return;
  }

  await ethereumProvider.disconnect();
  web3Provider = null;
}

export function checksumAddress(address) {
  return ethers.utils.getAddress(address);
}
