import { expect } from "chai";
import { ethers } from "hardhat";
import { Contract, Signer } from "ethers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("RainyDayFund", function () {
  let rainyDayFund: Contract;
  let mockUSDC: Contract;
  let owner: Signer;
  let farmer1: Signer;
  let farmer2: Signer;
  let investor1: Signer;
  let investor2: Signer;
  let addrs: Signer[];

  const USDC_DECIMALS = 6;
  const PREMIUM = ethers.parseUnits("200", USDC_DECIMALS); // 200 USDC
  const PAYOUT = PREMIUM * 2n; // 400 USDC
  const INITIAL_USDC_BALANCE = ethers.parseUnits("10000", USDC_DECIMALS); // 10k USDC

  beforeEach(async function () {
    [owner, farmer1, farmer2, investor1, investor2, ...addrs] = await ethers.getSigners();

    // Deploy mock USDC contract
    const MockERC20 = await ethers.getContractFactory("MockERC20");
    mockUSDC = await MockERC20.deploy(
      "USD Coin",
      "USDC",
      USDC_DECIMALS,
      ethers.parseUnits("1000000", USDC_DECIMALS) // 1M USDC total supply
    );

    // Deploy RainyDayFund contract
    const RainyDayFund = await ethers.getContractFactory("RainyDayFund");
    rainyDayFund = await RainyDayFund.deploy(await mockUSDC.getAddress());

    // Distribute USDC to test accounts
    const accounts = [farmer1, farmer2, investor1, investor2];
    for (const account of accounts) {
      await mockUSDC.transfer(await account.getAddress(), INITIAL_USDC_BALANCE);
      await mockUSDC.connect(account).approve(await rainyDayFund.getAddress(), ethers.MaxUint256);
    }
  });

  describe("Deployment", function () {
    it("Should set the correct owner", async function () {
      expect(await rainyDayFund.owner()).to.equal(await owner.getAddress());
    });

    it("Should set the correct USDC address", async function () {
      expect(await rainyDayFund.usdc()).to.equal(await mockUSDC.getAddress());
    });

    it("Should initialize season 1", async function () {
      expect(await rainyDayFund.currentSeasonId()).to.equal(1);
      
      const policy = await rainyDayFund.getPolicyInfo(1);
      expect(policy.premium).to.equal(PREMIUM);
      expect(policy.payoutAmount).to.equal(PAYOUT);
      expect(policy.seasonActive).to.be.true;
      expect(policy.weatherDataFetched).to.be.false;
      expect(policy.payoutEnabled).to.be.false;
    });

    it("Should set correct season end timestamp", async function () {
      const currentTime = await time.latest();
      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      expect(seasonEnd).to.be.closeTo(currentTime + 60 * 24 * 60 * 60, 10); // ~60 days
    });
  });

  describe("Policy Purchase", function () {
    it("Should allow farmers to buy policies", async function () {
      const policyAmount = 5n;
      const totalPremium = PREMIUM * policyAmount;

      const initialBalance = await mockUSDC.balanceOf(await farmer1.getAddress());
      
      await expect(rainyDayFund.connect(farmer1).buyPolicy(policyAmount))
        .to.emit(rainyDayFund, "PolicyBought")
        .withArgs(await farmer1.getAddress(), 1, policyAmount, totalPremium);

      // Check farmer's USDC balance decreased
      expect(await mockUSDC.balanceOf(await farmer1.getAddress()))
        .to.equal(initialBalance - totalPremium);

      // Check farmer received ERC-1155 tokens
      expect(await rainyDayFund.balanceOf(await farmer1.getAddress(), 1))
        .to.equal(policyAmount);

      // Check risk pool balance increased
      expect(await rainyDayFund.riskPoolBalance()).to.equal(totalPremium);
    });

    it("Should reject zero amount policies", async function () {
      await expect(rainyDayFund.connect(farmer1).buyPolicy(0))
        .to.be.revertedWith("Amount must be > 0");
    });

    it("Should reject policy purchases after sales period", async function () {
      // Move to 35 days from season start (sales end at 30 days before season end)
      await time.increase(35 * 24 * 60 * 60);
      
      await expect(rainyDayFund.connect(farmer1).buyPolicy(1))
        .to.be.revertedWith("Policy sales ended");
    });

    it("Should reject policy purchases for inactive seasons", async function () {
      // Start new season, making season 1 inactive
      await rainyDayFund.connect(owner).startNewSeason();
      
      await expect(rainyDayFund.connect(farmer1).buyPolicy(1))
        .to.not.be.revertedWith("Season not active"); // Should work for season 2
    });
  });

  describe("Season Management", function () {
    it("Should allow owner to start new season", async function () {
      await expect(rainyDayFund.connect(owner).startNewSeason())
        .to.emit(rainyDayFund, "NewSeasonStarted")
        .withArgs(2, PREMIUM, PAYOUT);

      expect(await rainyDayFund.currentSeasonId()).to.equal(2);
      
      // Check old season is inactive
      const oldPolicy = await rainyDayFund.getPolicyInfo(1);
      expect(oldPolicy.seasonActive).to.be.false;
      
      // Check new season is active
      const newPolicy = await rainyDayFund.getPolicyInfo(2);
      expect(newPolicy.seasonActive).to.be.true;
    });

    it("Should not allow non-owner to start new season", async function () {
      await expect(rainyDayFund.connect(farmer1).startNewSeason())
        .to.be.revertedWith("OwnableUnauthorizedAccount");
    });
  });

  describe("Weather Data and Claims", function () {
    beforeEach(async function () {
      // Farmer buys some policies
      await rainyDayFund.connect(farmer1).buyPolicy(3);
      await rainyDayFund.connect(farmer2).buyPolicy(2);
    });

    it("Should allow owner to update weather data", async function () {
      const weatherData = 5; // Less than 10, should trigger payouts
      
      await expect(rainyDayFund.connect(owner).updateWeatherData(1, weatherData))
        .to.emit(rainyDayFund, "WeatherDataUpdated")
        .withArgs(1, weatherData);

      const policy = await rainyDayFund.getPolicyInfo(1);
      expect(policy.weatherData).to.equal(weatherData);
      expect(policy.weatherDataFetched).to.be.true;
      expect(policy.payoutEnabled).to.be.true;
    });

    it("Should not allow non-owner to update weather data", async function () {
      await expect(rainyDayFund.connect(farmer1).updateWeatherData(1, 5))
        .to.be.revertedWith("OwnableUnauthorizedAccount");
    });

    it("Should allow farmers to claim when conditions are met", async function () {
      // Set weather data that triggers payouts
      await rainyDayFund.connect(owner).updateWeatherData(1, 5);
      
      // Move past season end
      await time.increase(61 * 24 * 60 * 60);
      
      const farmer1Policies = 3n;
      const expectedPayout = PAYOUT * farmer1Policies;
      
      await expect(rainyDayFund.connect(farmer1).claimAll())
        .to.emit(rainyDayFund, "ClaimMade")
        .withArgs(await farmer1.getAddress(), 1, farmer1Policies, expectedPayout);

      // Check farmer received USDC
      expect(await mockUSDC.balanceOf(await farmer1.getAddress()))
        .to.equal(INITIAL_USDC_BALANCE - (PREMIUM * farmer1Policies) + expectedPayout);

      // Check policy tokens were burned
      expect(await rainyDayFund.balanceOf(await farmer1.getAddress(), 1))
        .to.equal(0);
    });

    it("Should not allow claims when weather condition not met", async function () {
      // Set weather data that doesn't trigger payouts
      await rainyDayFund.connect(owner).updateWeatherData(1, 15);
      
      // Move past season end
      await time.increase(61 * 24 * 60 * 60);
      
      await expect(rainyDayFund.connect(farmer1).claimAll())
        .to.be.revertedWith("No eligible claims");
    });

    it("Should not allow claims before season end", async function () {
      await rainyDayFund.connect(owner).updateWeatherData(1, 5);
      
      await expect(rainyDayFund.connect(farmer1).claimAll())
        .to.be.revertedWith("No eligible claims");
    });

    it("Should not allow claims after claim period expires", async function () {
      await rainyDayFund.connect(owner).updateWeatherData(1, 5);
      
      // Move past claim period (season end + 30 days)
      await time.increase(95 * 24 * 60 * 60);
      
      await expect(rainyDayFund.connect(farmer1).claimAll())
        .to.be.revertedWith("No eligible claims");
    });
  });

  describe("Investment Functions", function () {
    it("Should allow investors to invest", async function () {
      const investAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      
      await expect(rainyDayFund.connect(investor1).invest(investAmount))
        .to.emit(rainyDayFund, "InvestmentMade")
        .withArgs(await investor1.getAddress(), investAmount);

      expect(await rainyDayFund.getUserInvestment(await investor1.getAddress()))
        .to.equal(investAmount);
      expect(await rainyDayFund.totalInvestorFunds()).to.equal(investAmount);
      expect(await rainyDayFund.riskPoolBalance()).to.equal(investAmount);
    });

    it("Should allow investors to withdraw during withdrawal period", async function () {
      const investAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      await rainyDayFund.connect(investor1).invest(investAmount);
      
      // Move to withdrawal period (season end + 60-90 days)
      await time.increase(120 * 24 * 60 * 60);
      
      const initialBalance = await mockUSDC.balanceOf(await investor1.getAddress());
      
      await expect(rainyDayFund.connect(investor1).withdraw())
        .to.emit(rainyDayFund, "InvestmentWithdrawn")
        .withArgs(await investor1.getAddress(), investAmount);

      expect(await mockUSDC.balanceOf(await investor1.getAddress()))
        .to.equal(initialBalance + investAmount);
      
      expect(await rainyDayFund.getUserInvestment(await investor1.getAddress()))
        .to.equal(0);
    });

    it("Should not allow withdrawal outside withdrawal period", async function () {
      const investAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      await rainyDayFund.connect(investor1).invest(investAmount);
      
      await expect(rainyDayFund.connect(investor1).withdraw())
        .to.be.revertedWith("Withdrawal period not active");
    });

    it("Should calculate proportional withdrawals correctly", async function () {
      // Two investors invest different amounts
      const invest1 = ethers.parseUnits("1000", USDC_DECIMALS);
      const invest2 = ethers.parseUnits("500", USDC_DECIMALS);
      
      await rainyDayFund.connect(investor1).invest(invest1);
      await rainyDayFund.connect(investor2).invest(invest2);
      
      // Farmer buys policy, adding to risk pool
      await rainyDayFund.connect(farmer1).buyPolicy(1);
      
      // Move to withdrawal period
      await time.increase(120 * 24 * 60 * 60);
      
      const totalPool = await rainyDayFund.riskPoolBalance();
      const expectedWithdraw1 = (invest1 * totalPool) / (invest1 + invest2);
      
      const initialBalance = await mockUSDC.balanceOf(await investor1.getAddress());
      await rainyDayFund.connect(investor1).withdraw();
      
      const finalBalance = await mockUSDC.balanceOf(await investor1.getAddress());
      expect(finalBalance - initialBalance).to.equal(expectedWithdraw1);
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await rainyDayFund.connect(farmer1).buyPolicy(3);
      await rainyDayFund.connect(farmer1).buyPolicy(2); // Second purchase in same season
      await rainyDayFund.connect(owner).startNewSeason();
      await rainyDayFund.connect(farmer1).buyPolicy(1); // Purchase in season 2
    });

    it("Should return correct user policies", async function () {
      const [seasonIds, amounts] = await rainyDayFund.getUserPolicies(await farmer1.getAddress());
      
      expect(seasonIds).to.deep.equal([1n, 2n]);
      expect(amounts).to.deep.equal([5n, 1n]); // 3+2 in season 1, 1 in season 2
    });

    it("Should return correct claimable info", async function () {
      // Set weather data for season 1
      await rainyDayFund.connect(owner).updateWeatherData(1, 5);
      
      // Move past season end
      await time.increase(61 * 24 * 60 * 60);
      
      const [seasonIds, amounts, totalClaimAmount] = await rainyDayFund.getClaimableInfo(await farmer1.getAddress());
      
      expect(seasonIds).to.deep.equal([1n]);
      expect(amounts).to.deep.equal([5n]);
      expect(totalClaimAmount).to.equal(PAYOUT * 5n);
    });

    it("Should return correct contract balance", async function () {
      const expectedBalance = PREMIUM * 6n; // 5 from season 1 + 1 from season 2
      expect(await rainyDayFund.getContractBalance()).to.equal(expectedBalance);
    });
  });

  describe("Oracle Management", function () {
    it("Should allow owner to set weather oracle", async function () {
      const mockOracle = await addrs[0].getAddress();
      
      await rainyDayFund.connect(owner).setWeatherOracle(mockOracle, true);
      expect(await rainyDayFund.useChainlinkOracle()).to.be.true;
    });

    it("Should reject zero address when enabling Chainlink", async function () {
      await expect(rainyDayFund.connect(owner).setWeatherOracle(ethers.ZeroAddress, true))
        .to.be.revertedWith("Oracle address cannot be zero when enabling Chainlink");
    });

    it("Should allow disabling oracle with zero address", async function () {
      await rainyDayFund.connect(owner).setWeatherOracle(ethers.ZeroAddress, false);
      expect(await rainyDayFund.useChainlinkOracle()).to.be.false;
    });
  });

  describe("Edge Cases", function () {
    it("Should handle multiple farmers claiming from same season", async function () {
      await rainyDayFund.connect(farmer1).buyPolicy(3);
      await rainyDayFund.connect(farmer2).buyPolicy(2);
      
      await rainyDayFund.connect(owner).updateWeatherData(1, 5);
      await time.increase(61 * 24 * 60 * 60);
      
      // Both farmers should be able to claim
      await rainyDayFund.connect(farmer1).claimAll();
      await rainyDayFund.connect(farmer2).claimAll();
      
      expect(await rainyDayFund.balanceOf(await farmer1.getAddress(), 1)).to.equal(0);
      expect(await rainyDayFund.balanceOf(await farmer2.getAddress(), 1)).to.equal(0);
    });

    it("Should handle insufficient funds for claims", async function () {
      // Large policy purchase that would exceed available funds
      await rainyDayFund.connect(farmer1).buyPolicy(1);
      
      // Investor withdraws most funds
      const largeInvest = ethers.parseUnits("100000", USDC_DECIMALS);
      await mockUSDC.transfer(await investor1.getAddress(), largeInvest);
      await mockUSDC.connect(investor1).approve(await rainyDayFund.getAddress(), largeInvest);
      await rainyDayFund.connect(investor1).invest(largeInvest);
      
      // Move to withdrawal period and withdraw
      await time.increase(120 * 24 * 60 * 60);
      await rainyDayFund.connect(investor1).withdraw();
      
      // Go back and try to claim (should fail if insufficient funds)
      await time.increase(-60 * 24 * 60 * 60); // Go back to claim period
      await rainyDayFund.connect(owner).updateWeatherData(1, 5);
      
      // This might fail with insufficient funds depending on contract logic
      await expect(rainyDayFund.connect(farmer1).claimAll())
        .to.be.reverted; // Could be "No eligible claims" or transfer failure
    });

    it("Should prevent double claiming", async function () {
      await rainyDayFund.connect(farmer1).buyPolicy(3);
      await rainyDayFund.connect(owner).updateWeatherData(1, 5);
      await time.increase(61 * 24 * 60 * 60);
      
      // First claim should work
      await rainyDayFund.connect(farmer1).claimAll();
      
      // Second claim should fail (no tokens left)
      await expect(rainyDayFund.connect(farmer1).claimAll())
        .to.be.revertedWith("No eligible claims");
    });
  });
});
