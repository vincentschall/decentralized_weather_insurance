// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

interface AggregatorV3Interface {
  function latestRoundData() external view returns (
    uint80 roundId,
    int256 answer,
    uint256 startedAt,
    uint256 updatedAt,
    uint80 answeredInRound
  );
}

contract RainyDayFund is ERC4626, Ownable, ReentrancyGuard {
  IERC20 public immutable usdc;

  uint256 public currentSeasonId;
  uint256 public seasonOverTimeStamp;
  uint256 public constant timeUnit = 30 days;
  uint256 premium = 9 * 10**6; // 9 USDC

  AggregatorV3Interface public weatherFeed;

  // Testing variables for time control
  uint256 public testingTimeOffset;
  bool public testingMode;

  enum SeasonState { ACTIVE, INACTIVE, CLAIM, WITHDRAW, FINISHED }

  struct SeasonPolicy {
    uint256 creationTimestamp;
    uint256 payoutAmount;
    uint256 premium;
    uint256 totalPoliciesSold;
    ERC20 policyToken;
  }

  mapping(uint256 => SeasonPolicy) public seasonPolicies;

  event PolicyBought(address indexed farmer, uint256 seasonId, uint256 amount, uint256 totalPremium);
  event ClaimMade(address indexed farmer, uint256 seasonId, uint256 amount, uint256 totalPayout);
  event InvestmentMade(address indexed investor, uint256 amount);
  event InvestmentWithdrawn(address indexed investor, uint256 amount);
  event NewSeasonStarted(uint256 seasonId, uint256 premium, uint256 payoutAmount);
  event TimeAdvanced(uint256 newTimestamp, SeasonState newState);

  constructor(address _usdcAddress, address _weatherOracle)
  ERC4626(IERC20Metadata(_usdcAddress))
  ERC20("RainyDay Investor Shares", "RDIS")
  Ownable(msg.sender)
  {
    require(_usdcAddress != address(0), "USDC address zero");
    usdc = IERC20(_usdcAddress);

    require(_weatherOracle != address(0), "Weather oracle zero");
    weatherFeed = AggregatorV3Interface(_weatherOracle);

    currentSeasonId = 1;
    _initializeSeason(currentSeasonId);
    seasonOverTimeStamp = getCurrentTime() + 2 * timeUnit; 

    // Enable testing mode by default for local testing
    testingMode = true;
  }

  // Testing function to get current time (can be offset in testing mode)
  function getCurrentTime() public view returns (uint256) {
    if (testingMode) {
      return block.timestamp + testingTimeOffset;
    }
    return block.timestamp;
  }

  // Testing function to advance time manually
  function advanceToNextPhase() external onlyOwner {
    require(testingMode, "Not in testing mode");

    SeasonState currentState = getSeasonState();
    uint256 nowBlock = block.timestamp;
    if (currentState == SeasonState.ACTIVE) {
      uint256 target = seasonOverTimeStamp - timeUnit + 1; // +1 to ensure inside the next phase
      testingTimeOffset = target - nowBlock;
    } else if (currentState == SeasonState.INACTIVE) {
      uint256 target = seasonOverTimeStamp + 1;
      testingTimeOffset = target - nowBlock;
    } else if (currentState == SeasonState.CLAIM) {
      uint256 target = seasonOverTimeStamp + timeUnit + 1;
      testingTimeOffset = target - nowBlock;
    } else if (currentState == SeasonState.WITHDRAW) {
      uint256 target = seasonOverTimeStamp + 2 * timeUnit + 1;
      testingTimeOffset = target - nowBlock;
    } else {
      // already finished, do nothing
      emit TimeAdvanced(getCurrentTime(), getSeasonState());
      return;
    }

    emit TimeAdvanced(getCurrentTime(), getSeasonState());
  }


  // Testing function to set testing mode
  function setTestingMode(bool _enabled) external onlyOwner {
    testingMode = _enabled;
    if (!_enabled) {
      testingTimeOffset = 0;
    }
  }

  function _initializeSeason(uint256 seasonId) internal {
    SeasonPolicyToken policyToken = new SeasonPolicyToken(
      string(abi.encodePacked("RainyDay Policy Season ", _toString(seasonId))),
      string(abi.encodePacked("RDP", _toString(seasonId))),
      address(this)
    );

    seasonPolicies[seasonId] = SeasonPolicy({
      creationTimestamp: getCurrentTime(),
      payoutAmount: premium * 4,
      premium: premium,
      totalPoliciesSold: 0,
      policyToken: policyToken
    });

    emit NewSeasonStarted(seasonId, premium, seasonPolicies[seasonId].payoutAmount);
  }

  function getSeasonState() public view returns (SeasonState) {
    uint256 currentTime = getCurrentTime();
    if (currentTime < seasonOverTimeStamp - timeUnit) {
      return SeasonState.ACTIVE;
    } else if (currentTime < seasonOverTimeStamp) {
      return SeasonState.INACTIVE;
    } else if (currentTime < seasonOverTimeStamp + timeUnit) {
      return SeasonState.CLAIM;
    } else if (currentTime < seasonOverTimeStamp + 2 * timeUnit) {
      return SeasonState.WITHDRAW;
    } else {
      return SeasonState.FINISHED;
    }
  }

  modifier onlyAfterFullSeasonCycle() {
    require(getSeasonState() == SeasonState.FINISHED, "Season not fully finished yet");
    _;
  }

  modifier onlyDuringSeason() {
    require(
      getSeasonState() == SeasonState.ACTIVE ||
      getSeasonState() == SeasonState.INACTIVE,
      "Season not active aymore");
      _;
  }

  function startNewSeason(uint256 _premium) external onlyOwner onlyAfterFullSeasonCycle {
    currentSeasonId++;
    premium = _premium;
    seasonOverTimeStamp = getCurrentTime() + 2 * timeUnit;
    _initializeSeason(currentSeasonId);
  }

  function buyPolicy(uint256 _amount) external nonReentrant returns (uint256 seasonId) {
    require(_amount > 0, "Amount > 0");
    require(getSeasonState() == SeasonState.ACTIVE, "Not in active period");

    SeasonPolicy storage policy = seasonPolicies[currentSeasonId];

    uint256 totalPremium = policy.premium * _amount;
    require(usdc.transferFrom(msg.sender, address(this), totalPremium), "Transfer failed");

    SeasonPolicyToken(address(policy.policyToken)).mint(msg.sender, _amount);
    policy.totalPoliciesSold += _amount;

    emit PolicyBought(msg.sender, currentSeasonId, _amount, totalPremium);
    return currentSeasonId;
  }

  function claimPolicies() external nonReentrant {
    require(getSeasonState() == SeasonState.CLAIM, "Not in claim period");

    SeasonPolicy storage policy = seasonPolicies[currentSeasonId];
    SeasonPolicyToken token = SeasonPolicyToken(address(policy.policyToken));
    uint256 amount = token.balanceOf(msg.sender);
    require(amount > 0, "No policies to claim");

    (,int256 weather,) = getWeatherData();
    require(uint256(weather) < 10, "Weather not bad enough");

    uint256 totalPayout = policy.payoutAmount * amount;
    require(usdc.balanceOf(address(this)) >= totalPayout, "Insufficient funds");

    require(usdc.transfer(msg.sender, totalPayout), "Payout failed");
    token.burnFrom(msg.sender, amount);

    emit ClaimMade(msg.sender, currentSeasonId, amount, totalPayout);
  }

  function getWeatherData() public view returns (uint80 roundId, int256 weather, uint256 timestamp) {
    (roundId, weather,,timestamp,) = weatherFeed.latestRoundData();
  }

  // ERC4626 investment logic
  function invest(uint256 assets) external nonReentrant onlyDuringSeason {
    require(assets > 0, "Amount > 0");
    deposit(assets, msg.sender);
    emit InvestmentMade(msg.sender, assets);
  }

  function redeemShares(uint256 shares) external nonReentrant {
    require(getSeasonState() == SeasonState.WITHDRAW, "Not in withdrawal period");
    uint256 assets = redeem(shares, msg.sender, msg.sender);
    emit InvestmentWithdrawn(msg.sender, assets);
  }

  function totalAssets() public view override returns (uint256) {
    return usdc.balanceOf(address(this));
  }

  // minimal utility
  function _toString(uint256 value) internal pure returns (string memory) {
    if (value == 0) return "0";
    uint256 temp = value;
    uint256 digits;
    while (temp != 0) { digits++; temp /= 10; }
    bytes memory buffer = new bytes(digits);
    while (value != 0) { digits--; buffer[digits] = bytes1(uint8(48 + value % 10)); value /= 10; }
    return string(buffer);
  }
}

contract SeasonPolicyToken is ERC20 {
  address public immutable rainyDayFund;
  modifier onlyRainyDayFund() { require(msg.sender == rainyDayFund, "Only fund"); _; }

  constructor(string memory name, string memory symbol, address _fund) ERC20(name, symbol) {
    rainyDayFund = _fund;
  }

  function mint(address to, uint256 amount) external onlyRainyDayFund { _mint(to, amount); }
  function burnFrom(address from, uint256 amount) external onlyRainyDayFund { _burn(from, amount); }
}
