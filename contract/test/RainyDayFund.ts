import { expect } from "chai";
import { ethers } from "hardhat";
import { RainyDayFund, MockUSDC } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";

describe("RainyDayFund", function () {
  let rainyDayFund: RainyDayFund;
  let mockUSDC: MockUSDC;
  let owner: SignerWithAddress;
  let farmer: SignerWithAddress;
  let investor: SignerWithAddress;
  let addrs: SignerWithAddress[];

  // Constants
  const USDC_DECIMALS = 6;
  const INITIAL_USDC_BALANCE = ethers.parseUnits("10000", USDC_DECIMALS); // 10,000 USDC
  const PREMIUM = ethers.parseUnits("200", USDC_DECIMALS); // 200 USDC
  const PAYOUT = ethers.parseUnits("400", USDC_DECIMALS); // 400 USDC (2x premium)

  beforeEach(async function () {
    // Get signers
    [owner, farmer, investor, ...addrs] = await ethers.getSigners();

    // Deploy mock USDC token
    const MockUSDCFactory = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDCFactory.deploy();

    // Deploy RainyDayFund contract
    const RainyDayFundFactory = await ethers.getContractFactory("RainyDayFund");
    rainyDayFund = await RainyDayFundFactory.deploy(await mockUSDC.getAddress());

    // Mint USDC to test accounts using the mint function
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
      const policyInfo = await rainyDayFund.getPolicyInfo(1);
      expect(policyInfo.premium).to.equal(PREMIUM);
      expect(policyInfo.payoutAmount).to.equal(PAYOUT);
      expect(policyInfo.seasonActive).to.be.true;
    });
  });

  describe("Policy Purchase", function () {
    it("Should allow buying policies", async function () {
      const amount = 2;
      const totalPremium = PREMIUM * BigInt(amount);

      await expect(rainyDayFund.connect(farmer).buyPolicy(amount))
        .to.emit(rainyDayFund, "PolicyBought")
        .withArgs(farmer.address, 1, amount, totalPremium);

      // Check ERC1155 balance
      expect(await rainyDayFund.balanceOf(farmer.address, 1)).to.equal(amount);

      // Check risk pool balance
      expect(await rainyDayFund.riskPoolBalance()).to.equal(totalPremium);
    });

    it("Should reject zero amount purchase", async function () {
      await expect(rainyDayFund.connect(farmer).buyPolicy(0))
        .to.be.revertedWith("Amount must be > 0");
    });

    it("Should reject purchase when policy sales ended", async function () {
      // Fast forward to near end of season (policy sales end 30 days before season ends)
      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd - 29n * 24n * 60n * 60n); // 29 days before season end

      await expect(rainyDayFund.connect(farmer).buyPolicy(1))
        .to.be.revertedWith("Policy sales ended");
    });

    it("Should transfer correct USDC amount", async function () {
      const initialBalance = await mockUSDC.balanceOf(farmer.address);
      const amount = 1;
      
      await rainyDayFund.connect(farmer).buyPolicy(amount);
      
      const finalBalance = await mockUSDC.balanceOf(farmer.address);
      expect(initialBalance - finalBalance).to.equal(PREMIUM);
    });
  });

  describe("Weather Data and Claims", function () {
    beforeEach(async function () {
      // Farmer buys policies
      await rainyDayFund.connect(farmer).buyPolicy(3);
    });

    it("Should allow owner to update weather data", async function () {
      const weatherData = 5; // Below threshold of 10

      await expect(rainyDayFund.updateWeatherData(1, weatherData))
        .to.emit(rainyDayFund, "WeatherDataUpdated")
        .withArgs(1, weatherData);

      const policyInfo = await rainyDayFund.getPolicyInfo(1);
      expect(policyInfo.weatherData).to.equal(weatherData);
      expect(policyInfo.weatherDataFetched).to.be.true;
      expect(policyInfo.payoutEnabled).to.be.true;
    });

    it("Should allow claiming when conditions are met", async function () {
      // Set weather data that triggers payout (< 10)
      await rainyDayFund.updateWeatherData(1, 5);

      // Fast forward past season end
      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 1n);

      const initialBalance = await mockUSDC.balanceOf(farmer.address);
      const expectedPayout = PAYOUT * 3n; // 3 policies

      await expect(rainyDayFund.connect(farmer).claimAll())
        .to.emit(rainyDayFund, "ClaimMade")
        .withArgs(farmer.address, 1, 3, expectedPayout);

      const finalBalance = await mockUSDC.balanceOf(farmer.address);
      expect(finalBalance - initialBalance).to.equal(expectedPayout);

      // Tokens should be burned
      //expect(await rainyDayFund.balanceOf(farmer.address, 1)).to.equal(0);
    });

    it("Should not allow claiming with good weather", async function () {
      // Set weather data that doesn't trigger payout (>= 10)
      await rainyDayFund.updateWeatherData(1, 15);

      // Fast forward past season end
      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 1n);

      await expect(rainyDayFund.connect(farmer).claimAll())
        .to.be.revertedWith("No eligible claims");
    });

    it("Should not allow claiming before season ends", async function () {
      await rainyDayFund.updateWeatherData(1, 5);

      await expect(rainyDayFund.connect(farmer).claimAll())
        .to.be.revertedWith("No eligible claims");
    });

    it("Should not allow claiming after claim window expires", async function () {
      await rainyDayFund.updateWeatherData(1, 5);

      // Fast forward past claim window (seasonEnd + 30 days + 1)
      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 31n * 24n * 60n * 60n);

      await expect(rainyDayFund.connect(farmer).claimAll())
        .to.be.revertedWith("No eligible claims");
    });
  });

  describe("Investment Functions", function () {
    it("Should allow investments", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);

      await expect(rainyDayFund.connect(investor).invest(investmentAmount))
        .to.emit(rainyDayFund, "InvestmentMade")
        .withArgs(investor.address, investmentAmount);

      expect(await rainyDayFund.investorShares(investor.address)).to.equal(investmentAmount);
      expect(await rainyDayFund.totalInvestorFunds()).to.equal(investmentAmount);
      expect(await rainyDayFund.riskPoolBalance()).to.equal(investmentAmount);
    });

    it("Should allow withdrawal during withdrawal period", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      
      // Make investment
      await rainyDayFund.connect(investor).invest(investmentAmount);

      // Fast forward to withdrawal period (seasonEnd + 2*30 days)
      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 61n * 24n * 60n * 60n);

      const initialBalance = await mockUSDC.balanceOf(investor.address);

      await expect(rainyDayFund.connect(investor).withdraw())
        .to.emit(rainyDayFund, "InvestmentWithdrawn");

      const finalBalance = await mockUSDC.balanceOf(investor.address);
      expect(finalBalance - initialBalance).to.equal(investmentAmount);
      expect(await rainyDayFund.investorShares(investor.address)).to.equal(0);
    });

    it("Should not allow withdrawal outside withdrawal period", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      await rainyDayFund.connect(investor).invest(investmentAmount);

      await expect(rainyDayFund.connect(investor).withdraw())
        .to.be.revertedWith("Withdrawal period not active");
    });

    it("Should calculate proportional withdrawal with profits/losses", async function () {
      const investmentAmount = ethers.parseUnits("1000", USDC_DECIMALS);
      
      // Two investors invest
      await rainyDayFund.connect(investor).invest(investmentAmount);
      await mockUSDC.mint(addrs[0].address, INITIAL_USDC_BALANCE);
      await mockUSDC.connect(addrs[0]).approve(await rainyDayFund.getAddress(), ethers.MaxUint256);
      await rainyDayFund.connect(addrs[0]).invest(investmentAmount);

      // Farmer buys policy, adding to risk pool
      await rainyDayFund.connect(farmer).buyPolicy(1); // Adds 200 USDC

      // Fast forward to withdrawal period
      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 61n * 24n * 60n * 60n);

      const initialBalance = await mockUSDC.balanceOf(investor.address);
      await rainyDayFund.connect(investor).withdraw();
      const finalBalance = await mockUSDC.balanceOf(investor.address);

      // Should get back more than invested due to premium income
      expect(finalBalance - initialBalance).to.be.greaterThan(investmentAmount);
    });
  });

  describe("Season Management", function () {
    it("Should allow owner to start new season", async function () {
      await expect(rainyDayFund.startNewSeason())
        .to.emit(rainyDayFund, "NewSeasonStarted")
        .withArgs(2, PREMIUM, PAYOUT);

      expect(await rainyDayFund.currentSeasonId()).to.equal(2);

      const oldSeasonInfo = await rainyDayFund.getPolicyInfo(1);
      const newSeasonInfo = await rainyDayFund.getPolicyInfo(2);

      expect(oldSeasonInfo.seasonActive).to.be.false;
      expect(newSeasonInfo.seasonActive).to.be.true;
    });

    it("Should not allow non-owner to start new season", async function () {
      await expect(rainyDayFund.connect(farmer).startNewSeason())
        .to.be.revertedWithCustomError(rainyDayFund, "OwnableUnauthorizedAccount");
    });
  });

  describe("View Functions", function () {
    beforeEach(async function () {
      await rainyDayFund.connect(farmer).buyPolicy(2);
      await rainyDayFund.startNewSeason();
      await rainyDayFund.connect(farmer).buyPolicy(1);
    });

    it("Should return user policies correctly", async function () {
      const [seasonIds, amounts] = await rainyDayFund.getUserPolicies(farmer.address);
      
      expect(seasonIds).to.deep.equal([1n, 2n]);
      expect(amounts).to.deep.equal([2n, 1n]);
    });

    it("Should return claimable info correctly", async function () {
      // Set weather data for season 1
      await rainyDayFund.updateWeatherData(1, 5);

      // Fast forward past season end
      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 1n);

      const [seasonIds, amounts, totalClaimAmount] = await rainyDayFund.getClaimableInfo(farmer.address);
      
      expect(seasonIds).to.deep.equal([1n]);
      expect(amounts).to.deep.equal([2n]);
      expect(totalClaimAmount).to.equal(PAYOUT * 2n);
    });

    it("Should return correct contract balance", async function () {
      const expectedBalance = PREMIUM * 3n; // 2 from season 1 + 1 from season 2
      expect(await rainyDayFund.getContractBalance()).to.equal(expectedBalance);
    });
  });

  describe("Oracle Configuration", function () {
    it("Should allow owner to set weather oracle", async function () {
      const mockOracleAddress = addrs[0].address;
      
      await rainyDayFund.setWeatherOracle(mockOracleAddress, true);
      expect(await rainyDayFund.useChainlinkOracle()).to.be.true;
    });

    it("Should reject enabling Chainlink with zero address", async function () {
      await expect(rainyDayFund.setWeatherOracle(ethers.ZeroAddress, true))
        .to.be.revertedWith("Oracle address cannot be zero when enabling Chainlink");
    });
  });

  describe("MockUSDC Integration", function () {
    it("Should work with faucet function", async function () {
      // Test the faucet functionality
      const initialBalance = await mockUSDC.balanceOf(addrs[1].address);
      
      await mockUSDC.connect(addrs[1]).faucet();
      
      const finalBalance = await mockUSDC.balanceOf(addrs[1].address);
      const expectedIncrease = ethers.parseUnits("1000", USDC_DECIMALS);
      
      expect(finalBalance - initialBalance).to.equal(expectedIncrease);
    });

    it("Should handle multiple faucet calls", async function () {
      const user = addrs[2];
      
      // Multiple faucet calls
      await mockUSDC.connect(user).faucet();
      await mockUSDC.connect(user).faucet();
      
      const balance = await mockUSDC.balanceOf(user.address);
      const expectedBalance = ethers.parseUnits("2000", USDC_DECIMALS);
      
      expect(balance).to.equal(expectedBalance);
    });

    it("Should allow buying policies with faucet tokens", async function () {
      // Use faucet instead of pre-minting
      await mockUSDC.connect(farmer).faucet(); // Get 1000 USDC
      
      // Approve and buy policy
      await mockUSDC.connect(farmer).approve(
        await rainyDayFund.getAddress(),
        ethers.MaxUint256
      );
      
      await expect(rainyDayFund.connect(farmer).buyPolicy(1))
        .to.emit(rainyDayFund, "PolicyBought");
        
      expect(await rainyDayFund.balanceOf(farmer.address, 1)).to.equal(1);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle insufficient risk pool balance for claims", async function () {
      // Create scenario where risk pool is insufficient
      await rainyDayFund.connect(farmer).buyPolicy(1); // 200 USDC premium
      
      // Set weather for payout (400 USDC needed, but only 200 USDC available)
      await rainyDayFund.updateWeatherData(1, 5);

      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 1n);

      // This should still work as the logic checks available balance
      await expect(rainyDayFund.connect(farmer).claimAll())
        .to.emit(rainyDayFund, "ClaimMade");
    });

    it("Should prevent double claiming", async function () {
      await rainyDayFund.connect(farmer).buyPolicy(1);
      await rainyDayFund.updateWeatherData(1, 5);

      const seasonEnd = await rainyDayFund.seasonOverTimeStamp();
      await time.increaseTo(seasonEnd + 1n);

      // First claim should work
      await rainyDayFund.connect(farmer).claimAll();

      // Second claim should fail (no tokens left)
      await expect(rainyDayFund.connect(farmer).claimAll())
        .to.be.revertedWith("No eligible claims");
    });
  });
});
