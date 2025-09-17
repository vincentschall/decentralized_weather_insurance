const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
function run(command, args, options = {}) {
  return spawn(command, args, { stdio: "inherit", shell: true, ...options});
}
console.log("Starting Hardhat node...");
const hardhat = spawn("npx", ["hardhat", "node"], {
  cwd: "contract",
  shell: true,
});
process.on("SIGINT", () => {
  console.log("\n Stopping Hardhat node...");
  hardhat.kill("SIGTERM");
  process.exit();
});
setTimeout(() => {
  console.log("Running deploy script...");
  const deploy = run("npx", ["hardhat", "run", "scripts/deploy-for-testing.js", "--network", "localhost"], {
    cwd: "contract",
  });
  deploy.on("close", (code) => {
    if (code !== 0) {
      console.error(`Deploy script failed with exit code ${code}`);
      process.exit(code);
    }
    try {
      const sourcePath = path.join("contract", "deployment-info.json");
      const destPath = path.join("client", "public", "deployment-info.json");
      const publicDir = path.join("client", "public");
      if (!fs.existsSync(publicDir)) {
        fs.mkdirSync(publicDir, { recursive: true });
      }
      fs.copyFileSync(sourcePath, destPath);
      console.log("Copied deployment-info.json to client/public/");
    } catch (error) {
      console.error("Failed to copy deployment-info.json:", error.message);
    }
    console.log("Starting frontend...");
    run("npm", ["start"], { cwd: "client" });
  });
}, 5000);
