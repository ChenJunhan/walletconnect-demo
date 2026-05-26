<template>
  <div class="wc-verify-card">
    <h2>WalletConnect 地址归属验证</h2>

    <label for="chain-select">选择链类型</label>
    <select id="chain-select" v-model="chainType" :disabled="loading || !!connectedAddress">
      <option value="evm">EVM (Ethereum/Polygon/BSC...)</option>
      <option value="solana">Solana</option>
    </select>

    <label for="wallet-input">输入要验证的钱包地址</label>
    <input
      id="wallet-input"
      v-model.trim="inputAddress"
      type="text"
      :placeholder="chainType === 'evm' ? '0x...' : 'Solana Base58 Address'"
      autocomplete="off"
    />

    <div class="actions">
      <button :disabled="loading" @click="onConnect">
        1) 生成二维码并连接钱包
      </button>
      <button :disabled="loading || !connectedAddress || !inputAddress" @click="onVerify">
        2) 签名验证地址归属
      </button>
      <button :disabled="loading || !connectedAddress" class="ghost" @click="onDisconnect">
        断开连接
      </button>
    </div>

    <p v-if="connectedAddress" class="info">已连接地址: {{ connectedAddress }}</p>
    <p v-if="chainId" class="info">当前链 ID: {{ chainId }}</p>
    <p v-if="chainType === 'solana' && wcUri" class="info">WalletConnect URI: {{ wcUri }}</p>
    <div v-if="chainType === 'solana' && wcQrDataUrl" class="result-block">
      <p class="result-title">请用支持 WalletConnect 的 Solana 钱包扫码</p>
      <img :src="wcQrDataUrl" alt="WalletConnect QR" class="qr-img" />
    </div>
    <p v-if="verifyApiBase" class="info">验签模式: 后端安全验签 ({{ verifyApiBase }})</p>
    <p v-else class="info">验签模式: 本地演示验签 (开发模式)</p>

    <div v-if="signature" class="result-block">
      <p class="result-title">签名结果</p>
      <p class="mono">{{ signature }}</p>
    </div>

    <div v-if="message" class="result-block">
      <p class="result-title">签名原文</p>
      <pre>{{ message }}</pre>
    </div>

    <p v-if="recoveredAddress" class="info">恢复出的签名地址: {{ recoveredAddress }}</p>

    <p v-if="verified" class="ok">
      验证通过：签名地址与输入地址一致，证明此地址由扫码钱包控制。
    </p>
    <p v-if="error" class="error">{{ error }}</p>
  </div>
</template>

<script>
import QRCode from "qrcode";
import {
  buildChallenge,
  checksumAddress,
  connectWalletConnect,
  disconnectWalletConnect,
  recoverSignerAddress,
  signMessage
} from "@/utils/walletConnectAuth";
import {
  buildSolanaChallenge,
  connectSolanaWalletConnect,
  disconnectSolanaWalletConnect,
  normalizeSolanaAddress,
  signSolanaMessage,
  verifySolanaSignature
} from "@/utils/walletConnectSolanaAuth";

export default {
  name: "WalletConnectVerify",
  data() {
    return {
      chainType: "evm",
      inputAddress: "",
      connectedAddress: "",
      chainId: null,
      verifyApiBase: process.env.VUE_APP_VERIFY_API_BASE || "",
      wcUri: "",
      wcQrDataUrl: "",
      message: "",
      signature: "",
      recoveredAddress: "",
      verified: false,
      error: "",
      loading: false
    };
  },
  watch: {
    chainType() {
      this.inputAddress = "";
      this.connectedAddress = "";
      this.chainId = null;
      this.wcUri = "";
      this.wcQrDataUrl = "";
      this.resetVerifyResult();
    }
  },
  methods: {
    resetVerifyResult() {
      this.message = "";
      this.signature = "";
      this.recoveredAddress = "";
      this.verified = false;
      this.error = "";
    },
    normalizeAddress(address) {
      if (this.chainType === "solana") {
        return normalizeSolanaAddress(address);
      }
      return checksumAddress(address);
    },
    buildChallengeByChain(address) {
      if (this.chainType === "solana") {
        return buildSolanaChallenge(address);
      }
      return buildChallenge(address);
    },
    async signByChain(message, address) {
      if (this.chainType === "solana") {
        return signSolanaMessage(message, address);
      }
      return signMessage(message);
    },
    verifyLocally(message, signature, inputAddress) {
      if (this.chainType === "solana") {
        const ok = verifySolanaSignature(message, signature, inputAddress);
        return {
          ok,
          recoveredAddress: ok ? inputAddress : ""
        };
      }

      const recovered = this.normalizeAddress(recoverSignerAddress(message, signature));
      return {
        ok: recovered === inputAddress,
        recoveredAddress: recovered
      };
    },
    async requestChallenge(address) {
      if (!this.verifyApiBase) {
        return this.buildChallengeByChain(address);
      }

      const url = `${this.verifyApiBase.replace(/\/$/, "")}/api/wallet/nonce`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, chainType: this.chainType })
      });

      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        throw new Error(data.message || "后端 nonce 获取失败");
      }

      return data.message;
    },
    async verifyOnServer(address, message, signature, recoveredAddress) {
      if (!this.verifyApiBase) {
        return { ok: true };
      }

      const url = `${this.verifyApiBase.replace(/\/$/, "")}/api/wallet/verify`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          address,
          message,
          signature,
          recoveredAddress,
          chainType: this.chainType
        })
      });

      const data = await resp.json();
      if (!resp.ok || !data.ok) {
        throw new Error(data.message || "后端验签失败");
      }

      return data;
    },
    async onConnect() {
      this.loading = true;
      this.error = "";

      try {
        if (this.chainType === "solana") {
          this.wcUri = "";
          this.wcQrDataUrl = "";
          const { address, chainId } = await connectSolanaWalletConnect({
            onUri: uri => {
              this.wcUri = uri;
              QRCode.toDataURL(uri, { width: 280, margin: 1 })
                .then(dataUrl => {
                  this.wcQrDataUrl = dataUrl;
                })
                .catch(() => {
                  this.wcQrDataUrl = "";
                });
            }
          });

          this.connectedAddress = this.normalizeAddress(address);
          this.chainId = chainId;
          return;
        }

        const { address, chainId } = await connectWalletConnect();
        this.connectedAddress = this.normalizeAddress(address);
        this.chainId = chainId;
      } catch (err) {
        this.error = err && err.message ? err.message : "钱包连接失败";
      } finally {
        this.loading = false;
      }
    },
    async onVerify() {
      this.loading = true;
      this.resetVerifyResult();

      try {
        const normalizedInput = this.normalizeAddress(this.inputAddress);
        this.inputAddress = normalizedInput;

        const message = await this.requestChallenge(normalizedInput);
        const signature = await this.signByChain(message, normalizedInput);
        const localResult = this.verifyLocally(message, signature, normalizedInput);

        this.message = message;
        this.signature = signature;
        this.recoveredAddress = localResult.recoveredAddress;
        this.verified = localResult.ok;

        if (!this.verified) {
          this.error = "验证失败：当前扫码钱包并不控制你输入的地址。";
          return;
        }

        await this.verifyOnServer(
          normalizedInput,
          message,
          signature,
          localResult.recoveredAddress
        );
      } catch (err) {
        this.error = err && err.message ? err.message : "签名验证失败";
      } finally {
        this.loading = false;
      }
    },
    async onDisconnect() {
      this.loading = true;

      try {
        if (this.chainType === "solana") {
          await disconnectSolanaWalletConnect();
        } else {
          await disconnectWalletConnect();
        }
      } catch (err) {
        this.error = err && err.message ? err.message : "断开连接失败";
      } finally {
        this.inputAddress = "";
        this.connectedAddress = "";
        this.chainId = null;
        this.wcUri = "";
        this.wcQrDataUrl = "";
        this.resetVerifyResult();
        this.loading = false;
      }
    }
  }
};
</script>

<style scoped>
.wc-verify-card {
  max-width: 720px;
  margin: 24px auto;
  padding: 24px;
  border: 1px solid #d9e3f0;
  border-radius: 12px;
  background: #f8fbff;
  color: #13233a;
}

h2 {
  margin: 0 0 16px;
}

label {
  display: block;
  margin-bottom: 8px;
  font-weight: 600;
}

select,
input {
  width: 100%;
  padding: 10px 12px;
  border: 1px solid #b3c6de;
  border-radius: 8px;
  outline: none;
  font-size: 14px;
  background: #fff;
}

select {
  margin-bottom: 12px;
}

select:focus,
input:focus {
  border-color: #2f6fe4;
}

.actions {
  margin-top: 14px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

button {
  border: 0;
  border-radius: 8px;
  padding: 10px 14px;
  cursor: pointer;
  background: #2f6fe4;
  color: #fff;
  font-weight: 600;
}

button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

button.ghost {
  background: #5f6f83;
}

.info {
  margin-top: 12px;
  word-break: break-all;
}

.result-block {
  margin-top: 12px;
  padding: 10px;
  background: #eef4fd;
  border-radius: 8px;
}

.result-title {
  margin: 0 0 6px;
  font-weight: 700;
}

.qr-img {
  width: 100%;
  max-width: 280px;
  display: block;
}

.mono {
  margin: 0;
  font-family: Consolas, Monaco, monospace;
  word-break: break-all;
}

pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.ok {
  margin-top: 12px;
  color: #0a7a32;
  font-weight: 700;
}

.error {
  margin-top: 12px;
  color: #c02127;
  font-weight: 700;
}
</style>