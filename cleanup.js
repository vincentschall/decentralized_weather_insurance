const fs = require("fs");
const path = require("path");
console.log("Cleaning up deployment files...");
const filesToRemove = [
  "contract/deployment-info.json",
  "client/public/deployment-info.json"
];
filesToRemove.forEach(filePath => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`✅ Removed ${filePath}`);
    } else {
      console.log(`ℹ️  ${filePath} does not exist`);
    }
  } catch (error) {
    console.error(`❌ Failed to remove ${filePath}:`, error.message);
  }
});
const hardhatFolders = [
  "contract/cache",
  "contract/artifacts"
];
hardhatFolders.forEach(folderPath => {
  try {
    if (fs.existsSync(folderPath)) {
      fs.rmSync(folderPath, { recursive: true, force: true });
      console.log(`✅ Removed ${folderPath}`);
    } else {
      console.log(`ℹ️  ${folderPath} does not exist`);
    }
  } catch (error) {
    console.error(`❌ Failed to remove ${folderPath}:`, error.message);
  }
});
console.log("Cleanup complete!");
