// MR00100 AI :: demo entrypoint
// Run this from the integrated terminal:  node src/index.js
const os = require("node:os");

function report() {
  const load = os.loadavg()[0].toFixed(2);
  return {
    host: os.hostname(),
    platform: process.platform,
    cores: os.cpus().length,
    load,
  };
}

console.log("MR00100 demo online:", JSON.stringify(report(), null, 2));

module.exports = { report };
