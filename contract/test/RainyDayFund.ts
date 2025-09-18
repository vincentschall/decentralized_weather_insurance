import { expect } from "chai";
import { ethers } from "hardhat";
import { RainyDayFund, MockUSDC, MockWeatherOracle, SeasonPolicyToken } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

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
  const PAYOUT = PREMIUM * 4n; // Updated to 4x premium
  const INITIAL_WEATHER = 5; // 1-9 leads to payout, 10 or more is no payout
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
    rainyDayFund = await RainyDayFundFactory.deploy(await mockUSDC.getAddress(), await mockWeatherOracle.getAddress());

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

    it("Should initialize with season 1", async function () {
      expect(await rainyDayFund.currentSeasonId()).to.equal(1);
    });

    it("Should set correct initial season parameters", async function () {
      const policyInfo = await rainyDayFund.seasonPolicies(1);
      expect(policyInfo.premium).to.equal(PREMIUM);
      expect(policyInfo.payoutAmount).to.equal(PAYOUT); // Now 4x premium
      expect(policyInfo.totalPoliciesSold).to.equal(0);
    });

    it("Should initialize in ACTIVE state", async function () {
      expect(await rainyDayFund.getSeasonState()).to.equal(0); // ACTIVE
    });

    it("Should be in testing mode by default", async function () {
      expect(await rainyDayFund.testingMode()).to.equal(true);
    });
  });

  describe("Testing Mode Functions", function () {
    it("Should allow owner to advance to next phase", async function () {
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

    it("Should allow owner to toggle testing mode", async function () {
      await rainyDayFund.setTestingMode(false);
      expect(await rainyDayFund.testingMode()).to.equal(false);

      // Should not be able to advance phases when testing mode is off
      await expect(rainyDayFund.advanceToNextPhase())
        .to.be.revertedWith("Not in testing mode");
    });

    it("Should not allow non-owner to use testing functions", async function () {
      await expect(rainyDayFund.connect(farmer).advanceToNextPhase())
        .to.be.revertedWithCustomError(rainyDayFund, "OwnableUnauthorizedAccount");

      await expect(rainyDayFund.connect(farmer).setTestingMode(false))
        .to.be.revertedWithCustomError(rainyDayFund, "OwnableUnauthorizedAccount");
    });
  });

  describe("Policy Purchase", function () {
    it("Should allow buying policies in ACTIVE state", async function () {
      const amount = 2;
      const contractPremium = PREMIUM;
      const totalPremium = contractPremium * BigInt(amount);

      await expect(rainyDayFund.connect(farmer).buyPolicy(amount))
        .to.emit(rainyDayFund, "PolicyBought")
        .withArgs(farmer.address, 1, amount, totalPremium);

      // Check policy token balance
      const policyInfo = await rainyDayFund.seasonPolicies(1);
      const policyToken = await ethers.getContractAt("SeasonPolicyToken", policyInfo.policyToken);
      expect(await policyToken.balanceOf(farmer.address)).to.equal(amount);

      // Check total policies sold
      const updatedPolicyInfo = await rainyDayFund.seasonPolicies(1);
      expect(updatedPolicyInfo.totalPoliciesSold).to.equal(amount);
    });

    it("Should reject zero amount purchase", async function () {
      await expect(rainyDayFund.connect(farmer).buyPolicy(0))
        .to.be.revertedWith("Amount > 0");
    });

    it("Should reject purchase when not in active period", async function () {
      // Advance to INACTIVE phase
      await rainyDayFund.advanceToNextPhase();
      expect(await rainyDayFund.getSeasonState()).to.equal(1); // INACTIVE

      await expect(rainyDayFund.connect(farmer).buyPolicy(1))
        .to.be.revertedWith("Not in active period");

      // Also test in CLAIM phase
      await rainyDayFund.advanceToNextPhase();
      expect(await rainyDayFund.getSeasonState()).to.equal(2); // CLAIM

      await expect(rainyDayFund.connect(farmer).buyPolicy(1))
        .to.be.revertedWith("Not in active period");
    });

    it("Should transfer correct USDC amount", async function () {
      const initialBalance = await mockUSDC.balanceOf(farmer.address);
      const amount = 1;
      const contractPremium = PREMIUM;
      
      await rainyDayFund.connect(farmer).buyPolicy(amount);
      
      const finalBalance = await mockUSDC.balanceOf(farmer.address);
      expect(initialBalance - finalBalance).to.equal(contractPremium);
    });
  });

  describe("Weather Data and Claims", function () {

    beforeEach(async function () {
      // First invest to ensure contract has enough funds for payouts
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      await rainyDayFund.connect(investor).invest(investmentAmount);

      // Then farmer buys policies
      await rainyDayFund.connect(farmer).buyPolicy(3);
    });

    it("Should read weather data from oracle", async function () {
      const [roundId, weather, timestamp] = await rainyDayFund.getWeatherData();
      expect(weather).to.equal(INITIAL_WEATHER);
      expect(roundId).to.be.greaterThan(0);
      expect(timestamp).to.be.greaterThan(0);
    });

    it("Should allow claiming when conditions are met", async function () {
      // Advance to CLAIM period
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM

      expect(await rainyDayFund.getSeasonState()).to.equal(2); // CLAIM state

      const initialBalance = await mockUSDC.balanceOf(farmer.address);
      const contractPayout = PAYOUT;
      const expectedPayout = contractPayout * 3n; // 3 policies

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
      // Update mock oracle to return good weather (>= 10)
      await mockWeatherOracle.updatePrice(15);

      // Advance to CLAIM period
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM

      await expect(rainyDayFund.connect(farmer).claimPolicies())
        .to.be.revertedWith("Weather not bad enough");
    });

    it("Should not allow claiming in wrong period", async function () {
      // Try claiming in ACTIVE period
      await expect(rainyDayFund.connect(farmer).claimPolicies())
        .to.be.revertedWith("Not in claim period");

      // Try claiming in INACTIVE period
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await expect(rainyDayFund.connect(farmer).claimPolicies())
        .to.be.revertedWith("Not in claim period");

      // Skip to WITHDRAW period
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW

      expect(await rainyDayFund.getSeasonState()).to.equal(3); // WITHDRAW state

      await expect(rainyDayFund.connect(farmer).claimPolicies())
        .to.be.revertedWith("Not in claim period");
    });

    it("Should not allow claiming without policies", async function () {
      // Advance to CLAIM period
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM

      await expect(rainyDayFund.connect(investor).claimPolicies())
        .to.be.revertedWith("No policies to claim");
    });
  });

  describe("Investment Functions (ERC4626)", function () {
    it("Should allow investments using deposit", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);

      const shares = await rainyDayFund.connect(investor).deposit.staticCall(investmentAmount, investor.address);

      await expect(rainyDayFund.connect(investor).deposit(investmentAmount, investor.address))
        .to.emit(rainyDayFund, "Deposit")
        .withArgs(investor.address, investor.address, investmentAmount, shares);

      expect(await rainyDayFund.balanceOf(investor.address)).to.equal(shares);
      expect(await rainyDayFund.totalAssets()).to.equal(investmentAmount);
    });

    it("Should allow investments using invest wrapper", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);

      await expect(rainyDayFund.connect(investor).invest(investmentAmount))
        .to.emit(rainyDayFund, "InvestmentMade")
        .withArgs(investor.address, investmentAmount);

      expect(await rainyDayFund.balanceOf(investor.address)).to.be.greaterThan(0);
      expect(await rainyDayFund.totalAssets()).to.equal(investmentAmount);
    });

    it("Should allow investments in INACTIVE period", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);

      // Advance to INACTIVE period
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      expect(await rainyDayFund.getSeasonState()).to.equal(1); // INACTIVE

      await expect(rainyDayFund.connect(investor).invest(investmentAmount))
        .to.emit(rainyDayFund, "InvestmentMade")
        .withArgs(investor.address, investmentAmount);
    });

    it("Should not allow investments outside ACTIVE/INACTIVE periods", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);

      // Advance to CLAIM period
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM

      await expect(rainyDayFund.connect(investor).invest(investmentAmount))
        .to.be.revertedWith("Season not active aymore");
    });

    it("Should allow withdrawal during withdrawal period using redeemShares", async function () {
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
        .withArgs(investor.address, investmentAmount);

      const finalBalance = await mockUSDC.balanceOf(investor.address);
      expect(finalBalance - initialBalance).to.equal(investmentAmount);
      expect(await rainyDayFund.balanceOf(investor.address)).to.equal(0);
    });

    it("Should not allow withdrawal outside withdrawal period", async function () {
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
    });

    it("Should calculate proportional withdrawal with profits/losses", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);

      // Two investors invest
      await rainyDayFund.connect(investor).invest(investmentAmount);
      await mockUSDC.mint(addrs[0].address, INITIAL_USDC_BALANCE);
      await mockUSDC.connect(addrs[0]).approve(await rainyDayFund.getAddress(), ethers.MaxUint256);
      await rainyDayFund.connect(addrs[0]).invest(investmentAmount);

      const investorShares = await rainyDayFund.balanceOf(investor.address);

      // Farmer buys policy, adding to asset pool
      await rainyDayFund.connect(farmer).buyPolicy(1); // Adds 9 USDC

      // Advance to withdrawal period
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW

      const initialBalance = await mockUSDC.balanceOf(investor.address);
      await rainyDayFund.connect(investor).redeemShares(investorShares);
      const finalBalance = await mockUSDC.balanceOf(investor.address);

      // Should get back more than invested due to premium income
      const actualReturn = finalBalance - initialBalance;
      expect(actualReturn).to.be.greaterThan(investmentAmount);
    });

    it("Should handle ERC4626 preview functions", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);

      const previewShares = await rainyDayFund.previewDeposit(investmentAmount);
      const previewAssets = await rainyDayFund.previewMint(previewShares);

      expect(previewAssets).to.equal(investmentAmount);
    });
  });

  describe("Season Management", function () {
    it("Should allow owner to start new season after full cycle", async function () {
      const newPremium = ethers.parseUnits("12", USDC_DECIMALS);

      // Advance through full season cycle
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW
      await rainyDayFund.advanceToNextPhase(); // WITHDRAW -> FINISHED

      expect(await rainyDayFund.getSeasonState()).to.equal(4); // FINISHED

      await expect(rainyDayFund.startNewSeason(newPremium))
        .to.emit(rainyDayFund, "NewSeasonStarted")
        .withArgs(2, newPremium, newPremium * 4n); // 4x payout

      expect(await rainyDayFund.currentSeasonId()).to.equal(2);
      expect(await rainyDayFund.getSeasonState()).to.equal(0); // ACTIVE

      const newSeasonInfo = await rainyDayFund.seasonPolicies(2);
      expect(newSeasonInfo.premium).to.equal(newPremium);
      expect(newSeasonInfo.payoutAmount).to.equal(newPremium * 4n);
    });

    it("Should not allow starting new season before full cycle", async function () {
      const newPremium = ethers.parseUnits("12", USDC_DECIMALS);

      await expect(rainyDayFund.startNewSeason(newPremium))
        .to.be.revertedWith("Season not fully finished yet");
    });

    it("Should not allow non-owner to start new season", async function () {
      const newPremium = ethers.parseUnits("12", USDC_DECIMALS);

      // Advance to FINISHED state
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM
      await rainyDayFund.advanceToNextPhase(); // CLAIM -> WITHDRAW
      await rainyDayFund.advanceToNextPhase(); // WITHDRAW -> FINISHED

      await expect(rainyDayFund.connect(farmer).startNewSeason(newPremium))
        .to.be.revertedWithCustomError(rainyDayFund, "OwnableUnauthorizedAccount");
    });
  });

  describe("Season States and Timing", function () {
    it("Should transition through all season states correctly", async function () {
      // Initial state should be ACTIVE
      expect(await rainyDayFund.getSeasonState()).to.equal(0); // ACTIVE

      // Move to INACTIVE period
      await rainyDayFund.advanceToNextPhase();
      expect(await rainyDayFund.getSeasonState()).to.equal(1); // INACTIVE

      // Move to CLAIM period
      await rainyDayFund.advanceToNextPhase();
      expect(await rainyDayFund.getSeasonState()).to.equal(2); // CLAIM

      // Move to WITHDRAW period
      await rainyDayFund.advanceToNextPhase();
      expect(await rainyDayFund.getSeasonState()).to.equal(3); // WITHDRAW

      // Move to FINISHED period
      await rainyDayFund.advanceToNextPhase();
      expect(await rainyDayFund.getSeasonState()).to.equal(4); // FINISHED
    });
  });

  describe("Edge Cases", function () {
    it("Should handle insufficient funds for claims gracefully", async function () {
      // Create scenario where contract has insufficient balance
      await rainyDayFund.connect(farmer).buyPolicy(1); // Only 9 USDC premium, but 36 USDC payout needed

      // Advance to CLAIM period
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM

      await expect(rainyDayFund.connect(farmer).claimPolicies())
        .to.be.revertedWith("Insufficient funds");
    });

    it("Should prevent double claiming", async function () {
      // Add enough funds to cover payout
      await rainyDayFund.connect(investor).invest(ethers.parseUnits("1000", USDC_DECIMALS));
      await rainyDayFund.connect(farmer).buyPolicy(1);

      // Advance to CLAIM period
      await rainyDayFund.advanceToNextPhase(); // ACTIVE -> INACTIVE
      await rainyDayFund.advanceToNextPhase(); // INACTIVE -> CLAIM

      // First claim should work
      await rainyDayFund.connect(farmer).claimPolicies();

      // Second claim should fail (no tokens left)
      await expect(rainyDayFund.connect(farmer).claimPolicies())
        .to.be.revertedWith("No policies to claim");
    });

    it("Should handle zero investment correctly", async function () {
      await expect(rainyDayFund.connect(investor).invest(0))
        .to.be.revertedWith("Amount > 0");
    });

    it("Should correctly calculate total assets", async function () {
      expect(await rainyDayFund.totalAssets()).to.equal(0);

      await rainyDayFund.connect(investor).invest(ethers.parseUnits("500", USDC_DECIMALS));
      expect(await rainyDayFund.totalAssets()).to.equal(ethers.parseUnits("500", USDC_DECIMALS));

      await rainyDayFund.connect(farmer).buyPolicy(1);
      const expectedTotal = ethers.parseUnits("500", USDC_DECIMALS) + ethers.parseUnits("9", USDC_DECIMALS);
      expect(await rainyDayFund.totalAssets()).to.equal(expectedTotal);
    });
  });

  describe("Policy Token Contract", function () {
    let policyToken: SeasonPolicyToken;

    beforeEach(async function () {
      const policyInfo = await rainyDayFund.seasonPolicies(1);
      policyToken = await ethers.getContractAt("SeasonPolicyToken", policyInfo.policyToken);
    });

    it("Should have correct name and symbol", async function () {
      expect(await policyToken.name()).to.equal("RainyDay Policy Season 1");
      expect(await policyToken.symbol()).to.equal("RDP1");
    });

    it("Should only allow RainyDayFund to mint/burn", async function () {
      await expect(policyToken.connect(farmer).mint(farmer.address, 1))
        .to.be.revertedWith("Only fund");

      await expect(policyToken.connect(farmer).burnFrom(farmer.address, 1))
        .to.be.revertedWith("Only fund");
    });

    it("Should track rainyDayFund address correctly", async function () {
      expect(await policyToken.rainyDayFund()).to.equal(await rainyDayFund.getAddress());
    });
  });
});
