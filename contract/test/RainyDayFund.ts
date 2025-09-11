import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUnits, getAddress } from "viem";
import { network } from "hardhat";

describe("RainyDayFund", async function () {
  const { viem } = await network.connect();
  const publicClient = await viem.getPublicClient();
  const [deployer, farmer, investor] = await viem.getWalletClients();

  it("Should deploy both contracts and initialize correctly", async function () {
    // Deploy MockUSDC first
    const mockUSDC = await viem.deployContract("MockUSDC");

    // Deploy RainyDayFund with MockUSDC address
    const rainyDayFund = await viem.deployContract("RainyDayFund", [mockUSDC.address]);

    // Check initial state
    const owner = await rainyDayFund.read.owner();
    const riskPoolBalance = await rainyDayFund.read.riskPoolBalance();
    const totalPolicies = await rainyDayFund.read.getTotalPolicies();

    assert.equal(getAddress(owner), getAddress(deployer.account.address));
    assert.equal(riskPoolBalance, 0n);
    assert.equal(totalPolicies, 0n);
  });

  it("Should allow farmer to buy a basic policy", async function () {
    // Deploy contracts
    const mockUSDC = await viem.deployContract("MockUSDC");
    const rainyDayFund = await viem.deployContract("RainyDayFund", [mockUSDC.address]);

    // Give farmer some USDC
    await mockUSDC.write.mint([farmer.account.address, parseUnits("1000", 6)]);

    // Get basic policy premium
    const premium = await rainyDayFund.read.getPolicyPricing([0]); // BASIC = 0

    // Farmer approves and buys policy
    await mockUSDC.write.approve([rainyDayFund.address, premium], { account: farmer.account });
    const tokenId = await rainyDayFund.write.buyPolicy([0], { account: farmer.account });

    // Check results
    const tokenOwner = await rainyDayFund.read.ownerOf([1n]);
    const riskPoolBalance = await rainyDayFund.read.riskPoolBalance();
    const farmerTokens = await rainyDayFund.read.getFarmerTokens([farmer.account.address]);

    assert.equal(getAddress(tokenOwner), getAddress(farmer.account.address));
    assert.equal(riskPoolBalance, premium);
    assert.equal(farmerTokens.length, 1);
    assert.equal(farmerTokens[0], 1n);
  });

  it("Should allow investor to invest in risk pool", async function () {
    // Deploy contracts
    const mockUSDC = await viem.deployContract("MockUSDC");
    const rainyDayFund = await viem.deployContract("RainyDayFund", [mockUSDC.address]);

    // Give investor some USDC
    const investmentAmount = parseUnits("5000", 6); // 5000 USDC
    await mockUSDC.write.mint([investor.account.address, investmentAmount]);

    // Investor approves and invests
    await mockUSDC.write.approve([rainyDayFund.address, investmentAmount], { account: investor.account });
    await rainyDayFund.write.invest([investmentAmount], { account: investor.account });

    // Check results
    const userInvestments = await rainyDayFund.read.getUserInvestments([investor.account.address]);
    const riskPoolBalance = await rainyDayFund.read.riskPoolBalance();

    assert.equal(userInvestments, investmentAmount);
    assert.equal(riskPoolBalance, investmentAmount);
  });
});
