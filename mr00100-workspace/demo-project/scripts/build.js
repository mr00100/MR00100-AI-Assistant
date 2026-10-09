const fs = require("node:fs");
const path = require("node:path");

const out = path.join(__dirname, "..", "dist");
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, "build.txt"), "built " + new Date().toISOString());
console.log("build complete ->", path.relative(process.cwd(), out));
