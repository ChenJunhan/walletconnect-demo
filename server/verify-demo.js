const express = require("express");
const { ethers } = require("ethers");
const bs58 = require("bs58");
const nacl = require("tweetnacl");

const app = express();
app.use(express.json());

const nonces = new Map();
const NONCE_TTL_MS = 5 * 60 * 1000;

function normalizeEvmAddress(address) {
  return ethers.utils.getAddress(address);
}

function normalizeSolanaAddress(address) {
  const value = (address || "").trim();
  const decoded = bs58.decode(value);
  if (decoded.length !== 32) {
    throw new Error("solana address invalid");
  }
  return value;
}

function normalizeAddress(chainType, address) {
  return chainType === "solana" ? normalizeSolanaAddress(address) : normalizeEvmAddress(address);
}

function buildChallenge(chainType, address, nonce) {
  return [
    "Wallet Address Ownership Verification",
    "",
    `Chain: ${chainType === "solana" ? "Solana" : "EVM"}`,
    `Address: ${address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
    "",
    "Sign this message to prove you own this address."
  ].join("\n");
}

function getNonceKey(chainType, address) {
  if (chainType === "solana") {
    return `solana:${address}`;
  }
  return `evm:${address.toLowerCase()}`;
}

function verifyEvmSignature(address, message, signature) {
  const recovered = normalizeEvmAddress(ethers.utils.verifyMessage(message, signature));
  return {
    ok: recovered === address,
    recovered
  };
}

function verifySolanaSignature(address, message, signature) {
  const ok = nacl.sign.detached.verify(
    new TextEncoder().encode(message),
    bs58.decode(signature),
    bs58.decode(address)
  );

  return {
    ok,
    recovered: ok ? address : ""
  };
}

app.post("/api/wallet/nonce", (req, res) => {
  try {
    const chainType = req.body.chainType === "solana" ? "solana" : "evm";
    const address = normalizeAddress(chainType, req.body.address || "");
    const nonce = Math.random().toString(36).slice(2, 10);
    const message = buildChallenge(chainType, address, nonce);

    nonces.set(getNonceKey(chainType, address), {
      chainType,
      nonce,
      message,
      createdAt: Date.now()
    });

    res.json({ ok: true, chainType, address, message, nonce });
  } catch (e) {
    res.status(400).json({ ok: false, message: "address invalid" });
  }
});

app.post("/api/wallet/verify", (req, res) => {
  try {
    const chainType = req.body.chainType === "solana" ? "solana" : "evm";
    const address = normalizeAddress(chainType, req.body.address || "");
    const message = req.body.message || "";
    const signature = req.body.signature || "";

    if (!message || !signature) {
      return res.status(400).json({ ok: false, message: "message/signature required" });
    }

    const nonceKey = getNonceKey(chainType, address);
    const saved = nonces.get(nonceKey);
    if (!saved) {
      return res.status(400).json({ ok: false, message: "nonce not found" });
    }

    if (saved.message !== message) {
      return res.status(400).json({ ok: false, message: "challenge mismatch" });
    }

    if (Date.now() - saved.createdAt > NONCE_TTL_MS) {
      nonces.delete(nonceKey);
      return res.status(400).json({ ok: false, message: "challenge expired" });
    }

    const verifyResult =
      chainType === "solana"
        ? verifySolanaSignature(address, message, signature)
        : verifyEvmSignature(address, message, signature);

    nonces.delete(nonceKey);

    if (!verifyResult.ok) {
      return res.status(401).json({ ok: false, message: "signature invalid" });
    }

    return res.json({
      ok: true,
      chainType,
      address,
      recovered: verifyResult.recovered
    });
  } catch (e) {
    return res.status(400).json({ ok: false, message: "verify failed" });
  }
});

const port = process.env.PORT || 3001;
app.listen(port, () => {
  console.log(`verify server listening on http://localhost:${port}`);
});