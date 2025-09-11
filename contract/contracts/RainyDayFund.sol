// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

contract RainyDayFund is ERC1155, Ownable, ReentrancyGuard {
    IERC20 public immutable usdc;
    
    // Risk pool tracking
    uint256 public riskPoolBalance;
    uint256 public totalInvestorFunds;
    mapping(address => uint256) public investorShares;
    
    // Policy tracking - now using token IDs based on seasons
    uint256 public currentSeasonId;
    
    // Season tracking
    uint256 public seasonOverTimeStamp;
    uint256 constant timeUnit = 30 days;

    // Policy structure for each season
    struct SeasonPolicy {
        uint256 creationTimestamp;
        uint256 payoutAmount;
        uint256 premium;
        uint256 weatherData;
        bool weatherDataFetched;
        bool payoutEnabled;
        bool seasonActive;
    }
    
    mapping(uint256 => SeasonPolicy) public seasonPolicies;
    
    // Track individual policy claims (prevents double claiming)
    mapping(address => mapping(uint256 => uint256)) public claimedPolicies;
    
    // Weather oracle
    AggregatorV3Interface internal weatherFeed;
    bool public useChainlinkOracle = false;
    
    // Events
    event PolicyBought(address indexed farmer, uint256 seasonId, uint256 amount, uint256 totalPremium);
    event ClaimMade(address indexed farmer, uint256 seasonId, uint256 amount, uint256 totalPayout);
    event InvestmentMade(address indexed investor, uint256 amount);
    event InvestmentWithdrawn(address indexed investor, uint256 amount);
    event WeatherDataUpdated(uint256 seasonId, uint256 weatherData);
    event NewSeasonStarted(uint256 seasonId, uint256 premium, uint256 payoutAmount);

    constructor(address _usdcAddress) 
        ERC1155("") // Can be used to display metadata later, not used yet! 
        Ownable(msg.sender) 
    {
        usdc = IERC20(_usdcAddress);
        currentSeasonId = 1;
        _initializeSeason(currentSeasonId);
        seasonOverTimeStamp = block.timestamp + 60 days;
    }

    /**
     * @dev Initialize a new season with policy parameters
     */
    function _initializeSeason(uint256 seasonId) internal {
        uint256 premium = getCurrentPremium();
        seasonPolicies[seasonId] = SeasonPolicy({
            creationTimestamp: block.timestamp,
            payoutAmount: premium * 2, // 2x payout
            premium: premium,
            weatherData: 0,
            weatherDataFetched: false,
            payoutEnabled: false,
            seasonActive: true
        });
        
        emit NewSeasonStarted(seasonId, premium, premium * 2);
    }

    /**
     * @dev Start a new season (only owner)
     */
    function startNewSeason() external onlyOwner {
        // End current season
        seasonPolicies[currentSeasonId].seasonActive = false;
        
        // Start new season
        currentSeasonId++;
        seasonOverTimeStamp = block.timestamp + 60 days;
        _initializeSeason(currentSeasonId);
    }

    /**
     * @dev Calculate current premium based on supply/demand
     */
    function getCurrentPremium() public pure returns (uint256) {
        // Placeholder: Return base premium of 200 USDC
        return 200 * 10**6; // 200 USDC
    }

    /**
     * @dev Buy insurance policies as ERC-1155 tokens
     */
    function buyPolicy(uint256 _amount) external nonReentrant returns (uint256 seasonId) {
        require(_amount > 0, "Amount must be > 0");
        require(block.timestamp < (seasonOverTimeStamp - timeUnit), "Policy sales ended");
        require(seasonPolicies[currentSeasonId].seasonActive, "Season not active");
        
        SeasonPolicy storage policy = seasonPolicies[currentSeasonId];
        uint256 totalPremium = policy.premium * _amount;
        
        require(usdc.transferFrom(msg.sender, address(this), totalPremium), "Transfer failed");

        // Mint ERC-1155 tokens representing the policies
        _mint(msg.sender, currentSeasonId, _amount, "");

        riskPoolBalance += totalPremium;
        emit PolicyBought(msg.sender, currentSeasonId, _amount, totalPremium);
        
        return currentSeasonId;
    }

    /**
     * @dev Batch claim all eligible policies across multiple seasons
     */
    function claimAll() external nonReentrant {
        uint256 totalPayout = 0;
        uint256 totalClaimed = 0;
        
        // Check all seasons where user has policies
        for (uint256 seasonId = 1; seasonId <= currentSeasonId; seasonId++) {
            uint256 userBalance = balanceOf(msg.sender, seasonId);
            if (userBalance > 0 && _isPolicyClaimable(seasonId)) {
                SeasonPolicy storage policy = seasonPolicies[seasonId];
                uint256 seasonPayout = policy.payoutAmount * userBalance;
                
                if (seasonPayout <= riskPoolBalance - totalPayout) {
                    totalPayout += seasonPayout;
                    totalClaimed += userBalance;
                    
                    // Update claimed amount
                    claimedPolicies[msg.sender][seasonId] += userBalance;
                    
                    // Burn the tokens
                    _burn(msg.sender, seasonId, userBalance);
                    
                    emit ClaimMade(msg.sender, seasonId, userBalance, seasonPayout);
                }
            }
        }
        
        require(totalClaimed > 0, "No eligible claims");
        riskPoolBalance -= totalPayout;
        require(usdc.transfer(msg.sender, totalPayout), "Payout failed");
    }

    /**
     * @dev Check if policies from a season are claimable
     */
    function _isPolicyClaimable(uint256 seasonId) internal view returns (bool) {
        SeasonPolicy storage policy = seasonPolicies[seasonId];
        return (policy.payoutEnabled &&
                block.timestamp > seasonOverTimeStamp &&
                block.timestamp < (seasonOverTimeStamp + timeUnit) &&
                checkWeatherCondition(policy.weatherDataFetched, policy.weatherData));
    }

    /**
     * @dev Check weather condition for a season, 
     * for now simply checking manually set values for testing purposes, later include chainlink
     */
    function checkWeatherCondition(bool weatherDataFetched, uint256 weatherData) internal view returns (bool) {
        if (useChainlinkOracle && address(weatherFeed) != address(0)) {
            // TODO: Implement actual Chainlink weather data fetching
            return true; // Placeholder
        } else {
            return 
                weatherDataFetched && 
                weatherData < 10;
        }
    }

     /**
     * @dev Owner updates weather data for a season
     */
    function updateWeatherData(uint256 seasonId, uint256 weatherData) external onlyOwner {
        require(seasonId <= currentSeasonId, "Season doesn't exist");
        SeasonPolicy storage policy = seasonPolicies[seasonId];
        policy.weatherData = weatherData;
        policy.weatherDataFetched = true;
        policy.payoutEnabled = true;
        
        emit WeatherDataUpdated(seasonId, weatherData);
    }

    /**
     * @dev Set Chainlink oracle address and enable/disable oracle usage
     * @param _oracleAddress Address of the Chainlink weather oracle (can be zero to disable)
     * @param _useChainlink Whether to use Chainlink oracle or manual weather data
     */
    function setWeatherOracle(address _oracleAddress, bool _useChainlink) external onlyOwner {
        if (_useChainlink) {
            require(_oracleAddress != address(0), "Oracle address cannot be zero when enabling Chainlink");
        }
        
        weatherFeed = AggregatorV3Interface(_oracleAddress);
        useChainlinkOracle = _useChainlink;
        
        // If switching to Chainlink, enable payouts for seasons that have been processed manually
        if (_useChainlink) {
            for (uint256 i = 1; i <= currentSeasonId; i++) {
                if (!seasonPolicies[i].seasonActive && seasonPolicies[i].weatherDataFetched) {
                    seasonPolicies[i].payoutEnabled = true;
                }
            }
        }
    }

    // ================== INVESTOR FUNCTIONS ==================

    function invest(uint256 amount) external nonReentrant {
        require(amount > 0, "Amount must be > 0");
        require(usdc.transferFrom(msg.sender, address(this), amount), "Transfer failed");

        investorShares[msg.sender] += amount;
        totalInvestorFunds += amount;
        riskPoolBalance += amount;

        emit InvestmentMade(msg.sender, amount);
    }

    function withdraw() external nonReentrant {
        require(
            block.timestamp > (seasonOverTimeStamp + 2 * timeUnit) &&
            block.timestamp < (seasonOverTimeStamp + 3 * timeUnit),
            "Withdrawal period not active"
        );

        uint256 shareAmount = investorShares[msg.sender];
        require(shareAmount > 0, "No investment found");
        
        uint256 withdrawAmount = (shareAmount * riskPoolBalance) / totalInvestorFunds;
        
        investorShares[msg.sender] = 0; // Fixed: was -= 0
        totalInvestorFunds -= shareAmount;
        riskPoolBalance -= withdrawAmount;

        require(usdc.transfer(msg.sender, withdrawAmount), "Withdrawal failed");
        emit InvestmentWithdrawn(msg.sender, withdrawAmount);
    }

    // ================== VIEW FUNCTIONS ==================

    function getPolicyInfo(uint256 seasonId) external view returns (SeasonPolicy memory) {
        return seasonPolicies[seasonId];
    }

    function getUserPolicies(address user) external view returns (uint256[] memory seasonIds, uint256[] memory amounts) {
        uint256[] memory tempSeasonIds = new uint256[](currentSeasonId);
        uint256[] memory tempAmounts = new uint256[](currentSeasonId);
        uint256 count = 0;

        for (uint256 i = 1; i <= currentSeasonId; i++) {
            uint256 balance = balanceOf(user, i);
            if (balance > 0) {
                tempSeasonIds[count] = i;
                tempAmounts[count] = balance;
                count++;
            }
        }

        seasonIds = new uint256[](count);
        amounts = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            seasonIds[i] = tempSeasonIds[i];
            amounts[i] = tempAmounts[i];
        }
    }

    function getClaimableInfo(address user) external view returns (uint256[] memory seasonIds, uint256[] memory amounts, uint256 totalClaimAmount) {
        uint256[] memory tempSeasonIds = new uint256[](currentSeasonId);
        uint256[] memory tempAmounts = new uint256[](currentSeasonId);
        uint256 count = 0;
        uint256 totalAmount = 0;

        for (uint256 i = 1; i <= currentSeasonId; i++) {
            uint256 balance = balanceOf(user, i);
            if (balance > 0 && _isPolicyClaimable(i)) {
                tempSeasonIds[count] = i;
                tempAmounts[count] = balance;
                totalAmount += seasonPolicies[i].payoutAmount * balance;
                count++;
            }
        }

        seasonIds = new uint256[](count);
        amounts = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            seasonIds[i] = tempSeasonIds[i];
            amounts[i] = tempAmounts[i];
        }

        return (seasonIds, amounts, totalAmount);
    }

    function getContractBalance() external view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    function getUserInvestment(address investor) external view returns (uint256) {
        return investorShares[investor];
    }

    /**
     * @dev Override required by Solidity for multiple inheritance
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }
}
