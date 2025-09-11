import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("RainyDayFundModule", (m) => {
  // Deploy MockUSDC first
  const mockUSDC = m.contract("MockUSDC");

  // Deploy RainyDayFund with MockUSDC address
  const rainyDayFund = m.contract("RainyDayFund", [mockUSDC]);

  return { mockUSDC, rainyDayFund };
});
