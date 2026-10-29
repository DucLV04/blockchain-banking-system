const hre = require("hardhat");

async function main() {
  console.log("🚀 Bắt đầu setup contracts...");

  const [deployer] = await hre.ethers.getSigners();
  console.log("📍 Deploy bởi:", deployer.address);

  // 1. Deploy MockUSDC
  console.log("\n📦 Deploying MockUSDC...");
  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy(deployer.address);
  await mockUSDC.waitForDeployment();
  console.log("✅ MockUSDC deployed to:", await mockUSDC.getAddress());

  // Mint 10,000 USDC cho deployer
  await mockUSDC.mint(deployer.address, hre.ethers.parseUnits("10000", 6));
  console.log("💰 Đã mint 10,000 USDC cho deployer");

  // 2. Deploy VaultManager
  console.log("\n📦 Deploying VaultManager...");
  const VaultManager = await hre.ethers.getContractFactory("VaultManager");
  const vaultManager = await VaultManager.deploy(
    hre.ethers.ZeroAddress, // savingCore (sẽ set sau)
    deployer.address,       // feeReceiver
    await mockUSDC.getAddress()
  );
  await vaultManager.waitForDeployment();
  console.log("✅ VaultManager deployed to:", await vaultManager.getAddress());

  // 3. Deploy SavingCore
  console.log("\n📦 Deploying SavingCore...");
  const SavingCore = await hre.ethers.getContractFactory("SavingCore");
  const savingCore = await SavingCore.deploy(deployer.address);
  await savingCore.waitForDeployment();
  console.log("✅ SavingCore deployed to:", await savingCore.getAddress());

  // 4. Setup cross-contract references
  console.log("\n🔗 Thiết lập cross-contract references...");

  const tx1 = await savingCore.setVaultManager(await vaultManager.getAddress());
  await tx1.wait();
  console.log("✅ SavingCore -> setVaultManager");

  const tx2 = await savingCore.setMockUSDC(await mockUSDC.getAddress());
  await tx2.wait();
  console.log("✅ SavingCore -> setMockUSDC");

  const txFee = await savingCore.setFeeReceiver(deployer.address);
  await txFee.wait();
  console.log("✅ SavingCore -> setFeeReceiver");

  const tx3 = await vaultManager.setSavingCore(await savingCore.getAddress());
  await tx3.wait();
  console.log("✅ VaultManager -> setSavingCore");

  // 5. Tạo default saving plan (theo Student ID: xxxxx79, A=9, B=7)
  // DEFAULT_APR = 200 + A × 25 = 200 + 9 × 25 = 425 bps (4.25%)
  // DEFAULT_PENALTY = 300 + B × 50 = 300 + 7 × 50 = 650 bps (6.50%)
  // DEFAULT_TENOR = 180 days (Plan 1)
  console.log("\n📋 Tạo default saving plan...");
  const tx4 = await savingCore.createPlan(
    425,              // aprBps = 4.25% (200 + 9×25)
    650,              // penaltyBps = 6.50% (300 + 7×50)
    180,              // tenorDays = 180 ngày (Plan 1)
    hre.ethers.parseUnits("550", 6),  // minDeposit = 550 USDC
    hre.ethers.parseUnits("5500", 6)  // maxDeposit = 5500 USDC
  );
  await tx4.wait();
  console.log("✅ Default plan created (4.25% APR, 180 ngày)");

  // 6. Fund vault
  console.log("\n💰 Funding vault...");
  const vaultFunding = hre.ethers.parseUnits("1000", 6);
  const approveTx = await mockUSDC.approve(
    await vaultManager.getAddress(),
    vaultFunding
  );
  await approveTx.wait();
  console.log("✅ Đã approve MockUSDC cho VaultManager");

  const tx5 = await vaultManager.depositWithUSDC(vaultFunding);
  await tx5.wait();
  console.log("✅ Vault funded với 1000 USDC");

  // ===== KẾT QUẢ =====
  console.log("\n" + "=".repeat(60));
  console.log("🎉 SETUP HOÀN TẤT!");
  console.log("=".repeat(60));
  console.log("\n📍 Contract Addresses:");
  console.log("  MockUSDC:      ", await mockUSDC.getAddress());
  console.log("  VaultManager:  ", await vaultManager.getAddress());
  console.log("  SavingCore:    ", await savingCore.getAddress());
  console.log("\n📋 Default Plan:");
  console.log("  Plan ID:       1");
  console.log("  APR:           4.25% (425 bps)");
  console.log("  Tenor:         180 ngày");
  console.log("  Penalty:       6.50% (650 bps)");
  console.log("  Min Deposit:   550 USDC");
  console.log("  Max Deposit:   5500 USDC");
  console.log("\n💰 Test Account:");
  console.log("  Address:       ", deployer.address);
  console.log("  USDC Balance:  10,000");
  console.log("\n🌐 Network:");
  console.log("  Name:          ", hre.network.name);
  if (hre.network.name === "localhost" || hre.network.name === "hardhat") {
    console.log("  URL:           http://127.0.0.1:8545");
    console.log("  Chain ID:      31337");
  } else if (hre.network.name === "sepolia") {
    console.log("  Chain ID:      11155111");
    console.log("  Explorer:      https://sepolia.etherscan.io");
  }
  console.log("=".repeat(60));
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
