<template>
  <div id="app">
    <WalletConnectVerify />
  </div>
</template>

<script>
import WalletConnectVerify from "@/components/WalletConnectVerify.vue";

export default {
  name: "App",
  components: {
    WalletConnectVerify
  }
};
</script>

<style>
body {
  margin: 0;
  font-family: "Microsoft YaHei", sans-serif;
  background: #f2f6fb;
}

#app {
  min-height: 100vh;
  padding: 20px;
}
</style>
