import SignClient from "@walletconnect/sign-client";
import bs58 from "bs58";
import nacl from "tweetnacl";

const FALLBACK_PROJECT_ID = "b56e18d47c72ab683b10814fe9495694";
const SOLANA_MAINNET_CAIP = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SOLANA_METHODS = ["solana_signMessage", "solana_requestAccounts"];
const SOLANA_EVENTS = ["accountsChanged", "chainChanged"];

let signClient = null;
let solanaSession = null;
let activeSolanaChainId = "";

function ensureProjectId() {
  const projectId = process.env.VUE_APP_WALLETCONNECT_PROJECT_ID || FALLBACK_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      "缺少 VUE_APP_WALLETCONNECT_PROJECT_ID，请先在 .env.local 中配置 WalletConnect Project ID"
    );
  }
  return projectId;
}

function getConfiguredSolanaChainId() {
  return process.env.VUE_APP_SOLANA_CHAIN_ID || SOLANA_MAINNET_CAIP;
}

function parseCaip10Account(account) {
  if (typeof account !== "string") {
    return null;
  }

  const parts = account.split(":");
  if (parts.length < 3) {
    return null;
  }

  return {
    chainId: `${parts[0]}:${parts[1]}`,
    address: parts.slice(2).join(":")
  };
}

function getSessionSolanaNamespace(session = solanaSession) {
  if (!session || !session.namespaces) {
    return null;
  }
  return session.namespaces.solana || null;
}

function isMethodApproved(method) {
  const namespace = getSessionSolanaNamespace();
  return !!(namespace && Array.isArray(namespace.methods) && namespace.methods.includes(method));
}

function getSessionChainId(session = solanaSession) {
  const namespace = getSessionSolanaNamespace(session);
  if (!namespace) {
    return "";
  }

  if (Array.isArray(namespace.chains) && namespace.chains.length > 0) {
    return namespace.chains[0];
  }

  if (Array.isArray(namespace.accounts)) {
    for (const account of namespace.accounts) {
      const parsed = parseCaip10Account(account);
      if (parsed && parsed.chainId) {
        return parsed.chainId;
      }
    }
  }

  return "";
}

function getSessionAddress(session = solanaSession) {
  const namespace = getSessionSolanaNamespace(session);
  if (!namespace || !Array.isArray(namespace.accounts)) {
    return "";
  }

  for (const account of namespace.accounts) {
    const parsed = parseCaip10Account(account);
    if (parsed && parsed.address) {
      return parsed.address;
    }

    if (typeof account === "string" && !account.includes(":")) {
      return account;
    }
  }

  return "";
}

function getRequestChainId() {
  return activeSolanaChainId || getSessionChainId() || getConfiguredSolanaChainId();
}

function getAppMetadata() {
  const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
  return {
    name: "Vue2 WalletConnect Verify Demo",
    description: "Wallet address ownership verification",
    url: origin,
    icons: [`${origin}/favicon.ico`]
  };
}

function extractAddressFromAccounts(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("钱包未返回 Solana 账户");
  }

  const first = accounts[0];

  if (typeof first === "string") {
    const parsed = parseCaip10Account(first);
    return parsed ? parsed.address : first;
  }

  if (first && typeof first === "object") {
    return first.pubkey || first.publicKey || first.address || "";
  }

  return "";
}

async function requestAccountsForSession(topic, chainId) {
  const requestChainId = chainId || getRequestChainId();
  if (!requestChainId) {
    throw new Error("无法确定 Solana chainId，请检查会话 namespaces");
  }

  const requestParams = { topic, chainId: requestChainId };

  try {
    const accounts = await signClient.request({
      ...requestParams,
      request: {
        method: "solana_requestAccounts",
        params: {}
      }
    });

    const address = extractAddressFromAccounts(accounts);
    return normalizeSolanaAddress(address);
  } catch (firstError) {
    if (!isMethodApproved("solana_getAccounts")) {
      throw firstError;
    }

    const accounts = await signClient.request({
      ...requestParams,
      request: {
        method: "solana_getAccounts",
        params: {}
      }
    });

    const address = extractAddressFromAccounts(accounts);
    if (!address) {
      throw firstError;
    }

    return normalizeSolanaAddress(address);
  }
}

export async function getSolanaSignClient() {
  if (signClient) {
    return signClient;
  }

  signClient = await SignClient.init({
    projectId: ensureProjectId(),
    metadata: getAppMetadata()
  });

  return signClient;
}

export async function connectSolanaWalletConnect(options = {}) {
  const client = await getSolanaSignClient();
  const proposalChainId = getConfiguredSolanaChainId();

  const { uri, approval } = await client.connect({
    requiredNamespaces: {
      solana: {
        methods: SOLANA_METHODS,
        chains: [proposalChainId],
        events: SOLANA_EVENTS
      }
    }
  });

  if (uri && typeof options.onUri === "function") {
    options.onUri(uri);
  }

  solanaSession = await approval();

  const chainIdFromSession = getSessionChainId(solanaSession);
  activeSolanaChainId = chainIdFromSession || proposalChainId;

  let address = getSessionAddress(solanaSession);
  if (!address) {
    address = await requestAccountsForSession(solanaSession.topic, activeSolanaChainId);
  }

  return {
    address: normalizeSolanaAddress(address),
    chainId: activeSolanaChainId
  };
}

export async function signSolanaMessage(message, address) {
  if (!signClient || !solanaSession) {
    throw new Error("钱包尚未连接，请先扫码连接 WalletConnect");
  }

  const normalizedAddress = normalizeSolanaAddress(address);
  const encodedMessage = bs58.encode(new TextEncoder().encode(message));

  const result = await signClient.request({
    topic: solanaSession.topic,
    chainId: getRequestChainId(),
    request: {
      method: "solana_signMessage",
      params: {
        message: encodedMessage,
        pubkey: normalizedAddress
      }
    }
  });

  let signature = "";
  if (typeof result === "string") {
    signature = result;
  } else if (result && typeof result === "object") {
    signature = result.signature || result.result || "";
  }

  if (!signature) {
    throw new Error("钱包未返回 Solana 签名");
  }

  return signature;
}

export function verifySolanaSignature(message, signature, address) {
  const messageBytes = new TextEncoder().encode(message);
  const signatureBytes = bs58.decode(signature);
  const publicKeyBytes = bs58.decode(normalizeSolanaAddress(address));

  return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
}

export function normalizeSolanaAddress(address) {
  const value = (address || "").trim();
  const decoded = bs58.decode(value);
  if (decoded.length !== 32) {
    throw new Error("Solana 地址格式不正确");
  }
  return value;
}

export async function disconnectSolanaWalletConnect() {
  if (!signClient || !solanaSession) {
    return;
  }

  await signClient.disconnect({
    topic: solanaSession.topic,
    reason: {
      code: 6000,
      message: "User disconnected"
    }
  });

  solanaSession = null;
  activeSolanaChainId = "";
}

export function buildSolanaChallenge(address) {
  const nonce = Math.random().toString(36).slice(2, 10);
  const issuedAt = new Date().toISOString();

  return [
    "Wallet Address Ownership Verification",
    "",
    "Chain: Solana",
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    "",
    "Sign this message to prove you own this address."
  ].join("\n");
}
