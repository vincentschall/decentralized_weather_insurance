// scripts/deploy-for-testing.js
// Run this with: npx hardhat run scripts/deploy-for-testing.js --network localhost

const { ethers } = require("hardhat");

async function main() {
  console.log("🚀 Deploying contracts for frontend testing...");
  
  // Get signers
  const [owner, farmer1, farmer2, investor1, investor2, ...others] = await ethers.getSigners();
  
  console.log("Deploying with accounts:");
  console.log("Owner:", owner.address);
  console.log("Farmer1:", farmer1.address);
  console.log("Farmer2:", farmer2.address);
  console.log("Investor1:", investor1.address);
  console.log("Investor2:", investor2.address);

  // Deploy MockUSDC
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy();
  await mockUSDC.waitForDeployment();
  console.log("✅ MockUSDC deployed to:", await mockUSDC.getAddress());

  // Deploy MockWeatherOracle with initial bad weather
  const MockWeatherOracle = await ethers.getContractFactory("MockWeatherOracle");
  const mockWeatherOracle = await MockWeatherOracle.deploy(5);
  await mockWeatherOracle.waitForDeployment();
  console.log("✅ MockWeatherOracle deployed to:", await mockWeatherOracle.getAddress());

  // Deploy RainyDayFund
  const RainyDayFund = await ethers.getContractFactory("RainyDayFund");
  const rainyDayFund = await RainyDayFund.deploy(
    await mockUSDC.getAddress(),
    await mockWeatherOracle.getAddress()
  );
  await rainyDayFund.waitForDeployment();
  console.log("✅ RainyDayFund deployed to:", await rainyDayFund.getAddress());

  // Mint USDC to test accounts
  const initialBalance = ethers.parseUnits("10000", 6); // 10,000 USDC
  await mockUSDC.mint(farmer1.address, initialBalance);
  await mockUSDC.mint(farmer2.address, initialBalance);
  await mockUSDC.mint(investor1.address, initialBalance);
  await mockUSDC.mint(investor2.address, initialBalance);
  console.log("✅ USDC minted to test accounts");

  // Set approvals
  const maxApproval = ethers.MaxUint256;
  await mockUSDC.connect(farmer1).approve(await rainyDayFund.getAddress(), maxApproval);
  await mockUSDC.connect(farmer2).approve(await rainyDayFund.getAddress(), maxApproval);
  await mockUSDC.connect(investor1).approve(await rainyDayFund.getAddress(), maxApproval);
  await mockUSDC.connect(investor2).approve(await rainyDayFund.getAddress(), maxApproval);
  console.log("✅ Approvals set");

  // Save deployment info for frontend
  const deploymentInfo = {
    network: "localhost",
    contracts: {
      MockUSDC: await mockUSDC.getAddress(),
      MockWeatherOracle: await mockWeatherOracle.getAddress(),
      RainyDayFund: await rainyDayFund.getAddress()
    },
    accounts: {
      owner: owner.address,
      farmer1: farmer1.address,
      farmer2: farmer2.address,
      investor1: investor1.address,
      investor2: investor2.address
    }
  };

  console.log("\n📋 Deployment Summary:");
  console.log(JSON.stringify(deploymentInfo, null, 2));
  
  // Save to file for frontend to read
  const fs = require("fs");
  fs.writeFileSync("./deployment-info.json", JSON.stringify(deploymentInfo, null, 2));
  console.log("✅ Deployment info saved to deployment-info.json");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
