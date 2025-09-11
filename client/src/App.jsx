import { useState, useEffect } from "react";
import { ethers } from "ethers"; // Import ethers.js to interact with blockchain
import FarmersTab from "./components/FarmersTab";
import InvestorsTab from "./components/InvestorsTab";
import logo from "./assets/logo.jpg";

// Minimal ERC20 ABI for reading balance, decimals, and symbol
const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)"
];

// Replace with your deployed ERC-20 token contract address on Sepolia
const TOKEN_ADDRESS = "0x1fEC06A6e44c964792193485FCF19563B99B90fd";

export default function App() {
  const [activeTab, setActiveTab] = useState("farmers");
  const [walletAddress, setWalletAddress] = useState("");
  const [tokenBalance, setTokenBalance] = useState("");
  const [isConnected, setIsConnected] = useState(false);

  // Check if MetaMask is installed in the browser
  const isMetaMaskInstalled = () => {
    return typeof window !== "undefined" && typeof window.ethereum !== "undefined";
  };

  // Connect wallet and ensure Sepolia network is selected
  const connectWallet = async () => {
    if (!isMetaMaskInstalled()) {
      alert("Please install MetaMask!");
      return;
    }

    try {
      // Force MetaMask to switch to Sepolia
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0xaa36a7" }], // Sepolia chain ID
      });

      // Force MetaMask to show account selector by requesting permissions
      await window.ethereum.request({
        method: "wallet_requestPermissions",
        params: [{ eth_accounts: {} }],
      });

      // Then request accounts (this will now show the selector)
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });

      if (accounts.length > 0) {
        setWalletAddress(accounts[0]);
        setIsConnected(true);
        await getTokenBalance(accounts[0]);
      }
    } catch (error) {
      console.error("Failed to connect wallet:", error);
    }
  };

  // Fetch ERC-20 token balance from Sepolia contract
  const getTokenBalance = async (address) => {
    try {
      // Connect to blockchain using MetaMask provider
      const provider = new ethers.BrowserProvider(window.ethereum);

      // Connect to ERC-20 token contract
      const contract = new ethers.Contract(TOKEN_ADDRESS, ERC20_ABI, provider);

      // Fetch balance, decimals, and symbol in parallel
      const [balance, decimals, symbol] = await Promise.all([
        contract.balanceOf(address),
        contract.decimals(),
        contract.symbol()
      ]);

      // Convert balance to human-readable format
      const formattedBalance = ethers.formatUnits(balance, decimals);

      // Save formatted balance with token symbol
      setTokenBalance(`${parseFloat(formattedBalance).toFixed(4)} ${symbol}`);
    } catch (error) {
      console.error("Failed to get token balance:", error);
    }
  };

  // Disconnect wallet (clear state)
  const disconnectWallet = () => {
    setWalletAddress("");
    setTokenBalance("");
    setIsConnected(false);
  };

  // Listen for account changes in MetaMask
  useEffect(() => {
    if (isMetaMaskInstalled()) {
      const handleAccountsChanged = (accounts) => {
        if (accounts.length > 0) {
          setWalletAddress(accounts[0]);
          getTokenBalance(accounts[0]);
        } else {
          disconnectWallet();
        }
      };

      window.ethereum.on("accountsChanged", handleAccountsChanged);

      return () => {
        window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
      };
    }
  }, []);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-blue-500 to-blue-200 relative overflow-hidden px-4">
      {/* Wallet Connection Box */}
      <div className="absolute top-4 right-4 z-10">
        {isConnected ? (
          <div className="bg-white rounded-lg shadow-lg p-4 max-w-xs">
            <div className="text-sm text-gray-600 mb-2">Connected Wallet</div>

            {/* Display shortened wallet address */}
            <div className="text-xs font-mono bg-gray-100 p-2 rounded mb-2">
              {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
            </div>

            {/* Display token balance */}
            <div className="text-lg font-semibold text-[#2596be] mb-2">
              {tokenBalance}
            </div>

            {/* Disconnect button */}
            <button
              onClick={disconnectWallet}
              className="w-full bg-red-500 text-white px-3 py-1 rounded text-sm hover:bg-red-600 transition-colors"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={connectWallet}
            className="bg-[#2870ff] text-white px-4 py-2 rounded-lg shadow-lg hover:bg-blue-600 transition-colors font-semibold"
          >
            Connect Wallet
          </button>
        )}
      </div>

      {/* Logo */}
      <img
        src={logo}
        alt="Logo"
        className="h-32 mb-6 rounded-lg shadow-xl object-contain z-10"
      />

      {/* Title */}
      <h1 className="text-4xl md:text-5xl font-extrabold mb-2 text-center text-white z-10">
        The Rainy Day Fund
      </h1>
      <p className="text-center text-white mb-8 max-w-2xl z-10">
        EVM-based decentralized weather index insurance. Transparent, fast and trustworthy. Protect your farm or invest in resilience!
      </p>

      {/* Tabs */}
      <div className="flex space-x-6 mb-8 z-10">
        <button
          className={`px-6 py-3 rounded-full font-semibold transition-all duration-300 shadow-md ${
            activeTab === "farmers"
              ? "bg-white text-[#2870ff] scale-105 shadow-lg"
              : "bg-blue-100 text-[#2870ff] hover:bg-white hover:text-[#2870ff]"
          }`}
          onClick={() => setActiveTab("farmers")}
        >
          Farmers
        </button>
        <button
          className={`px-6 py-3 rounded-full font-semibold transition-all duration-300 shadow-md ${
            activeTab === "investors"
              ? "bg-white text-[#2870ff] scale-105 shadow-lg"
              : "bg-blue-100 text-[#2870ff] hover:bg-white hover:text-[#2870ff]"
          }`}
          onClick={() => setActiveTab("investors")}
        >
          Investors
        </button>
      </div>

      {/* Active Tab Content */}
      <div className="w-full max-w-md z-10">
        {activeTab === "farmers" ? <FarmersTab /> : <InvestorsTab />}
      </div>
    </div>
  );
}
