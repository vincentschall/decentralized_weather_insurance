# Decentralized Weather Insurance

Group project (09/2025): EVM-based smart contract with react app for the blockchain challenge @University of Basel.

## Needed installations (not covered here)

- hardhat, node.js

## Quick startup guide

If this is your first run, go into /client and run `npm install`. Then do the same in the /contract folder. This will install all of the used dependencies.

**OPTION 1 (manual):**  
  - Navigate into /contract and run `npx hardhat node` to start your local blockchain.
  - In a new terminal, go into /contract again and run `npx hardhat run /scripts/deploy-for-testing.js --network localhost`. This deploys the contracts onto your local chain.
  - Copy the file `deployment-info.json` into /client/public.
  - Go to the /client folder and run `npm start`. This will launch the frontend at port 3000.

**OPTION 2 (automatic):**  
  - In the project root, run `node start.js` and watch!  

**In both cases,** go to the project root and run `node cleanup.js` to remove old files after running the program. Optionally, run `npx hardhat clean` in the contract folder to be extra sure.

## Important sidenote

Due to the implementation of the ERC4626 standard, buying a policy first (when the amount of currency in the riskpool is still 0),
will result in a critical break of the program. To use the frontend as intended, start by investing into 
the riskpool. Check the research paper for a more detailed breakdown.

<div style="text-align: center;">

![Ethereum](https://img.shields.io/badge/Ethereum-ETH-3C3C3D?logo=ethereum&logoColor=white)
![Solidity](https://img.shields.io/badge/Solidity-363636?logo=solidity&logoColor=white)

</div>
