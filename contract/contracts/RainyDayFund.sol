// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
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
    uint256 constant timeUnit = 1 minutes; // short for demo
    uint256 premium = 9 * 10**6; // 9 USDC

    AggregatorV3Interface public weatherFeed;

    enum SeasonState { ACTIVE, CLAIM, WITHDRAW, FINISHED }

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
        seasonOverTimeStamp = block.timestamp + 2 * timeUnit; // short demo
    }

    function _initializeSeason(uint256 seasonId) internal {
        SeasonPolicyToken policyToken = new SeasonPolicyToken(
            string(abi.encodePacked("RainyDay Policy Season ", _toString(seasonId))),
            string(abi.encodePacked("RDP", _toString(seasonId))),
            address(this)
        );

        seasonPolicies[seasonId] = SeasonPolicy({
            creationTimestamp: block.timestamp,
            payoutAmount: premium * 2,
            premium: premium,
            totalPoliciesSold: 0,
            policyToken: policyToken
        });

        emit NewSeasonStarted(seasonId, premium, premium * 2);
    }

    function getSeasonState() public view returns (SeasonState) {
        if (block.timestamp < seasonOverTimeStamp) {
            return SeasonState.ACTIVE;
        } else if (block.timestamp < seasonOverTimeStamp + timeUnit) {
            return SeasonState.CLAIM;
        } else if (block.timestamp < seasonOverTimeStamp + 2 * timeUnit) {
            return SeasonState.WITHDRAW;
        } else {
            return SeasonState.FINISHED;
        }
    }

    modifier onlyAfterFullSeasonCycle() {
        require(getSeasonState() == SeasonState.FINISHED, "Season not fully finished yet");
        _;
    }

    function startNewSeason(uint256 _premium) external onlyOwner onlyAfterFullSeasonCycle {
        currentSeasonId++;
        premium = _premium;
        seasonOverTimeStamp = block.timestamp + 2 * timeUnit;
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

        token.burnFrom(msg.sender, amount);
        require(usdc.transfer(msg.sender, totalPayout), "Payout failed");

        emit ClaimMade(msg.sender, currentSeasonId, amount, totalPayout);
    }

    function getWeatherData() public view returns (uint80 roundId, int256 weather, uint256 timestamp) {
        (roundId, weather,,timestamp,) = weatherFeed.latestRoundData();
    }

    // ERC4626 investment logic
    function invest(uint256 assets) external nonReentrant {
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
