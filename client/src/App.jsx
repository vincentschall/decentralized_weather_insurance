import React, { useState, useEffect } from 'react';
import { ethers } from 'ethers';
import { AlertCircle, Users, TrendingUp, CloudRain, Sun, Clock, DollarSign } from 'lucide-react';

// Contract ABIs (simplified for the functions we need)
const MOCK_USDC_ABI = [
  "constructor()",
  "function mint(address to, uint256 amount) external",
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)"
];

const MOCK_WEATHER_ORACLE_ABI = [
  "constructor(int256 _initialWeather)",
  "function updatePrice(int256 _newWeather) external",
  "function latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)"
];

const RAINY_DAY_FUND_ABI = [
  "constructor(address _usdcAddress, address _weatherOracle)",
  "function currentSeasonId() view returns (uint256)",
  "function getSeasonState() view returns (uint8)",
  "function seasonPolicies(uint256) view returns (uint256 creationTimestamp, uint256 payoutAmount, uint256 premium, uint256 totalPoliciesSold, address policyToken)",
  "function buyPolicy(uint256 _amount) external returns (uint256)",
  "function claimPolicies() external",
  "function invest(uint256 assets) external",
  "function redeemShares(uint256 shares) external",
  "function advanceToNextPhase() external",
  "function startNewSeason(uint256 _premium) external",
  "function totalAssets() view returns (uint256)",
  "function balanceOf(address owner) view returns (uint256)",
  "function getWeatherData() view returns (uint80 roundId, int256 weather, uint256 timestamp)"
];

const SEASON_POLICY_TOKEN_ABI = [
  "function balanceOf(address owner) view returns (uint256)"
];

const seasonStateNames = ['ACTIVE', 'CLAIM', 'WITHDRAW', 'FINISHED'];

export default function TestingInterface() {
  const [deployed, setDeployed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState([]);
  
  // Contract instances
  const [provider, setProvider] = useState(null);
  const [contracts, setContracts] = useState({});
  const [accounts, setAccounts] = useState({});
  
  // Contract state
  const [contractState, setContractState] = useState({
    currentSeasonId: 0,
    seasonState: 0,
    premium: 0,
    payoutAmount: 0,
    totalPoliciesSold: 0,
    contractBalance: 0,
    weatherValue: 0
  });
  
  // Account balances
  const [balances, setBalances] = useState({
    farmer1: { usdcBalance: 0, policyTokens: 0, shares: 0 },
    farmer2: { usdcBalance: 0, policyTokens: 0, shares: 0 },
    investor1: { usdcBalance: 0, policyTokens: 0, shares: 0 },
    investor2: { usdcBalance: 0, policyTokens: 0, shares: 0 }
  });

  const addLog = (message, type = 'info') => {
    const timestamp = new Date().toLocaleTimeString();
    setLogs(prev => [...prev, { timestamp, message, type }]);
  };

  const connectToDeployedContracts = async () => {
    try {
      setLoading(true);
      addLog('🔌 Connecting to deployed contracts...', 'info');

      // Create local provider
      const localProvider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
      setProvider(localProvider);

      // Read deployment info (you'll need to run the deploy script first)
      let deploymentInfo;
      try {
        const response = await fetch('/deployment-info.json');
        deploymentInfo = await response.json();
        addLog('✅ Found deployment info', 'success');
      } catch (error) {
        addLog('❌ No deployment-info.json found. Please run deployment script first.', 'error');
        throw new Error('Deployment info not found. Run: npx hardhat run scripts/deploy-for-testing.js --network localhost');
      }

      // Get signers using the deployed account addresses
      const owner = await localProvider.getSigner(deploymentInfo.accounts.owner);
      const farmer1 = await localProvider.getSigner(deploymentInfo.accounts.farmer1);
      const farmer2 = await localProvider.getSigner(deploymentInfo.accounts.farmer2);
      const investor1 = await localProvider.getSigner(deploymentInfo.accounts.investor1);
      const investor2 = await localProvider.getSigner(deploymentInfo.accounts.investor2);

      setAccounts({ owner, farmer1, farmer2, investor1, investor2 });
      addLog('✅ Connected to local Hardhat network', 'success');

      // Connect to deployed contracts
      const mockUSDC = new ethers.Contract(
        deploymentInfo.contracts.MockUSDC,
        MOCK_USDC_ABI,
        localProvider
      );
      
      const mockWeatherOracle = new ethers.Contract(
        deploymentInfo.contracts.MockWeatherOracle,
        MOCK_WEATHER_ORACLE_ABI,
        localProvider
      );
      
      const rainyDayFund = new ethers.Contract(
        deploymentInfo.contracts.RainyDayFund,
        RAINY_DAY_FUND_ABI,
        localProvider
      );

      addLog('✅ Connected to deployed contracts', 'success');
      
      setContracts({ mockUSDC, mockWeatherOracle, rainyDayFund });
      setDeployed(true);
      await updateAllData();
      
      addLog('🎉 Ready for testing!', 'success');
    } catch (error) {
      addLog(`❌ Connection failed: ${error.message}`, 'error');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const updateAllData = async () => {
    if (!contracts.rainyDayFund) return;

    try {
      // Get contract state
      const seasonId = await contracts.rainyDayFund.currentSeasonId();
      const seasonState = await contracts.rainyDayFund.getSeasonState();
      const seasonInfo = await contracts.rainyDayFund.seasonPolicies(seasonId);
      const totalAssets = await contracts.rainyDayFund.totalAssets();
      const weatherData = await contracts.rainyDayFund.getWeatherData();

      setContractState({
        currentSeasonId: Number(seasonId),
        seasonState: Number(seasonState),
        premium: Number(ethers.formatUnits(seasonInfo.premium, 6)),
        payoutAmount: Number(ethers.formatUnits(seasonInfo.payoutAmount, 6)),
        totalPoliciesSold: Number(seasonInfo.totalPoliciesSold),
        contractBalance: Number(ethers.formatUnits(totalAssets, 6)),
        weatherValue: Number(weatherData.weather)
      });

      // Get policy token contract
      const policyTokenAddress = seasonInfo.policyToken;
      const policyToken = new ethers.Contract(policyTokenAddress, SEASON_POLICY_TOKEN_ABI, provider);

      // Update balances
      const newBalances = {};
      for (const [key, signer] of Object.entries(accounts)) {
        if (key === 'owner') continue;
        
        const usdcBalance = await contracts.mockUSDC.balanceOf(signer.address);
        const policyTokens = await policyToken.balanceOf(signer.address);
        const shares = await contracts.rainyDayFund.balanceOf(signer.address);

        newBalances[key] = {
          usdcBalance: Number(ethers.formatUnits(usdcBalance, 6)),
          policyTokens: Number(policyTokens),
          shares: Number(ethers.formatUnits(shares, 18))
        };
      }
      setBalances(newBalances);

    } catch (error) {
      console.error('Error updating data:', error);
    }
  };

  const setWeather = async (value) => {
    try {
      setLoading(true);
      const tx = await contracts.mockWeatherOracle.connect(accounts.owner).updatePrice(value);
      await tx.wait();
      addLog(`🌤️ Weather set to ${value} (${value < 10 ? 'Bad - Payout eligible' : 'Good - No payout'})`, 'success');
      await updateAllData();
    } catch (error) {
      addLog(`❌ Failed to set weather: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const advancePhase = async () => {
    try {
      setLoading(true);
      const tx = await contracts.rainyDayFund.connect(accounts.owner).advanceToNextPhase();
      await tx.wait();
      await updateAllData();
      addLog(`⏰ Advanced to next phase`, 'success');
    } catch (error) {
      addLog(`❌ Failed to advance phase: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const buyPolicy = async (farmerKey, amount) => {
    try {
      setLoading(true);
      const farmer = accounts[farmerKey];
      const tx = await contracts.rainyDayFund.connect(farmer).buyPolicy(amount);
      await tx.wait();
      addLog(`✅ ${farmerKey} bought ${amount} policies`, 'success');
      await updateAllData();
    } catch (error) {
      addLog(`❌ Failed to buy policy: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const claimPolicies = async (farmerKey) => {
    try {
      setLoading(true);
      const farmer = accounts[farmerKey];
      const tx = await contracts.rainyDayFund.connect(farmer).claimPolicies();
      await tx.wait();
      addLog(`✅ ${farmerKey} claimed policies`, 'success');
      await updateAllData();
    } catch (error) {
      addLog(`❌ Failed to claim: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const invest = async (investorKey, amount) => {
    try {
      setLoading(true);
      const investor = accounts[investorKey];
      const amountWei = ethers.parseUnits(amount.toString(), 6);
      const tx = await contracts.rainyDayFund.connect(investor).invest(amountWei);
      await tx.wait();
      addLog(`✅ ${investorKey} invested ${amount} USDC`, 'success');
      await updateAllData();
    } catch (error) {
      addLog(`❌ Failed to invest: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const withdraw = async (investorKey) => {
    try {
      setLoading(true);
      const investor = accounts[investorKey];
      const sharesBalance = await contracts.rainyDayFund.balanceOf(investor.address);
      const tx = await contracts.rainyDayFund.connect(investor).redeemShares(sharesBalance);
      await tx.wait();
      addLog(`✅ ${investorKey} withdrew all shares`, 'success');
      await updateAllData();
    } catch (error) {
      addLog(`❌ Failed to withdraw: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const startNewSeason = async () => {
    try {
      setLoading(true);
      const newPremium = ethers.parseUnits('9', 6); // 9 USDC
      const tx = await contracts.rainyDayFund.connect(accounts.owner).startNewSeason(newPremium);
      await tx.wait();
      addLog(`✅ Started Season ${contractState.currentSeasonId + 1}`, 'success');
      await updateAllData();
    } catch (error) {
      addLog(`❌ Failed to start new season: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  if (!deployed) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-blue-500 to-blue-200 px-4">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-extrabold mb-2 text-white">
            RainyDayFund Testing Interface
          </h1>
          <p className="text-white text-lg mb-8">
            Real Solidity contract testing environment
          </p>
        </div>
        
        <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-md w-full">
          <div className="text-center">
            <AlertCircle className="w-16 h-16 text-blue-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Ready to Deploy</h2>
            <div className="text-sm text-gray-600 mb-6 text-left">
              <p className="mb-2">Prerequisites:</p>
              <ol className="list-decimal ml-4 space-y-1">
                <li>Run <code className="bg-gray-100 px-1 rounded">npx hardhat node</code> in your contracts folder</li>
                <li>Run <code className="bg-gray-100 px-1 rounded">npx hardhat run scripts/deploy-for-testing.js --network localhost</code></li>
                <li>Copy deployment-info.json to your React public folder</li>
              </ol>
            </div>
            <button
              onClick={connectToDeployedContracts}
              disabled={loading}
              className="w-full py-3 bg-blue-600 text-white font-semibold rounded-2xl shadow-md hover:bg-blue-700 transition-all duration-300 disabled:opacity-50"
            >
              {loading ? 'Connecting...' : 'Connect to Contracts'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-500 to-blue-200 p-4">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-4xl font-extrabold text-center text-white mb-2">
          RainyDayFund Testing Interface
        </h1>
        <p className="text-center text-white mb-8">Season {contractState.currentSeasonId} - {seasonStateNames[contractState.seasonState]} Phase</p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Admin Controls */}
          <div className="bg-white rounded-3xl p-6 shadow-2xl">
            <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center">
              <Settings className="w-6 h-6 mr-2" />
              Admin Controls
            </h2>
            
            {/* Weather Control */}
            <div className="mb-6">
              <h3 className="font-semibold mb-2 flex items-center">
                {contractState.weatherValue < 10 ? <CloudRain className="w-4 h-4 mr-1" /> : <Sun className="w-4 h-4 mr-1" />}
                Weather: {contractState.weatherValue} {contractState.weatherValue < 10 ? '(Bad)' : '(Good)'}
              </h3>
              <div className="flex gap-2">
                <button
                  onClick={() => setWeather(5)}
                  disabled={loading}
                  className="px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600 text-sm disabled:opacity-50"
                >
                  Bad (5)
                </button>
                <button
                  onClick={() => setWeather(15)}
                  disabled={loading}
                  className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600 text-sm disabled:opacity-50"
                >
                  Good (15)
                </button>
              </div>
            </div>

            {/* Phase Control */}
            <div className="mb-6">
              <h3 className="font-semibold mb-2 flex items-center">
                <Clock className="w-4 h-4 mr-1" />
                Phase Control
              </h3>
              <button
                onClick={advancePhase}
                disabled={loading}
                className="w-full py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
              >
                Advance to Next Phase
              </button>
            </div>

            {/* Season Control */}
            {contractState.seasonState === 3 && (
              <div className="mb-4">
                <button
                  onClick={startNewSeason}
                  disabled={loading}
                  className="w-full py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  Start New Season
                </button>
              </div>
            )}
          </div>

          {/* Contract State */}
          <div className="bg-white rounded-3xl p-6 shadow-2xl">
            <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center">
              <TrendingUp className="w-6 h-6 mr-2" />
              Contract State
            </h2>
            
            <div className="space-y-3">
              <div className="flex justify-between">
                <span className="font-semibold">Season:</span>
                <span>{contractState.currentSeasonId}</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold">Phase:</span>
                <span className={`px-2 py-1 rounded text-sm ${
                  contractState.seasonState === 0 ? 'bg-green-100 text-green-800' :
                  contractState.seasonState === 1 ? 'bg-yellow-100 text-yellow-800' :
                  contractState.seasonState === 2 ? 'bg-blue-100 text-blue-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {seasonStateNames[contractState.seasonState]}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold">Premium:</span>
                <span>{contractState.premium} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold">Payout:</span>
                <span>{contractState.payoutAmount} USDC</span>
              </div>
              <div className="flex justify-between">
                <span className="font-semibold">Policies Sold:</span>
                <span>{contractState.totalPoliciesSold}</span>
              </div>
              <div className="border-t pt-2">
                <div className="flex justify-between font-bold">
                  <span>Risk Pool:</span>
                  <span>{contractState.contractBalance.toFixed(2)} USDC</span>
                </div>
              </div>
            </div>
          </div>

          {/* Activity Log */}
          <div className="bg-white rounded-3xl p-6 shadow-2xl">
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Activity Log</h2>
            <div className="h-64 overflow-y-auto space-y-1 text-sm">
              {logs.map((log, i) => (
                <div key={i} className={`p-2 rounded ${
                  log.type === 'success' ? 'bg-green-50 text-green-800' :
                  log.type === 'error' ? 'bg-red-50 text-red-800' :
                  'bg-gray-50 text-gray-800'
                }`}>
                  <span className="text-gray-500">{log.timestamp}</span> {log.message}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Address Balances and Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
          {/* Farmers */}
          <div className="bg-white rounded-3xl p-6 shadow-2xl">
            <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center">
              <Users className="w-6 h-6 mr-2" />
              Farmers
            </h2>
            
            {['farmer1', 'farmer2'].map((farmerKey) => (
              <div key={farmerKey} className="mb-6 p-4 bg-gray-50 rounded-lg">
                <h3 className="font-bold mb-2">{farmerKey.charAt(0).toUpperCase() + farmerKey.slice(1)}</h3>
                <div className="text-sm space-y-1 mb-3">
                  <div className="flex justify-between">
                    <span>USDC Balance:</span>
                    <span>{balances[farmerKey]?.usdcBalance?.toFixed(2) || '0'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Policy Tokens:</span>
                    <span>{balances[farmerKey]?.policyTokens || 0}</span>
                  </div>
                </div>
                
                <div className="space-y-2">
                  {contractState.seasonState === 0 && (
                    <div className="flex gap-1">
                      <button
                        onClick={() => buyPolicy(farmerKey, 1)}
                        disabled={loading}
                        className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
                      >
                        Buy 1 Policy
                      </button>
                      <button
                        onClick={() => buyPolicy(farmerKey, 3)}
                        disabled={loading}
                        className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700 disabled:opacity-50"
                      >
                        Buy 3 Policies
                      </button>
                    </div>
                  )}
                  
                  {contractState.seasonState === 1 && balances[farmerKey]?.policyTokens > 0 && (
                    <button
                      onClick={() => claimPolicies(farmerKey)}
                      disabled={loading}
                      className="w-full py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50"
                    >
                      Claim Policies
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Investors */}
          <div className="bg-white rounded-3xl p-6 shadow-2xl">
            <h2 className="text-2xl font-bold text-gray-800 mb-4 flex items-center">
              <DollarSign className="w-6 h-6 mr-2" />
              Investors
            </h2>
            
            {['investor1', 'investor2'].map((investorKey) => (
              <div key={investorKey} className="mb-6 p-4 bg-gray-50 rounded-lg">
                <h3 className="font-bold mb-2">{investorKey.charAt(0).toUpperCase() + investorKey.slice(1)}</h3>
                <div className="text-sm space-y-1 mb-3">
                  <div className="flex justify-between">
                    <span>USDC Balance:</span>
                    <span>{balances[investorKey]?.usdcBalance?.toFixed(2) || '0'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Investor Shares:</span>
                    <span>{balances[investorKey]?.shares?.toFixed(4) || '0'}</span>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="flex gap-1">
                    <button
                      onClick={() => invest(investorKey, 100)}
                      disabled={loading}
                      className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                    >
                      Invest 100
                    </button>
                    <button
                      onClick={() => invest(investorKey, 500)}
                      disabled={loading}
                      className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 disabled:opacity-50"
                    >
                      Invest 500
                    </button>
                  </div>
                  
                  {contractState.seasonState === 2 && balances[investorKey]?.shares > 0 && (
                    <button
                      onClick={() => withdraw(investorKey)}
                      disabled={loading}
                      className="w-full py-2 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
                    >
                      Withdraw All
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Settings icon component
const Settings = ({ className }) => (
  <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);
