# Video Script – The Rainy-Day Fund

## Scene 1 – Opening: The Crisis
**Visuals:**  
Drone over barren Kenyan fields transitioning to ASAL map highlight. Stats pulse on screen: "2020-2023: 2.6M Livestock Lost • 4.4M People Need Aid." Cut to Mary tending withered crops, worried glance skyward.

**Voice-over:**  
Mary is a 38-year-old Kenyan farmer living in semi-arid lands where her entire livelihood depends on unpredictable rains. She has no irrigation and no safety net. The 2020-2023 drought—the worst in 40 years—killed 2.6 million livestock and left 4.4 million people facing hunger. Mary's harvest failed, and insurance that could have saved her farm remains out of reach.

## Scene 2 – The Structural Problem
**Visuals:**  
Infographics burst on screen: "89% of Kenya = ASALs • 98% Rain-Fed Agriculture • <1% Insured." Africa-wide zoom: "48M Smallholder Farmers • Only 3% Covered • $10-14B Protection Gap." Montage: Farmers struggling with debt, endless paperwork.

**Voice-over:**  
ASALs cover 89% of Kenya and are home to 36% of the population. Agriculture employs over 40% of Kenyans and contributes 21% to GDP, yet 98% of farms depend entirely on rainfall. Less than 1% of farmers have insurance. Across Sub-Saharan Africa, 48 million smallholder farmers face \$10-14 billion in annual climate risks, but coverage reaches only \$1-3 billion. This isn't fate—it's a design flaw. Manual claims take months to process, costs are prohibitively high, and opacity breeds distrust. As Mary says, "Why should I pay if they don't measure my reality?"

## Scene 3 – Why Previous Solutions Fall Short
**Visuals:**  
Split screen: weather station vs. distant farm with gap graphic showing 15-30km distance. KLIP/ACRE/Pula program icons with <5% uptake bar chart. Satellite imagery showing basis risk mismatch.

**Voice-over:**  
Weather Index Insurance promised a breakthrough by using objective weather triggers instead of costly farm inspections. It's faster and cheaper than traditional insurance. KLIP delivered multi-million-shilling payouts when drought thresholds were met, and ACRE bundled coverage for 17,000 farmers through blockchain pilots. Pula scaled using satellite data. Yet uptake remains under 5% due to expensive premiums, confusing and slow triggers and basis risk. Weather stations miss localized dry spells, so Mary can lose everything while receiving nothing. Premiums are due at planting time when farmers are most cash-strapped and even if everything goes right payouts take too long to truly help, when it is needed. As a result, 97% of farmers stay completely exposed.

## Scene 4 – Our Solution: The Rainy-Day Fund
**Visuals:**  
Logo ignites on screen. System diagram flows: Farmers → Smart Contracts → Vault → Oracles → M-Pesa. Visual transition from chaotic gears labeled "Traditional Insurance" to smooth flowing water labeled "Blockchain Trust."

**Voice-over:**  
Enter the Rainy-Day Fund: blockchain-powered parametric insurance built specifically for farmers like Mary. Smart contracts handle everything—policy issuance, premium pooling, and quick payouts—with zero human intervention and minimal overhead. Immutable blockchain ledgers provide complete transparency, making every transaction verifiable and auditable. Claims settle in seconds, not weeks. Pilots like Etherisc have already proven this model works; we're building to show how easy it could be.

## Scene 5 – How It Works: The Farmer Experience
**Visuals:**  
Mobile app walkthrough: Select coverage → M-Pesa payment → *buyPolicy()* mints token on blockchain → Oracle data feeds updating → *claimPolicies()* verifies conditions → USDC payout. Example overlay: "9 USDC Premium → 36 USDC Payout Protection."

**Voice-over:**  
When planting season arrives, Mary opens the app, she selects her drought coverage, which can scale depending on her needs. She pays via M-Pesa, which seamlessly bridges to stablecoin USDC. The smart contract instantly mints an ERC-20 policy token—her verifiable proof of coverage that she can hold or even trade. Throughout the season, decentralized oracles will integrate data from weather stations, satellites, and vegetation indices to minimize basis risk. At season's end, Mary submits a simple claim. The contract automatically verifies her token, checks the rainfall trigger against oracle data, and confirms vault funding. If conditions are met, 36 USDC flows instantly to her wallet or M-Pesa. No intermediaries, no delays, no denials—just code-enforced protection that puts farmers in control.

## Scene 6 – How It Works: The Investment Side
**Visuals:**  
Vault diagram animation: USDC deposits → ERC-4626 shares minted → Premium inflows pooling → Payout outflows → Yield graph showing profit in mild years, losses in drought years, with compounding NAV curve.

**Voice-over:**  
The system is funded through an ERC-4626 vault where impact investors deposit USDC and receive proportional shares. Farmer premiums flow into the pool, while claims are paid out automatically. In mild years, investors earn returns from premium surplus; in drought years, they absorb losses—hedging the exact risks that farmers cannot bear alone. Unclaimed funds compound over time, and everything operates on-chain with real-time transparency. It's proportional, auditable, and free of hidden fees.

## Scene 7 – The Auction Mechanism
**Visuals:**  
Animated auction simulation: sealed bids and offers → supply/demand curves crossing → clearing price decomposition showing expected payout plus risk margin. Text overlay: "Truthful Bidding → Fair Market Price."

**Voice-over:**  
But how are premiums set fairly? Through a sealed-bid uniform-price auction each season. Farmers bid for coverage units and their maximum willingness to pay, while investors offer capital with minimum yield requirements. The smart contract clears at a single market price where supply meets demand, naturally decomposing into expected payout plus a risk premium. Allocation is proportional, and truthful bidding is rewarded—no manipulation, no games. It functions as a climate prediction market where crowd wisdom reveals the true cost of risk.

## Scene 8 – Real Impact
**Visuals:**  
Map zoom sequence: Mary's plot → Makueni County → Kenya → East Africa region. Impact statistics pop up: "+13-24% Investment in Seeds • Children Stay in School • Faster Drought Recovery." Academic citations fade in at bottom.

**Voice-over:**  
With reliable protection, Mary invests more boldly in her farm. Research shows weather insurance increases seed and fertilizer spending by 13-24%, keeps children in school during droughts, and helps families rebuild livestock herds faster—breaking the poverty trap. Blockchain's marginal cost approaches zero, so one smart contract can serve unlimited farmers. What starts with Makueni maize can expand to Ethiopian livestock and beyond. We have the technology to close the gap from 1.5 million insured farmers to all 48 million across Sub-Saharan Africa.

## Scene 9 – Technical Implementation
**Visuals:**  
Code stack visualization: *RainyDayFund.sol* state machine diagram (ACTIVE→CLAIM→WITHDRAW). ERC standard icons linking together. "93% Test Coverage" badge. Layer-2 network showing reduced gas costs.

**Voice-over:**  
The state machine manages seasonal lifecycles seamlessly. The ERC-4626 vault standardizes investor shares, while ERC-20 policy tokens are transferable and composable with DeFi. The system integrates Chainlink oracles for weather data, USDC for stable value, and M-Pesa for fiat conversion. We've achieved 93% test coverage across the full contract lifecycle. Next steps include integrating live oracle feeds, deploying to Layer-2 networks for sub-dollar transaction costs, and completing security audits. The foundation is solid.

## Scene 10 – Closing
**Visuals:**  
Mary checks her phone, rain begins falling on green fields, children playing nearby. Logo: "Rainy-Day Fund: Turning droughts into liquidity." Credits fade in: "University of Basel Blockchain Challenge 2025 • Group A: Ellena, Sabina, Noah, Vincent."

**Voice-over:**  
Mary and 48 million farmers like her deserve protection powered by algorithms, not administrators—by auditable code, not opaque bureaucracy—by instant payouts, not endless waiting. Blockchain parametric insurance serves the people who feed nations. Join the Rainy-Day Fund and help us shield the world's most resilient farmers.

---

**Production Notes:**
- **Timing:** ~5 minutes at conversational pace with pauses for visual emphasis
- **Tone Shifts:** Empathetic in Scenes 1-3, confident and energetic in Scenes 4-7, inspiring in Scenes 8-11
- **Transitions:** Use smooth dissolves for emotional scenes, quick cuts for technical demonstrations
- **Graphics:** Consider After Effects for animations; source authentic Kenyan farm footage from ethical stock providers
- **Music:** Build from somber opening to uplifting crescendo, with subtle tech undertones during system explanation
- **Key Emphasis Points:** Pause after statistics, slow down for Mary's quote, emphasize "instant" and "transparent" in solution sections
