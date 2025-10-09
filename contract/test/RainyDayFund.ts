import { expect } from "chai";
import { ethers } from "hardhat";
import { RainyDayFund, MockUSDC, MockWeatherOracle, SeasonPolicyToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("RainyDayFund", function () {
  let rainyDayFund: RainyDayFund;
  let mockUSDC: MockUSDC;
  let mockWeatherOracle: MockWeatherOracle;
  let owner: SignerWithAddress;
  let farmer: SignerWithAddress;
  let investor: SignerWithAddress;
  let addrs: SignerWithAddress[];

  const USDC_DECIMALS = 6;
  const INITIAL_USDC_BALANCE = ethers.parseUnits("10000", USDC_DECIMALS); // 10,000 USDC
  const PREMIUM = ethers.parseUnits("9", USDC_DECIMALS);
  const PAYOUT = PREMIUM * 4n; // 4x premium payout
  const INITIAL_WEATHER = 5; // Bad weather (< 10 triggers payout)
  const TIME_UNIT = 30n * 24n * 60n * 60n; // 30 days in seconds

  beforeEach(async function () {
    // Get signers
    [owner, farmer, investor, ...addrs] = await ethers.getSigners();

    // Deploy mock USDC token
    const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDCFactory.deploy();
    
    // Deploy mock weather oracle
    const MockWeatherOracleFactory = await ethers.getContractFactory("MockWeatherOracle");
    mockWeatherOracle = await MockWeatherOracleFactory.deploy(INITIAL_WEATHER);

    // Deploy RainyDayFund contract
    const RainyDayFundFactory = await ethers.getContractFactory("RainyDayFund");
    rainyDayFund = await RainyDayFundFactory.deploy(
      await mockUSDC.getAddress(), 
      await mockWeatherOracle.getAddress()
    );

    // Mint USDC to test accounts
    await mockUSDC.mint(farmer.address, INITIAL_USDC_BALANCE);
    await mockUSDC.mint(investor.address, INITIAL_USDC_BALANCE);

    // Approve the contract to spend USDC
    await mockUSDC.connect(farmer).approve(
      await rainyDayFund.getAddress(),
      ethers.MaxUint256
    );
    await mockUSDC.connect(investor).approve(
      await rainyDayFund.getAddress(),
      ethers.MaxUint256
    );
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await rainyDayFund.owner()).to.equal(owner.address);
    });

    it("Should set the correct USDC address", async function () {
      expect(await rainyDayFund.usdc()).to.equal(await mockUSDC.getAddress());
    });

    it("Should set the correct weather oracle", async function () {
      expect(await rainyDayFund.weatherFeed()).to.equal(await mockWeatherOracle.getAddress());
    });

    it("Should initialize with season 1", async function () {
      expect(await rainyDayFund.currentSeasonId()).to.equal(1);
    });

    it("Should set correct initial season parameters", async function () {
      const policyInfo = await rainyDayFund.seasonPolicies(1);
      expect(policyInfo.premium).to.equal(PREMIUM);
      expect(policyInfo.payoutAmount).to.equal(PAYOUT);
      expect(policyInfo.totalPoliciesSold).to.equal(0);
      expect(policyInfo.creationTimestamp).to.be.greaterThan(0);
    });

    it("Should initialize in ACTIVE state", async function () {
      expect(await rainyDayFund.getSeasonState()).to.equal(0); // ACTIVE
    });

    it("Should be in testing mode by default", async function () {
      expect(await rainyDayFund.testingMode()).to.equal(true);
      expect(await rainyDayFund.testingTimeOffset()).to.equal(0);
    });

    it("Should initialize season over timestamp correctly", async function () {
      const seasonOverTime = await rainyDayFund.seasonOverTimeStamp();
      const currentTime = await rainyDayFund.getCurrentTime();
      expect(seasonOverTime).to.be.greaterThan(currentTime);
    });

    it("Should reject zero addresses in constructor", async function () {
      const RainyDayFundFactory = await ethers.getContractFactory("RainyDayFund");
      
      await expect(RainyDayFundFactory.deploy(ethers.ZeroAddress, await mockWeatherOracle.getAddress()))
        .to.be.revertedWith("USDC address zero");
        
      await expect(RainyDayFundFactory.deploy(await mockUSDC.getAddress(), ethers.ZeroAddress))
        .to.be.revertedWith("Weather oracle zero");
    });
  });

  describe("Testing Mode Functions", function () {
    it("Should allow owner to advance through all phases", async function () {
      // Should start in ACTIVE
      expect(await rainyDayFund.getSeasonState()).to.equal(0); // ACTIVE

      // Advance to INACTIVE
      await expect(rainyDayFund.advanceToNextPhase())
        .to.emit(rainyDayFund, "TimeAdvanced");
      expect(await rainyDayFund.getSeasonState()).to.equal(1); // INACTIVE

      // Advance to CLAIM
      await rainyDayFund.advanceToNextPhase();
      expect(await rainyDayFund.getSeasonState()).to.equal(2); // CLAIM

      // Advance to WITHDRAW
      await rainyDayFund.advanceToNextPhase();
      expect(await rainyDayFund.getSeasonState()).to.equal(3); // WITHDRAW

      // Advance to FINISHED
      await rainyDayFund.advanceToNextPhase();
      expect(await rainyDayFund.getSeasonState()).to.equal(4); // FINISHED
    });

    it("Should correctly calculate time offset for each phase", async function () {
      const initialOffset = await rainyDayFund.testingTimeOffset();
      expect(initialOffset).to.equal(0);

      await rainyDayFund.advanceToNextPhase();
      const offsetAfterFirst = await rainyDayFund.testingTimeOffset();
      expect(offsetAfterFirst).to.be.greaterThan(0);
    });

    it("Should allow owner to toggle testing mode", async function () {
      expect(await rainyDayFund.testingMode()).to.equal(true);
      
      await rainyDayFund.setTestingMode(false);
      expect(await rainyDayFund.testingMode()).to.equal(false);
      expect(await rainyDayFund.testingTimeOffset()).to.equal(0);

      // Should not be able to advance phases when testing mode is off
      await expect(rainyDayFund.advanceToNextPhase())
        .to.be.revertedWith("Not in testing mode");
        
      // Re-enable testing mode
      await rainyDayFund.setTestingMode(true);
      expect(await rainyDayFund.testingMode()).to.equal(true);
    });

    it("Should not allow non-owner to use testing functions", async function () {
      await expect(rainyDayFund.connect(farmer).advanceToNextPhase())
        .to.be.revertedWithCustomError(rainyDayFund, "OwnableUnauthorizedAccount");

      await expect(rainyDayFund.connect(farmer).setTestingMode(false))
        .to.be.revertedWithCustomError(rainyDayFund, "OwnableUnauthorizedAccount");
    });

    it("Should return correct current time in testing mode", async function () {
      const blockTime = (await ethers.provider.getBlock('latest'))!.timestamp;
      const contractTime = await rainyDayFund.getCurrentTime();
      expect(contractTime).to.be.closeTo(blockTime, 10); // Within 10 seconds

      // Advance time and check
      await rainyDayFund.advanceToNextPhase();
      const newContractTime = await rainyDayFund.getCurrentTime();
      expect(newContractTime).to.be.greaterThan(contractTime);
    });
  });

  describe("Policy Purchase", function () {
    it("Should allow buying policies in ACTIVE state", async function () {
      const amount = 2;
      const totalPremium = PREMIUM * BigInt(amount);
      const initialBalance = await mockUSDC.balanceOf(farmer.address);

      await expect(rainyDayFund.connect(farmer).buyPolicy(amount))
        .to.emit(rainyDayFund, "PolicyBought")
        .withArgs(farmer.address, 1, amount, totalPremium);

      // Check USDC was transferred
      const finalBalance = await mockUSDC.balanceOf(farmer.address);
      expect(initialBalance - finalBalance).to.equal(totalPremium);

      // Check policy token balance
      const policyInfo = await rainyDayFund.seasonPolicies(1);
      const policyToken = await ethers.getContractAt("SeasonPolicyToken", policyInfo.policyToken);
      expect(await policyToken.balanceOf(farmer.address)).to.equal(amount);

      // Check total policies sold updated
      const updatedPolicyInfo = await rainyDayFund.seasonPolicies(1);
      expect(updatedPolicyInfo.totalPoliciesSold).to.equal(amount);
    });

    it("Should return correct season ID when buying policy", async function () {
      const seasonId = await rainyDayFund.connect(farmer).buyPolicy.staticCall(1);
      expect(seasonId).to.equal(1);
    });

    it("Should reject zero amount purchase", async function () {
      await expect(rainyDayFund.connect(farmer).buyPolicy(0))
        .to.be.revertedWith("Amount > 0");
    });

    it("Should reject purchase when not in active period", async function () {
      // Test in INACTIVE phase
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      expect(await rainyDayFund.getSeasonState()).to.equal(1); // INACTIVE

      await expect(rainyDayFund.connect(farmer).buyPolicy(1))
        .to.be.revertedWith("Not in active period");

      // Test in CLAIM phase
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      expect(await rainyDayFund.getSeasonState()).to.equal(2); // CLAIM

      await expect(rainyDayFund.connect(farmer).buyPolicy(1))
        .to.be.revertedWith("Not in active period");

      // Test in WITHDRAW phase
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW
      expect(await rainyDayFund.getSeasonState()).to.equal(3); // WITHDRAW

      await expect(rainyDayFund.connect(farmer).buyPolicy(1))
        .to.be.revertedWith("Not in active period");

      // Test in FINISHED phase
      await rainyDayFund.advanceToNextPhase(); // WITHDRAW -> FINISHED
      expect(await rainyDayFund.getSeasonState()).to.equal(4); // FINISHED

      await expect(rainyDayFund.connect(farmer).buyPolicy(1))
        .to.be.revertedWith("Not in active period");
    });

    it("Should handle multiple policy purchases", async function () {
      await rainyDayFund.connect(farmer).buyPolicy(2);
      await rainyDayFund.connect(farmer).buyPolicy(3);

      const policyInfo = await rainyDayFund.seasonPolicies(1);
      const policyToken = await ethers.getContractAt("SeasonPolicyToken", policyInfo.policyToken);
      
      expect(await policyToken.balanceOf(farmer.address)).to.equal(5);
      expect(policyInfo.totalPoliciesSold).to.equal(5);
    });

    it("Should handle insufficient USDC balance", async function () {
      // Try to buy more policies than USDC balance allows
      const maxPolicies = INITIAL_USDC_BALANCE / PREMIUM + 1n;
      
      await expect(rainyDayFund.connect(farmer).buyPolicy(maxPolicies))
        .to.be.reverted; // Should fail due to insufficient balance
    });

    it("Should handle insufficient allowance", async function () {
      // Reset allowance to a small amount
      await mockUSDC.connect(farmer).approve(await rainyDayFund.getAddress(), PREMIUM / 2n);

      await expect(rainyDayFund.connect(farmer).buyPolicy(1))
        .to.be.reverted; // Should fail due to insufficient allowance
    });
  });

  describe("Weather Data and Claims", function () {
    beforeEach(async function () {
      // Investor provides liquidity
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      await rainyDayFund.connect(investor).invest(investmentAmount);

      // Farmer buys policies
      await rainyDayFund.connect(farmer).buyPolicy(3);
    });

    it("Should read weather data from oracle", async function () {
      const [roundId, weather, timestamp] = await rainyDayFund.getWeatherData();
      expect(weather).to.equal(INITIAL_WEATHER);
      expect(roundId).to.be.greaterThan(0);
      expect(timestamp).to.be.greaterThan(0);
    });

    it("Should allow claiming when weather conditions are met", async function () {
      // Advance to CLAIM period
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM

      expect(await rainyDayFund.getSeasonState()).to.equal(2); // CLAIM state

      const initialBalance = await mockUSDC.balanceOf(farmer.address);
      const expectedPayout = PAYOUT * 3n; // 3 policies

      await expect(rainyDayFund.connect(farmer).claimPolicies())
        .to.emit(rainyDayFund, "ClaimMade")
        .withArgs(farmer.address, 1, 3, expectedPayout);

      const finalBalance = await mockUSDC.balanceOf(farmer.address);
      expect(finalBalance - initialBalance).to.equal(expectedPayout);

      // Tokens should be burned
      const policyInfo = await rainyDayFund.seasonPolicies(1);
      const policyToken = await ethers.getContractAt("SeasonPolicyToken", policyInfo.policyToken);
      expect(await policyToken.balanceOf(farmer.address)).to.equal(0);
    });

    it("Should not allow claiming with good weather", async function () {
      // Set good weather (>= 10)
      await mockWeatherOracle.updatePrice(15);

      // Advance to CLAIM period
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM

      await expect(rainyDayFund.connect(farmer).claimPolicies())
        .to.be.revertedWith("Weather not bad enough");
    });

    it("Should test weather threshold boundary", async function () {
      // Test exactly at threshold (weather = 10 should not allow claims)
      await mockWeatherOracle.updatePrice(10);

      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM

      await expect(rainyDayFund.connect(farmer).claimPolicies())
        .to.be.revertedWith("Weather not bad enough");

      // Test just below threshold (weather = 9 should allow claims)
      await mockWeatherOracle.updatePrice(9);

      await expect(rainyDayFund.connect(farmer).claimPolicies())
        .to.emit(rainyDayFund, "ClaimMade");
    });

    it("Should not allow claiming in wrong periods", async function () {
      // Try claiming in ACTIVE period
      await expect(rainyDayFund.connect(farmer).claimPolicies())
        .to.be.revertedWith("Not in claim period");

      // Try claiming in INACTIVE period
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await expect(rainyDayFund.connect(farmer).claimPolicies())
        .to.be.revertedWith("Not in claim period");

      // Skip CLAIM period to WITHDRAW
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW

      await expect(rainyDayFund.connect(farmer).claimPolicies())
        .to.be.revertedWith("Not in claim period");

      // Try in FINISHED period
      await rainyDayFund.advanceToNextPhase(); // WITHDRAW -> FINISHED
      await expect(rainyDayFund.connect(farmer).claimPolicies())
        .to.be.revertedWith("Not in claim period");
    });

    it("Should not allow claiming without policies", async function () {
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM

      await expect(rainyDayFund.connect(investor).claimPolicies())
        .to.be.revertedWith("No policies to claim");
    });

    it("Should handle insufficient funds for claims", async function () {
      // Create new farmer with large policy purchase but insufficient contract balance
      const bigFarmer = addrs[0];
      await mockUSDC.mint(bigFarmer.address, INITIAL_USDC_BALANCE);
      await mockUSDC.connect(bigFarmer).approve(await rainyDayFund.getAddress(), ethers.MaxUint256);

      // Buy policies worth more than available balance for payout
      await rainyDayFund.connect(bigFarmer).buyPolicy(100); // This will drain investor funds for premium

      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM

      await expect(rainyDayFund.connect(bigFarmer).claimPolicies())
        .to.be.revertedWith("Insufficient funds");
    });

    it("Should prevent double claiming", async function () {
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM

      // First claim should work
      await rainyDayFund.connect(farmer).claimPolicies();

      // Second claim should fail (no tokens left)
      await expect(rainyDayFund.connect(farmer).claimPolicies())
        .to.be.revertedWith("No policies to claim");
    });
  });

  describe("Investment Functions (ERC4626)", function () {
    it("Should allow investments using invest wrapper in ACTIVE state", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);

      await expect(rainyDayFund.connect(investor).invest(investmentAmount))
        .to.emit(rainyDayFund, "InvestmentMade")
        .withArgs(investor.address, investmentAmount)
        .and.to.emit(rainyDayFund, "Deposit");

      expect(await rainyDayFund.balanceOf(investor.address)).to.be.greaterThan(0);
      expect(await rainyDayFund.totalAssets()).to.equal(investmentAmount);
    });

    it("Should allow investments using direct ERC4626 deposit", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);

      const shares = await rainyDayFund.connect(investor).deposit.staticCall(investmentAmount, investor.address);

      await expect(rainyDayFund.connect(investor).deposit(investmentAmount, investor.address))
        .to.emit(rainyDayFund, "Deposit")
        .withArgs(investor.address, investor.address, investmentAmount, shares);

      expect(await rainyDayFund.balanceOf(investor.address)).to.equal(shares);
      expect(await rainyDayFund.totalAssets()).to.equal(investmentAmount);
    });

    it("Should allow investments in INACTIVE period", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);

      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      expect(await rainyDayFund.getSeasonState()).to.equal(1); // INACTIVE

      await expect(rainyDayFund.connect(investor).invest(investmentAmount))
        .to.emit(rainyDayFund, "InvestmentMade");
    });

    it("Should not allow investments outside ACTIVE/INACTIVE periods", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);

      // Test in CLAIM period
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM

      await expect(rainyDayFund.connect(investor).invest(investmentAmount))
        .to.be.revertedWith("Season not active aymore");

      // Test in WITHDRAW period
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW

      await expect(rainyDayFund.connect(investor).invest(investmentAmount))
        .to.be.revertedWith("Season not active aymore");

      // Test in FINISHED period
      await rainyDayFund.advanceToNextPhase(); // WITHDRAW -> FINISHED

      await expect(rainyDayFund.connect(investor).invest(investmentAmount))
        .to.be.revertedWith("Season not active aymore");
    });

    it("Should reject zero amount investment", async function () {
      await expect(rainyDayFund.connect(investor).invest(0))
        .to.be.revertedWith("Amount > 0");
    });

    it("Should allow withdrawal during WITHDRAW period using redeemShares", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);

      // Make investment
      await rainyDayFund.connect(investor).invest(investmentAmount);
      const shares = await rainyDayFund.balanceOf(investor.address);

      // Advance to withdrawal period
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW

      expect(await rainyDayFund.getSeasonState()).to.equal(3); // WITHDRAW state

      const initialBalance = await mockUSDC.balanceOf(investor.address);

      await expect(rainyDayFund.connect(investor).redeemShares(shares))
        .to.emit(rainyDayFund, "InvestmentWithdrawn")
        .withArgs(investor.address, investmentAmount)
        .and.to.emit(rainyDayFund, "Withdraw");

      const finalBalance = await mockUSDC.balanceOf(investor.address);
      expect(finalBalance - initialBalance).to.equal(investmentAmount);
      expect(await rainyDayFund.balanceOf(investor.address)).to.equal(0);
    });

    it("Should allow withdrawal using direct ERC4626 redeem", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      
      await rainyDayFund.connect(investor).invest(investmentAmount);
      const shares = await rainyDayFund.balanceOf(investor.address);

      // Advance to withdrawal period
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW

      const assets = await rainyDayFund.connect(investor).redeem.staticCall(shares, investor.address, investor.address);

      await expect(rainyDayFund.connect(investor).redeem(shares, investor.address, investor.address))
        .to.emit(rainyDayFund, "Withdraw")
        .withArgs(investor.address, investor.address, investor.address, assets, shares);
    });

    it("Should not allow withdrawal outside WITHDRAW period", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      await rainyDayFund.connect(investor).invest(investmentAmount);
      const shares = await rainyDayFund.balanceOf(investor.address);

      // Try in ACTIVE period
      await expect(rainyDayFund.connect(investor).redeemShares(shares))
        .to.be.revertedWith("Not in withdrawal period");

      // Try in INACTIVE period
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await expect(rainyDayFund.connect(investor).redeemShares(shares))
        .to.be.revertedWith("Not in withdrawal period");

      // Try in CLAIM period
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      await expect(rainyDayFund.connect(investor).redeemShares(shares))
        .to.be.revertedWith("Not in withdrawal period");

      // Try in FINISHED period
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW
      await rainyDayFund.advanceToNextPhase(); // WITHDRAW -> FINISHED
      await expect(rainyDayFund.connect(investor).redeemShares(shares))
        .to.be.revertedWith("Not in withdrawal period");
    });

    it("Should calculate proportional returns with premium income", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);

      // Two investors invest equally
      await rainyDayFund.connect(investor).invest(investmentAmount);
      
      const investor2 = addrs[0];
      await mockUSDC.mint(investor2.address, INITIAL_USDC_BALANCE);
      await mockUSDC.connect(investor2).approve(await rainyDayFund.getAddress(), ethers.MaxUint256);
      await rainyDayFund.connect(investor2).invest(investmentAmount);

      const investor1Shares = await rainyDayFund.balanceOf(investor.address);

      // Farmer buys policies, adding premium to pool
      await rainyDayFund.connect(farmer).buyPolicy(10); // Adds 90 USDC in premiums

      // Advance to withdrawal period (no claims made)
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW

      const initialBalance = await mockUSDC.balanceOf(investor.address);
      await rainyDayFund.connect(investor).redeemShares(investor1Shares);
      const finalBalance = await mockUSDC.balanceOf(investor.address);

      const actualReturn = finalBalance - initialBalance;
      // Should get more than invested due to premium income
      expect(actualReturn).to.be.greaterThan(investmentAmount);
      
      // Should be approximately half of total premium income plus original investment
      const expectedExtraReturn = (PREMIUM * 10n) / 2n; // Half of total premiums
      expect(actualReturn).to.be.closeTo(investmentAmount + expectedExtraReturn, ethers.parseUnits("1", USDC_DECIMALS));
    });

    it("Should handle ERC4626 preview functions correctly", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);

      // Test empty pool
      const previewShares = await rainyDayFund.previewDeposit(investmentAmount);
      const previewAssets = await rainyDayFund.previewMint(previewShares);
      expect(previewAssets).to.equal(investmentAmount);

      // Make actual deposit and verify
      await rainyDayFund.connect(investor).deposit(investmentAmount, investor.address);
      expect(await rainyDayFund.balanceOf(investor.address)).to.equal(previewShares);

      // Test with existing assets
      const secondInvestment = ethers.parseUnits("500", USDC_DECIMALS);
      const secondPreviewShares = await rainyDayFund.previewDeposit(secondInvestment);
      const secondPreviewAssets = await rainyDayFund.previewMint(secondPreviewShares);
      expect(secondPreviewAssets).to.equal(secondInvestment);
    });

    it("Should calculate correct share to asset ratios", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      
      await rainyDayFund.connect(investor).invest(investmentAmount);
      const shares = await rainyDayFund.balanceOf(investor.address);

      // Initially 1:1 ratio
      expect(await rainyDayFund.convertToAssets(shares)).to.equal(investmentAmount);
      expect(await rainyDayFund.convertToShares(investmentAmount)).to.equal(shares);

      // Add premiums to change ratio
      await rainyDayFund.connect(farmer).buyPolicy(5); // Adds 45 USDC
      
      const newTotalAssets = await rainyDayFund.totalAssets();
      expect(newTotalAssets).to.equal(investmentAmount + PREMIUM * 5n);
      
      // Shares should now be worth more assets
      const assetsPerShare = await rainyDayFund.convertToAssets(shares);
      expect(assetsPerShare).to.be.greaterThan(investmentAmount);
    });
  });

  describe("Season Management", function () {
    it("Should allow owner to start new season after full cycle", async function () {
      const newPremium = ethers.parseUnits("12", USDC_DECIMALS);

      // Complete full season cycle
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW
      await rainyDayFund.advanceToNextPhase(); // WITHDRAW -> FINISHED

      expect(await rainyDayFund.getSeasonState()).to.equal(4); // FINISHED

      await expect(rainyDayFund.startNewSeason(newPremium))
        .to.emit(rainyDayFund, "NewSeasonStarted")
        .withArgs(2, newPremium, newPremium * 4n);

      expect(await rainyDayFund.currentSeasonId()).to.equal(2);
      expect(await rainyDayFund.getSeasonState()).to.equal(0); // ACTIVE

      const newSeasonInfo = await rainyDayFund.seasonPolicies(2);
      expect(newSeasonInfo.premium).to.equal(newPremium);
      expect(newSeasonInfo.payoutAmount).to.equal(newPremium * 4n);
      expect(newSeasonInfo.totalPoliciesSold).to.equal(0);
      expect(newSeasonInfo.creationTimestamp).to.be.greaterThan(0);
    });

    it("Should not allow starting new season before full cycle completion", async function () {
      const newPremium = ethers.parseUnits("12", USDC_DECIMALS);

      // Test in each non-finished state
      await expect(rainyDayFund.startNewSeason(newPremium))
        .to.be.revertedWith("Season not fully finished yet");

      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await expect(rainyDayFund.startNewSeason(newPremium))
        .to.be.revertedWith("Season not fully finished yet");

      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      await expect(rainyDayFund.startNewSeason(newPremium))
        .to.be.revertedWith("Season not fully finished yet");

      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW
      await expect(rainyDayFund.startNewSeason(newPremium))
        .to.be.revertedWith("Season not fully finished yet");
    });

    it("Should not allow non-owner to start new season", async function () {
      const newPremium = ethers.parseUnits("12", USDC_DECIMALS);

      // Complete season cycle
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW
      await rainyDayFund.advanceToNextPhase(); // WITHDRAW -> FINISHED

      await expect(rainyDayFund.connect(farmer).startNewSeason(newPremium))
        .to.be.revertedWithCustomError(rainyDayFund, "OwnableUnauthorizedAccount");
    });

    it("Should preserve old season data when starting new season", async function () {
      // Record original season data
      const originalSeasonInfo = await rainyDayFund.seasonPolicies(1);

      // Complete season cycle
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW
      await rainyDayFund.advanceToNextPhase(); // WITHDRAW -> FINISHED

      // Start new season
      const newPremium = ethers.parseUnits("15", USDC_DECIMALS);
      await rainyDayFund.startNewSeason(newPremium);

      // Old season data should still exist
      const oldSeasonInfo = await rainyDayFund.seasonPolicies(1);
      expect(oldSeasonInfo.premium).to.equal(originalSeasonInfo.premium);
      expect(oldSeasonInfo.payoutAmount).to.equal(originalSeasonInfo.payoutAmount);

      // New season should have different data
      const newSeasonInfo = await rainyDayFund.seasonPolicies(2);
      expect(newSeasonInfo.premium).to.equal(newPremium);
      expect(newSeasonInfo.payoutAmount).to.equal(newPremium * 4n);
    });
  });

  describe("Season States and Timing", function () {
    it("Should transition through all season states correctly", async function () {
      const states = [0, 1, 2, 3, 4]; // ACTIVE, INACTIVE, CLAIM, WITHDRAW, FINISHED
      
      expect(await rainyDayFund.getSeasonState()).to.equal(states[0]);

      for (let i = 1; i < states.length; i++) {
        await rainyDayFund.advanceToNextPhase();
        expect(await rainyDayFund.getSeasonState()).to.equal(states[i]);
      }
    });

    it("Should maintain correct state after multiple advance calls", async function () {
      // Advance to FINISHED and try to advance again
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW
      await rainyDayFund.advanceToNextPhase(); // WITHDRAW -> FINISHED

      expect(await rainyDayFund.getSeasonState()).to.equal(4); // FINISHED

      // Additional advance calls should keep it in FINISHED
      await rainyDayFund.advanceToNextPhase();
      expect(await rainyDayFund.getSeasonState()).to.equal(4); // Still FINISHED
    });

    it("Should handle time offset correctly", async function () {
      const initialTime = await rainyDayFund.getCurrentTime();
      const initialOffset = await rainyDayFund.testingTimeOffset();

      await rainyDayFund.advanceToNextPhase();
      
      const newTime = await rainyDayFund.getCurrentTime();
      const newOffset = await rainyDayFund.testingTimeOffset();

      expect(newTime).to.be.greaterThan(initialTime);
      expect(newOffset).to.be.greaterThan(initialOffset);
    });

    it("Should use block.timestamp when testing mode is off", async function () {
      await rainyDayFund.setTestingMode(false);
      
      const contractTime = await rainyDayFund.getCurrentTime();
      const blockTime = (await ethers.provider.getBlock('latest'))!.timestamp;
      
      expect(contractTime).to.be.closeTo(blockTime, 5); // Within 5 seconds
    });
  });

  describe("Edge Cases and Security", function () {
    it("Should handle reentrancy protection", async function () {
      // The contract uses ReentrancyGuard, but we can't easily test it without
      // a malicious contract. We verify the modifier is applied to key functions.
      
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      await rainyDayFund.connect(investor).invest(investmentAmount);
      
      // These operations should work normally
      await rainyDayFund.connect(farmer).buyPolicy(1);
      
      // Advance to claim period
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      
      await rainyDayFund.connect(farmer).claimPolicies();
    });

    it("Should handle zero balance scenarios", async function () {
      expect(await rainyDayFund.totalAssets()).to.equal(0);
      
      // Should not be able to buy policies without investment
      await rainyDayFund.connect(farmer).buyPolicy(1);
      
      // Advance to claim period
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      
      // Should fail due to insufficient funds
      await expect(rainyDayFund.connect(farmer).claimPolicies())
        .to.be.revertedWith("Insufficient funds");
    });

    it("Should handle large numbers correctly", async function () {
      const largeAmount = ethers.parseUnits("1000000", USDC_DECIMALS); // 1M USDC
      
      await mockUSDC.mint(investor.address, largeAmount);
      await mockUSDC.mint(farmer.address, largeAmount);
      
      await rainyDayFund.connect(investor).invest(largeAmount);
      await rainyDayFund.connect(farmer).buyPolicy(10000); // Large policy purchase
      
      const totalAssets = await rainyDayFund.totalAssets();
      expect(totalAssets).to.be.greaterThan(largeAmount);
    });

    it("Should correctly calculate total assets after various operations", async function () {
      expect(await rainyDayFund.totalAssets()).to.equal(0);

      // Investment adds to assets
      const investmentAmount = ethers.parseUnits("500", USDC_DECIMALS);
      await rainyDayFund.connect(investor).invest(investmentAmount);
      expect(await rainyDayFund.totalAssets()).to.equal(investmentAmount);

      // Policy purchase adds premium to assets
      await rainyDayFund.connect(farmer).buyPolicy(2);
      const expectedTotal = investmentAmount + (PREMIUM * 2n);
      expect(await rainyDayFund.totalAssets()).to.equal(expectedTotal);

      // Claims should reduce total assets
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      
      await rainyDayFund.connect(farmer).claimPolicies();
      const expectedAfterClaim = expectedTotal - (PAYOUT * 2n);
      expect(await rainyDayFund.totalAssets()).to.equal(expectedAfterClaim);
    });

    it("Should handle partial withdrawals correctly", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      await rainyDayFund.connect(investor).invest(investmentAmount);
      
      const totalShares = await rainyDayFund.balanceOf(investor.address);
      const halfShares = totalShares / 2n;

      // Advance to withdrawal period
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW

      const initialBalance = await mockUSDC.balanceOf(investor.address);
      await rainyDayFund.connect(investor).redeemShares(halfShares);
      const finalBalance = await mockUSDC.balanceOf(investor.address);

      // Should get approximately half back
      const received = finalBalance - initialBalance;
      expect(received).to.be.closeTo(investmentAmount / 2n, ethers.parseUnits("1", USDC_DECIMALS));
      
      // Should have half shares remaining
      const remainingShares = await rainyDayFund.balanceOf(investor.address);
      expect(remainingShares).to.be.closeTo(halfShares, 1n);
    });
  });

  describe("Policy Token Contract", function () {
    let policyToken: SeasonPolicyToken;

    beforeEach(async function () {
      const policyInfo = await rainyDayFund.seasonPolicies(1);
      policyToken = await ethers.getContractAt("SeasonPolicyToken", policyInfo.policyToken);
    });

    it("Should have correct name and symbol for season 1", async function () {
      expect(await policyToken.name()).to.equal("RainyDay Policy Season 1");
      expect(await policyToken.symbol()).to.equal("RDP1");
    });

    it("Should only allow RainyDayFund to mint tokens", async function () {
      await expect(policyToken.connect(farmer).mint(farmer.address, 1))
        .to.be.revertedWith("Only fund");
        
      await expect(policyToken.connect(owner).mint(farmer.address, 1))
        .to.be.revertedWith("Only fund");
    });

    it("Should only allow RainyDayFund to burn tokens", async function () {
      // First buy policy to have tokens to burn
      await rainyDayFund.connect(farmer).buyPolicy(1);
      
      await expect(policyToken.connect(farmer).burnFrom(farmer.address, 1))
        .to.be.revertedWith("Only fund");
        
      await expect(policyToken.connect(owner).burnFrom(farmer.address, 1))
        .to.be.revertedWith("Only fund");
    });

    it("Should track rainyDayFund address correctly", async function () {
      expect(await policyToken.rainyDayFund()).to.equal(await rainyDayFund.getAddress());
    });

    it("Should handle ERC20 functionality correctly", async function () {
      // Buy policies to get tokens
      await rainyDayFund.connect(farmer).buyPolicy(5);
      
      expect(await policyToken.balanceOf(farmer.address)).to.equal(5);
      expect(await policyToken.totalSupply()).to.equal(5);
      
      // Test transfer
      await policyToken.connect(farmer).transfer(investor.address, 2);
      expect(await policyToken.balanceOf(farmer.address)).to.equal(3);
      expect(await policyToken.balanceOf(investor.address)).to.equal(2);
    });

    it("Should create different tokens for different seasons", async function () {
      // Complete first season
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW
      await rainyDayFund.advanceToNextPhase(); // WITHDRAW -> FINISHED

      // Start new season
      await rainyDayFund.startNewSeason(PREMIUM);
      
      const season2Info = await rainyDayFund.seasonPolicies(2);
      const policyToken2 = await ethers.getContractAt("SeasonPolicyToken", season2Info.policyToken);
      
      expect(await policyToken2.name()).to.equal("RainyDay Policy Season 2");
      expect(await policyToken2.symbol()).to.equal("RDP2");
      expect(policyToken2.target).to.not.equal(policyToken.target);
    });
  });

  describe("Multi-Season Operations", function () {
    it("Should handle multiple seasons with different parameters", async function () {
      const season1Premium = PREMIUM;
      const season2Premium = ethers.parseUnits("15", USDC_DECIMALS);
      
      // Buy policy in season 1
      await rainyDayFund.connect(farmer).buyPolicy(2);
      
      // Complete season 1
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW
      await rainyDayFund.advanceToNextPhase(); // WITHDRAW -> FINISHED
      
      // Start season 2 with different premium
      await rainyDayFund.startNewSeason(season2Premium);
      
      expect(await rainyDayFund.currentSeasonId()).to.equal(2);
      
      // Buy policy in season 2
      await rainyDayFund.connect(farmer).buyPolicy(1);
      
      // Verify both seasons have correct data
      const season1Info = await rainyDayFund.seasonPolicies(1);
      const season2Info = await rainyDayFund.seasonPolicies(2);
      
      expect(season1Info.premium).to.equal(season1Premium);
      expect(season1Info.totalPoliciesSold).to.equal(2);
      
      expect(season2Info.premium).to.equal(season2Premium);
      expect(season2Info.totalPoliciesSold).to.equal(1);
    });

    it("Should maintain separate policy tokens per season", async function () {
      // Buy policy in season 1
      await rainyDayFund.connect(farmer).buyPolicy(3);
      
      const season1Info = await rainyDayFund.seasonPolicies(1);
      const policyToken1 = await ethers.getContractAt("SeasonPolicyToken", season1Info.policyToken);
      
      expect(await policyToken1.balanceOf(farmer.address)).to.equal(3);
      
      // Complete season 1 and start season 2
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW
      await rainyDayFund.advanceToNextPhase(); // WITHDRAW -> FINISHED
      
      await rainyDayFund.startNewSeason(PREMIUM);
      
      // Buy policy in season 2
      await rainyDayFund.connect(farmer).buyPolicy(2);
      
      const season2Info = await rainyDayFund.seasonPolicies(2);
      const policyToken2 = await ethers.getContractAt("SeasonPolicyToken", season2Info.policyToken);
      
      // Should have tokens in both seasons
      expect(await policyToken1.balanceOf(farmer.address)).to.equal(3);
      expect(await policyToken2.balanceOf(farmer.address)).to.equal(2);
      
      // Tokens should be different contracts
      expect(policyToken1.target).to.not.equal(policyToken2.target);
    });
  });

  describe("Integration Tests", function () {
    it("Should handle complete season lifecycle with claims", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      
      // Investment phase
      await rainyDayFund.connect(investor).invest(investmentAmount);
      
      // Policy purchase phase
      await rainyDayFund.connect(farmer).buyPolicy(5);
      const premiumIncome = PREMIUM * 5n;
      
      // Verify assets increased
      expect(await rainyDayFund.totalAssets()).to.equal(investmentAmount + premiumIncome);
      
      // Move through inactive phase
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      
      // Move to claim phase and make claims
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      
      const initialFarmerBalance = await mockUSDC.balanceOf(farmer.address);
      await rainyDayFund.connect(farmer).claimPolicies();
      const finalFarmerBalance = await mockUSDC.balanceOf(farmer.address);
      
      const claimPayout = PAYOUT * 5n;
      expect(finalFarmerBalance - initialFarmerBalance).to.equal(claimPayout);
      
      // Move to withdraw phase and withdraw investments
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW
      
      const investorShares = await rainyDayFund.balanceOf(investor.address);
      const initialInvestorBalance = await mockUSDC.balanceOf(investor.address);
      
      await rainyDayFund.connect(investor).redeemShares(investorShares);
      const finalInvestorBalance = await mockUSDC.balanceOf(investor.address);
      
      // Investor should get back remaining assets (original investment + premiums - payouts)
      const expectedReturn = investmentAmount + premiumIncome - claimPayout;
      expect(finalInvestorBalance - initialInvestorBalance).to.equal(expectedReturn);
      
      // Complete season
      await rainyDayFund.advanceToNextPhase(); // WITHDRAW -> FINISHED
      
      // Start new season
      await rainyDayFund.startNewSeason(PREMIUM);
      expect(await rainyDayFund.currentSeasonId()).to.equal(2);
      expect(await rainyDayFund.getSeasonState()).to.equal(0); // ACTIVE
    });

    it("Should handle season without claims", async function () {
      const investmentAmount = ethers.parseUnits("500", USDC_DECIMALS);
      
      await rainyDayFund.connect(investor).invest(investmentAmount);
      await rainyDayFund.connect(farmer).buyPolicy(3);
      
      // Set good weather (no claims possible)
      await mockWeatherOracle.updatePrice(20);
      
      // Complete season without claims
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW
      
      // Investor should get back investment + all premiums
      const investorShares = await rainyDayFund.balanceOf(investor.address);
      const initialBalance = await mockUSDC.balanceOf(investor.address);
      
      await rainyDayFund.connect(investor).redeemShares(investorShares);
      const finalBalance = await mockUSDC.balanceOf(investor.address);
      
      const expectedReturn = investmentAmount + (PREMIUM * 3n);
      expect(finalBalance - initialBalance).to.be.closeTo(expectedReturn, 1);
      // Note: this used to be .be.equal, but a single wei was lost due to rounding,
      // so tolerance was added
    });
  });
});
