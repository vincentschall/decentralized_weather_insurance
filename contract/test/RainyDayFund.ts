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
  const PAYOUT = PREMIUM * 2n;
  const INITIAL_WEATHER = 5; // 1-9 leads to payout, 10 or more is no payout

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
      expect(policyInfo.payoutAmount).to.equal(PAYOUT);
      expect(policyInfo.totalPoliciesSold).to.equal(0);
    });

    it("Should initialize in ACTIVE state", async function () {
      expect(await rainyDayFund.getSeasonState()).to.equal(0); // ACTIVE
    });
  });

  describe("Policy Purchase", function () {
    it("Should allow buying policies", async function () {
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
      // Fast forward to claim period
      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 1n);

      expect(await rainyDayFund.getSeasonState()).to.equal(1); // CLAIM state

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
      // Fast forward to claim period
      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 1n);

      expect(await rainyDayFund.getSeasonState()).to.equal(1); // CLAIM state

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

      // Fast forward to claim period
      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 1n);

      await expect(rainyDayFund.connect(farmer).claimPolicies())
      .to.be.revertedWith("Weather not bad enough");
    });

    it("Should not allow claiming in wrong period", async function () {
      // Try claiming in ACTIVE period
      await expect(rainyDayFund.connect(farmer).claimPolicies())
      .to.be.revertedWith("Not in claim period");

      // Fast forward to WITHDRAW period
      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 61n); // 1 minute + 1 second for WITHDRAW period

      expect(await rainyDayFund.getSeasonState()).to.equal(2); // WITHDRAW state

      await expect(rainyDayFund.connect(farmer).claimPolicies())
      .to.be.revertedWith("Not in claim period");
    });

    it("Should not allow claiming without policies", async function () {
      // Fast forward to claim period
      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 1n);

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

    it("Should allow withdrawal during withdrawal period using redeemShares", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);

      // Make investment
      await rainyDayFund.connect(investor).invest(investmentAmount);
      const shares = await rainyDayFund.balanceOf(investor.address);

      // Fast forward to withdrawal period
      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 61n); // WITHDRAW period

      expect(await rainyDayFund.getSeasonState()).to.equal(2); // WITHDRAW state

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

      // Try in CLAIM period
      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 1n);

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

      // Fast forward to withdrawal period
      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 61n);

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

      // Fast forward past full season cycle
      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 2n * 60n + 1n); // FINISHED state

      expect(await rainyDayFund.getSeasonState()).to.equal(3); // FINISHED

      await expect(rainyDayFund.startNewSeason(newPremium))
      .to.emit(rainyDayFund, "NewSeasonStarted")
      .withArgs(2, newPremium, newPremium * 2n);

      expect(await rainyDayFund.currentSeasonId()).to.equal(2);
      expect(await rainyDayFund.getSeasonState()).to.equal(0); // ACTIVE

      const newSeasonInfo = await rainyDayFund.seasonPolicies(2);
      expect(newSeasonInfo.premium).to.equal(newPremium);
      expect(newSeasonInfo.payoutAmount).to.equal(newPremium * 2n);
    });

    it("Should not allow starting new season before full cycle", async function () {
      const newPremium = ethers.parseUnits("12", USDC_DECIMALS);

      await expect(rainyDayFund.startNewSeason(newPremium))
      .to.be.revertedWith("Season not fully finished yet");
    });

    it("Should not allow non-owner to start new season", async function () {
      const newPremium = ethers.parseUnits("12", USDC_DECIMALS);

      // Fast forward to FINISHED state
      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 2n * 60n + 1n);

      await expect(rainyDayFund.connect(farmer).startNewSeason(newPremium))
      .to.be.revertedWithCustomError(rainyDayFund, "OwnableUnauthorizedAccount");
    });
  });

  describe("Season States and Timing", function () {
    it("Should transition through all season states correctly", async function () {
      // Initial state should be ACTIVE
      expect(await rainyDayFund.getSeasonState()).to.equal(0);

      // Move to CLAIM period
      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 1n);
      expect(await rainyDayFund.getSeasonState()).to.equal(1);

      // Move to WITHDRAW period
      await time.increaseTo(seasonEnd + 61n);
      expect(await rainyDayFund.getSeasonState()).to.equal(2);

      // Move to FINISHED period
      await time.increaseTo(seasonEnd + 121n);
      expect(await rainyDayFund.getSeasonState()).to.equal(3);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle insufficient funds for claims gracefully", async function () {
      // Create scenario where contract has insufficient balance
      await rainyDayFund.connect(farmer).buyPolicy(1); // Only 9 USDC premium, but 18 USDC payout needed

      // Remove some funds from contract (simulate losses)
      // This is a bit artificial, but demonstrates the check
      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 1n);

      await expect(rainyDayFund.connect(farmer).claimPolicies())
      .to.be.revertedWith("Insufficient funds");
    });

    it("Should prevent double claiming", async function () {
      // Add enough funds to cover payout
      await rainyDayFund.connect(investor).invest(ethers.parseUnits("1000", USDC_DECIMALS));
      await rainyDayFund.connect(farmer).buyPolicy(1);

      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 1n);

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
