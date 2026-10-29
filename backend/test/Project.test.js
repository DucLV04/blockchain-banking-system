const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const fs = require("fs");
const path = require("path");

const A = 9;
const B = 7;
const USDC = 10n ** 6n;
const GRACE_PERIOD = 2n * 86400n;
const DEFAULT_APR = 200n + BigInt(A) * 25n;
const DEFAULT_PENALTY = 300n + BigInt(B) * 50n;
const DEFAULT_TENOR = 180n;

let testResults = [];

afterEach(function () {
  if (this.currentTest) {
    testResults.push({
      suite: this.currentTest.parent.title,
      name: this.currentTest.title,
      status: this.currentTest.state
    });
  }
});

async function generateReport() {
  const resultsPath = path.join(__dirname, "report.html");
  const suites = {};
  testResults.forEach(r => {
    if (!suites[r.suite]) suites[r.suite] = { total: 0, passed: 0 };
    suites[r.suite].total++;
    if (r.status === "passed") suites[r.suite].passed++;
  });
  const totalAll = testResults.length;
  const passedAll = testResults.filter(t => t.status === "passed").length;
  const failAll = totalAll - passedAll;

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Test Report</title>
  <style>body{font-family:Arial,sans-serif;margin:20px;background:#f5f5f5}
  h1{color:#333}table{border-collapse:collapse;width:100%;margin-top:10px}
  th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#4CAF50;color:white}
  .pass{color:green}.fail{color:red}.summary{background:white;padding:15px;border-radius:5px;margin-top:10px}</style></head><body>
  <h1>Blockchain Online Banking System - Test Report</h1>
  <div class="summary"><h2>Summary</h2><p>Total: ${totalAll} | Passed: <span class="pass">${passedAll}</span> | Failed: <span class="fail">${failAll}</span></p></div>
  <h2>Results by Suite</h2><table><tr><th>Suite</th><th>Total</th><th>Passed</th><th>Failed</th></tr>`;
  for (const [name, s] of Object.entries(suites)) {
    html += `<tr><td>${name}</td><td>${s.total}</td><td class="pass">${s.passed}</td><td class="fail">${s.total - s.passed}</td></tr>`;
  }
  html += `</table><h2>Test Details</h2><table><tr><th>Suite</th><th>Test</th><th>Status</th></tr>`;
  testResults.forEach(r => {
    html += `<tr><td>${r.suite}</td><td>${r.name}</td><td class="${r.status}">${r.status}</td></tr>`;
  });
  html += `</table></body></html>`;
  fs.writeFileSync(resultsPath, html);
  console.log(`HTML Report generated: ${resultsPath}`);
}

after(async function () {
  await generateReport();
});

function interestFor(principal, aprBps, tenorDays) {
  return (principal * aprBps * tenorDays * 86400n) / (365n * 86400n * 10000n);
}

describe("Blockchain Online Banking System", function () {
  async function deployFixture() {
    const [owner, alice, bob, feeReceiver] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy(owner.address);

    const SavingCore = await ethers.getContractFactory("SavingCore");
    const savingCore = await SavingCore.deploy(owner.address);

    const VaultManager = await ethers.getContractFactory("VaultManager");
    const vaultManager = await VaultManager.deploy(
      await savingCore.getAddress(),
      feeReceiver.address,
      await mockUSDC.getAddress()
    );

    await savingCore.setVaultManager(await vaultManager.getAddress());
    await savingCore.setMockUSDC(await mockUSDC.getAddress());
    await savingCore.setFeeReceiver(feeReceiver.address);
    await vaultManager.setSavingCore(await savingCore.getAddress());
    await vaultManager.setFeeReceiver(feeReceiver.address);

    await mockUSDC.mint(owner.address, 1_000_000n * USDC);
    await mockUSDC.mint(alice.address, 100_000n * USDC);
    await mockUSDC.mint(bob.address, 10_000n * USDC);

    await mockUSDC.connect(owner).approve(await vaultManager.getAddress(), 100_000n * USDC);
    await vaultManager.depositWithUSDC(100_000n * USDC);

    await savingCore.createPlan(DEFAULT_APR, DEFAULT_PENALTY, DEFAULT_TENOR, 550n * USDC, 5500n * USDC);
    await mockUSDC.connect(alice).approve(await savingCore.getAddress(), 100_000n * USDC);
    await mockUSDC.connect(bob).approve(await savingCore.getAddress(), 10_000n * USDC);

    return { owner, alice, bob, feeReceiver, mockUSDC, savingCore, vaultManager };
  }

  let owner, alice, bob, feeReceiver, mockUSDC, savingCore, vaultManager;

  beforeEach(async function () {
    ({ owner, alice, bob, feeReceiver, mockUSDC, savingCore, vaultManager } = await loadFixture(deployFixture));
  });

  describe("1. MockUSDC", function () {
    it("Should use 6 decimals and allow public mint for testing", async function () {
      expect(await mockUSDC.decimals()).to.equal(6);

      const before = await mockUSDC.balanceOf(alice.address);
      await mockUSDC.connect(alice).mint(alice.address, 100n * USDC);
      expect(await mockUSDC.balanceOf(alice.address)).to.equal(before + 100n * USDC);
    });

    it("Should transfer tokens", async function () {
      await mockUSDC.connect(alice).transfer(bob.address, 50n * USDC);
      expect(await mockUSDC.balanceOf(bob.address)).to.equal(10_050n * USDC);
    });
  });

  describe("2. SavingCore - Plan Management", function () {
    it("Should create a valid plan with plan-level limits", async function () {
      await expect(savingCore.createPlan(250n, 500n, 30n, 100n * USDC, 5000n * USDC))
        .to.emit(savingCore, "PlanCreated");

      const plan = await savingCore.plans(2);
      expect(plan.aprBps).to.equal(250n);
      expect(plan.penaltyBps).to.equal(500n);
      expect(plan.tenorDays).to.equal(30n);
      expect(plan.minDeposit).to.equal(100n * USDC);
      expect(plan.maxDeposit).to.equal(5000n * USDC);
      expect(plan.isEnabled).to.equal(true);
    });

    it("Should reject invalid plan params", async function () {
      await expect(savingCore.createPlan(0n, DEFAULT_PENALTY, DEFAULT_TENOR, 0n, 0n))
        .to.be.revertedWithCustomError(savingCore, "InvalidPlanParams");
      await expect(savingCore.createPlan(10001n, DEFAULT_PENALTY, DEFAULT_TENOR, 0n, 0n))
        .to.be.revertedWithCustomError(savingCore, "InvalidPlanParams");
      await expect(savingCore.createPlan(DEFAULT_APR, 10001n, DEFAULT_TENOR, 0n, 0n))
        .to.be.revertedWithCustomError(savingCore, "InvalidPlanParams");
      await expect(savingCore.createPlan(DEFAULT_APR, DEFAULT_PENALTY, 0n, 0n, 0n))
        .to.be.revertedWithCustomError(savingCore, "InvalidPlanParams");
      await expect(savingCore.createPlan(DEFAULT_APR, DEFAULT_PENALTY, 3651n, 0n, 0n))
        .to.be.revertedWithCustomError(savingCore, "InvalidPlanParams");
      await expect(savingCore.createPlan(DEFAULT_APR, DEFAULT_PENALTY, DEFAULT_TENOR, 6000n, 5000n))
        .to.be.revertedWithCustomError(savingCore, "InvalidPlanParams");
    });

    it("Should update only APR, then disable and re-enable", async function () {
      await expect(savingCore.updatePlan(1, 500n))
        .to.emit(savingCore, "PlanUpdated")
        .withArgs(1, 500n);

      const plan = await savingCore.plans(1);
      expect(plan.aprBps).to.equal(500n);
      expect(plan.penaltyBps).to.equal(DEFAULT_PENALTY);
      expect(plan.tenorDays).to.equal(DEFAULT_TENOR);

      await expect(savingCore.updatePlan(1, 0n))
        .to.be.revertedWithCustomError(savingCore, "InvalidPlanParams");
      await expect(savingCore.updatePlan(1, 10001n))
        .to.be.revertedWithCustomError(savingCore, "InvalidPlanParams");

      await expect(savingCore.disablePlan(1))
        .to.emit(savingCore, "PlanUpdated")
        .withArgs(1, 500n);
      expect((await savingCore.getActivePlans()).length).to.equal(0);

      await expect(savingCore.enablePlan(1))
        .to.emit(savingCore, "PlanUpdated")
        .withArgs(1, 500n);
      expect((await savingCore.getActivePlans()).length).to.equal(1);
    });

    it("Should reject plan admin calls from non-owner", async function () {
      await expect(savingCore.connect(alice).createPlan(250n, 500n, 30n, 0n, 0n)).to.be.reverted;
      await expect(savingCore.connect(alice).updatePlan(1, 500n)).to.be.reverted;
      await expect(savingCore.connect(alice).disablePlan(1)).to.be.reverted;
      await expect(savingCore.connect(alice).enablePlan(1)).to.be.reverted;
    });

    it("Should reject unknown plans and unauthorized owner controls", async function () {
      await expect(savingCore.updatePlan(2, 500n))
        .to.be.revertedWithCustomError(savingCore, "PlanNotFound");
      await expect(savingCore.disablePlan(2)).to.be.revertedWith("Plan not found");
      await expect(savingCore.enablePlan(2)).to.be.revertedWith("Plan not found");
      await expect(savingCore.connect(alice).setVaultManager(await vaultManager.getAddress()))
        .to.be.revertedWithCustomError(savingCore, "OwnableUnauthorizedAccount");
      await expect(savingCore.connect(alice).setMockUSDC(await mockUSDC.getAddress()))
        .to.be.revertedWithCustomError(savingCore, "OwnableUnauthorizedAccount");
      await expect(savingCore.connect(alice).setFeeReceiver(bob.address))
        .to.be.revertedWithCustomError(savingCore, "OwnableUnauthorizedAccount");
    });
  });

  describe("3. SavingCore - Open Deposit", function () {
    it("Should open a deposit and snapshot plan values", async function () {
      await expect(savingCore.connect(alice).openDeposit(1, 1000n * USDC))
        .to.emit(savingCore, "DepositOpened");

      const dep = await savingCore.deposits(1);
      expect(dep.owner).to.equal(alice.address);
      expect(dep.planId).to.equal(1n);
      expect(dep.principal).to.equal(1000n * USDC);
      expect(dep.aprBpsAtOpen).to.equal(DEFAULT_APR);
      expect(dep.penaltyBpsAtOpen).to.equal(DEFAULT_PENALTY);
      expect(dep.maturityAt - dep.openTimestamp).to.equal(DEFAULT_TENOR * 86400n);
      expect(dep.status).to.equal(0n);
      expect(await savingCore.ownerOf(1)).to.equal(alice.address);
      expect(await mockUSDC.balanceOf(await savingCore.getAddress())).to.equal(1000n * USDC);
    });

    it("Should enforce plan-level min/max and zero amount", async function () {
      await expect(savingCore.connect(alice).openDeposit(1, 549n * USDC))
        .to.be.revertedWithCustomError(savingCore, "InvalidDepositAmount");
      await expect(savingCore.connect(alice).openDeposit(1, 5501n * USDC))
        .to.be.revertedWithCustomError(savingCore, "InvalidDepositAmount");
      await expect(savingCore.connect(alice).openDeposit(1, 0n))
        .to.be.revertedWithCustomError(savingCore, "InvalidDepositAmount");
    });

    it("Should treat zero plan limits as unlimited", async function () {
      await savingCore.createPlan(250n, 0n, 30n, 0n, 0n);
      await savingCore.connect(alice).openDeposit(2, 5n * USDC);
      expect((await savingCore.deposits(1)).principal).to.equal(5n * USDC);
    });

    it("Should reject disabled plans and missing allowance", async function () {
      await savingCore.disablePlan(1);
      await expect(savingCore.connect(alice).openDeposit(1, 1000n * USDC))
        .to.be.revertedWithCustomError(savingCore, "PlanDisabled");

      await expect(savingCore.connect(owner).openDeposit(1, 1000n * USDC)).to.be.reverted;
    });

    it("Should reject an unknown plan", async function () {
      await expect(savingCore.connect(alice).openDeposit(2, 1000n * USDC))
        .to.be.revertedWithCustomError(savingCore, "PlanNotFound");
    });
  });

  describe("4. SavingCore - Withdraw at Maturity", function () {
    it("Should pay principal plus capped interest and update status", async function () {
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      const dep = await savingCore.deposits(1);
      const expectedInterest = interestFor(1000n * USDC, DEFAULT_APR, DEFAULT_TENOR);
      const vaultBefore = await mockUSDC.balanceOf(await vaultManager.getAddress());

      await time.increaseTo(dep.maturityAt);
      const before = await mockUSDC.balanceOf(alice.address);
      await savingCore.connect(alice).withdrawAtMaturity(1);
      const after = await mockUSDC.balanceOf(alice.address);

      expect(after - before).to.equal(1000n * USDC + expectedInterest);
      expect((await savingCore.deposits(1)).status).to.equal(1n);
      expect(vaultBefore - (await mockUSDC.balanceOf(await vaultManager.getAddress()))).to.equal(expectedInterest);
    });

    it("Should reject before maturity and non-owner, then reject double withdraw", async function () {
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      const dep = await savingCore.deposits(1);

      await time.setNextBlockTimestamp(dep.maturityAt - 1n);
      await expect(savingCore.connect(alice).withdrawAtMaturity(1))
        .to.be.revertedWithCustomError(savingCore, "NotMatured");

      await time.setNextBlockTimestamp(dep.maturityAt);
      await expect(savingCore.connect(bob).withdrawAtMaturity(1))
        .to.be.revertedWithCustomError(savingCore, "NotDepositOwner");

      await savingCore.connect(alice).withdrawAtMaturity(1);
      await expect(savingCore.connect(alice).withdrawAtMaturity(1))
        .to.be.revertedWithCustomError(savingCore, "DepositNotActive");
    });

    it("Should reject invalid deposit identifiers", async function () {
      await expect(savingCore.connect(alice).withdrawAtMaturity(0))
        .to.be.revertedWithCustomError(savingCore, "DepositNotFound");
      await expect(savingCore.connect(alice).withdrawAtMaturity(2))
        .to.be.revertedWithCustomError(savingCore, "DepositNotFound");
    });

    it("Should cap interest after maturity", async function () {
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      const dep = await savingCore.deposits(1);
      const expectedInterest = interestFor(1000n * USDC, DEFAULT_APR, DEFAULT_TENOR);

      await time.increaseTo(dep.maturityAt + 30n * 86400n);
      expect(await savingCore.calculateInterest(1)).to.equal(expectedInterest);

      const before = await mockUSDC.balanceOf(alice.address);
      await savingCore.connect(alice).withdrawAtMaturity(1);
      expect((await mockUSDC.balanceOf(alice.address)) - before).to.equal(1000n * USDC + expectedInterest);
    });

    it("Should settle a zero-interest deposit when committed interest is not greater", async function () {
      await savingCore.createPlan(1n, 0n, 1n, 0n, 0n);
      await savingCore.connect(alice).openDeposit(2, 1n);
      const dep = await savingCore.deposits(1);

      await time.increaseTo(dep.maturityAt);
      await expect(savingCore.connect(alice).withdrawAtMaturity(1))
        .to.emit(savingCore, "Withdrawn")
        .withArgs(1n, alice.address, 1n, 0n, false);

      expect(await savingCore.totalCommittedInterest()).to.equal(0n);
      expect((await savingCore.deposits(1)).status).to.equal(1n);
    });

    it("Should reduce committed interest when other deposits remain active", async function () {
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      const dep = await savingCore.deposits(1);

      await time.increaseTo(dep.maturityAt);
      await savingCore.connect(alice).withdrawAtMaturity(1);

      expect(await savingCore.totalCommittedInterest()).to.equal(
        interestFor(1000n * USDC, DEFAULT_APR, DEFAULT_TENOR),
      );
      expect((await savingCore.deposits(1)).status).to.equal(1n);
      expect((await savingCore.deposits(2)).status).to.equal(0n);
    });
  });

  describe("5. SavingCore - Early Withdraw", function () {
    it("Should pay penalty to feeReceiver and zero interest", async function () {
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      await time.increase(30n * 86400n);

      const penalty = (1000n * USDC * DEFAULT_PENALTY) / 10000n;
      const userBefore = await mockUSDC.balanceOf(alice.address);
      const feeBefore = await mockUSDC.balanceOf(feeReceiver.address);

      await expect(savingCore.connect(alice).earlyWithdraw(1))
        .to.emit(savingCore, "PenaltyCharged");

      expect((await mockUSDC.balanceOf(feeReceiver.address)) - feeBefore).to.equal(penalty);
      expect((await mockUSDC.balanceOf(alice.address)) - userBefore).to.equal(1000n * USDC - penalty);
      expect((await savingCore.deposits(1)).status).to.equal(1n);
    });

    it("Should reject early withdraw at or after maturity", async function () {
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      const dep = await savingCore.deposits(1);
      await time.setNextBlockTimestamp(dep.maturityAt);

      await expect(savingCore.connect(alice).earlyWithdraw(1))
        .to.be.revertedWithCustomError(savingCore, "AlreadyMatured");
    });

    it("Should reject invalid early-withdraw identifiers", async function () {
      await expect(savingCore.connect(alice).earlyWithdraw(0))
        .to.be.revertedWithCustomError(savingCore, "DepositNotFound");
      await expect(savingCore.connect(alice).earlyWithdraw(2))
        .to.be.revertedWithCustomError(savingCore, "DepositNotFound");
    });

    it("Should handle zero penalty", async function () {
      await savingCore.createPlan(250n, 0n, 30n, 0n, 0n);
      await savingCore.connect(alice).openDeposit(2, 1000n * USDC);

      const before = await mockUSDC.balanceOf(alice.address);
      await savingCore.connect(alice).earlyWithdraw(1);
      expect((await mockUSDC.balanceOf(alice.address)) - before).to.equal(1000n * USDC);
    });

    it("Should settle early withdrawal when committed interest is zero", async function () {
      await savingCore.createPlan(1n, 0n, 1n, 0n, 0n);
      await savingCore.connect(alice).openDeposit(2, 1n);

      await expect(savingCore.connect(alice).earlyWithdraw(1))
        .to.emit(savingCore, "Withdrawn")
        .withArgs(1n, alice.address, 1n, 0n, true);

      expect(await savingCore.totalCommittedInterest()).to.equal(0n);
      expect((await savingCore.deposits(1)).status).to.equal(1n);
    });

    it("Should reduce committed interest on early withdrawal with other deposits active", async function () {
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);

      await savingCore.connect(alice).earlyWithdraw(1);
      expect(await savingCore.totalCommittedInterest()).to.equal(
        interestFor(1000n * USDC, DEFAULT_APR, DEFAULT_TENOR),
      );
      expect((await savingCore.deposits(1)).status).to.equal(1n);
      expect((await savingCore.deposits(2)).status).to.equal(0n);
    });
  });

  describe("6. SavingCore - Manual Renew", function () {
    it("Should compound interest, pull it from vault, and mint to current owner", async function () {
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      const dep1 = await savingCore.deposits(1);
      await savingCore.createPlan(300n, 500n, 60n, 0n, 0n);

      const expectedInterest = interestFor(1000n * USDC, DEFAULT_APR, DEFAULT_TENOR);
      const vaultBefore = await mockUSDC.balanceOf(await vaultManager.getAddress());
      await time.increaseTo(dep1.maturityAt + 10n * 86400n);

      const tx = await savingCore.connect(alice).renewDeposit(1, 2);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      const now = BigInt(block.timestamp);

      const dep2 = await savingCore.deposits(2);
      expect(dep2.owner).to.equal(alice.address);
      expect(dep2.principal).to.equal(1000n * USDC + expectedInterest);
      expect(dep2.planId).to.equal(2n);
      expect(dep2.aprBpsAtOpen).to.equal(300n);
      expect(dep2.penaltyBpsAtOpen).to.equal(500n);
      expect(dep2.openTimestamp).to.equal(now);
      expect(dep2.maturityAt).to.equal(now + 60n * 86400n);
      expect(dep2.status).to.equal(0n);
      expect((await savingCore.deposits(1)).status).to.equal(2n);
      expect(await savingCore.ownerOf(2)).to.equal(alice.address);
      expect(vaultBefore - (await mockUSDC.balanceOf(await vaultManager.getAddress()))).to.equal(expectedInterest);
    });

    it("Should reject before maturity, disabled new plan, and non-owner", async function () {
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      await expect(savingCore.connect(alice).renewDeposit(1, 1))
        .to.be.revertedWithCustomError(savingCore, "NotMatured");

      const dep = await savingCore.deposits(1);
      await time.increaseTo(dep.maturityAt);
      await expect(savingCore.connect(bob).renewDeposit(1, 1))
        .to.be.revertedWithCustomError(savingCore, "NotDepositOwner");

      await savingCore.createPlan(300n, 500n, 60n, 0n, 0n);
      await savingCore.disablePlan(2);
      await expect(savingCore.connect(alice).renewDeposit(1, 2))
        .to.be.revertedWithCustomError(savingCore, "PlanDisabled");
    });

    it("Should reject unknown deposit and plan identifiers", async function () {
      await expect(savingCore.connect(alice).renewDeposit(0, 1))
        .to.be.revertedWithCustomError(savingCore, "DepositNotFound");
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      const dep = await savingCore.deposits(1);
      await time.increaseTo(dep.maturityAt);
      await expect(savingCore.connect(alice).renewDeposit(1, 2))
        .to.be.revertedWithCustomError(savingCore, "PlanNotFound");
    });

    it("Should renew a zero-interest deposit when committed interest is zero", async function () {
      await savingCore.createPlan(1n, 0n, 1n, 0n, 0n);
      await savingCore.connect(alice).openDeposit(2, 1n);
      const dep = await savingCore.deposits(1);

      await time.increaseTo(dep.maturityAt);
      await expect(savingCore.connect(alice).renewDeposit(1, 2))
        .to.emit(savingCore, "Renewed")
        .withArgs(1n, 2n, 1n, 2n);

      expect(await savingCore.totalCommittedInterest()).to.equal(0n);
      expect((await savingCore.deposits(1)).status).to.equal(2n);
      expect((await savingCore.deposits(2)).principal).to.equal(1n);
    });

    it("Should reduce committed interest when renewing with other deposits active", async function () {
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      const dep = await savingCore.deposits(1);

      await time.increaseTo(dep.maturityAt);
      await savingCore.connect(alice).renewDeposit(1, 1);

      expect(await savingCore.totalCommittedInterest()).to.be.greaterThan(0n);
      expect((await savingCore.deposits(1)).status).to.equal(2n);
      expect((await savingCore.deposits(2)).status).to.equal(0n);
    });
  });

  describe("7. SavingCore - Auto Renew", function () {
    it("Should be permissionless after exact grace and not backdate", async function () {
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      const dep1 = await savingCore.deposits(1);
      const expectedInterest = interestFor(1000n * USDC, DEFAULT_APR, DEFAULT_TENOR);

      await time.setNextBlockTimestamp(dep1.maturityAt + GRACE_PERIOD - 1n);
      await expect(savingCore.connect(bob).autoRenewDeposit(1))
        .to.be.revertedWithCustomError(savingCore, "NotMatured");

      await time.setNextBlockTimestamp(dep1.maturityAt + GRACE_PERIOD);
      const tx = await savingCore.connect(bob).autoRenewDeposit(1);
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt.blockNumber);
      const now = BigInt(block.timestamp);

      const dep2 = await savingCore.deposits(2);
      expect(dep2.owner).to.equal(alice.address);
      expect(dep2.principal).to.equal(1000n * USDC + expectedInterest);
      expect(dep2.aprBpsAtOpen).to.equal(DEFAULT_APR);
      expect(dep2.penaltyBpsAtOpen).to.equal(DEFAULT_PENALTY);
      expect(dep2.openTimestamp).to.equal(now);
      expect(dep2.openTimestamp).to.not.equal(dep1.maturityAt);
      expect(dep2.maturityAt).to.equal(now + DEFAULT_TENOR * 86400n);
      expect(dep2.status).to.equal(0n);
      expect((await savingCore.deposits(1)).status).to.equal(3n);
      expect(await savingCore.ownerOf(2)).to.equal(alice.address);
    });

    it("Should reject auto-renew when original plan is disabled", async function () {
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      const dep = await savingCore.deposits(1);
      await savingCore.disablePlan(1);
      await time.increaseTo(dep.maturityAt + GRACE_PERIOD);

      await expect(savingCore.connect(bob).autoRenewDeposit(1))
        .to.be.revertedWithCustomError(savingCore, "PlanDisabled");
    });

    it("Should auto-renew a zero-interest deposit when committed interest is zero", async function () {
      await savingCore.createPlan(1n, 0n, 1n, 0n, 0n);
      await savingCore.connect(alice).openDeposit(2, 1n);
      const dep = await savingCore.deposits(1);

      await time.increaseTo(dep.maturityAt + GRACE_PERIOD);
      await expect(savingCore.connect(bob).autoRenewDeposit(1))
        .to.emit(savingCore, "Renewed")
        .withArgs(1n, 2n, 1n, 2n);

      expect(await savingCore.totalCommittedInterest()).to.equal(0n);
      expect((await savingCore.deposits(1)).status).to.equal(3n);
      expect((await savingCore.deposits(2)).principal).to.equal(1n);
    });

    it("Should reduce committed interest when auto-renewing with other deposits active", async function () {
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      const dep = await savingCore.deposits(1);

      await time.increaseTo(dep.maturityAt + GRACE_PERIOD);
      await savingCore.connect(bob).autoRenewDeposit(1);

      expect(await savingCore.totalCommittedInterest()).to.be.greaterThan(0n);
      expect((await savingCore.deposits(1)).status).to.equal(3n);
      expect((await savingCore.deposits(2)).status).to.equal(0n);
    });

    it("Should reject double auto-renew", async function () {
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      const dep = await savingCore.deposits(1);
      await time.increaseTo(dep.maturityAt + GRACE_PERIOD);

      await savingCore.connect(bob).autoRenewDeposit(1);
      await expect(savingCore.connect(bob).autoRenewDeposit(1))
        .to.be.revertedWithCustomError(savingCore, "DepositNotActive");
    });

    it("Should reject an unknown auto-renew deposit", async function () {
      await expect(savingCore.connect(bob).autoRenewDeposit(0))
        .to.be.revertedWithCustomError(savingCore, "DepositNotFound");
      await expect(savingCore.connect(bob).autoRenewDeposit(1))
        .to.be.revertedWithCustomError(savingCore, "DepositNotFound");
    });
  });

  describe("8. SavingCore - NFT Transfer", function () {
    it("Should move withdrawal rights and getUserDeposits to the new owner", async function () {
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      await savingCore.connect(alice).transferFrom(alice.address, bob.address, 1);

      expect(await savingCore.ownerOf(1)).to.equal(bob.address);
      expect((await savingCore.getUserDeposits(alice.address)).length).to.equal(0);
      expect((await savingCore.getUserDeposits(bob.address)).length).to.equal(1);

      await expect(savingCore.connect(alice).earlyWithdraw(1))
        .to.be.revertedWithCustomError(savingCore, "NotDepositOwner");

      await time.increase(30n * 86400n);
      await savingCore.connect(bob).earlyWithdraw(1);
      expect((await savingCore.deposits(1)).status).to.equal(1n);
    });

    it("Should mint renewed NFT to the current owner", async function () {
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      const dep = await savingCore.deposits(1);
      await savingCore.connect(alice).transferFrom(alice.address, bob.address, 1);
      await time.increaseTo(dep.maturityAt);

      await savingCore.connect(bob).renewDeposit(1, 1);
      expect(await savingCore.ownerOf(2)).to.equal(bob.address);
      expect((await savingCore.deposits(2)).owner).to.equal(bob.address);
    });
  });

  describe("9. SavingCore - Pause", function () {
    it("Should block open, withdraw, early withdraw, renew, and auto-renew while paused", async function () {
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      const dep = await savingCore.deposits(1);
      await time.increaseTo(dep.maturityAt);
      await savingCore.pause();

      await expect(savingCore.connect(alice).openDeposit(1, 1000n * USDC))
        .to.be.revertedWithCustomError(savingCore, "EnforcedPause");
      await expect(savingCore.connect(alice).withdrawAtMaturity(1))
        .to.be.revertedWithCustomError(savingCore, "EnforcedPause");
      await expect(savingCore.connect(alice).earlyWithdraw(1))
        .to.be.revertedWithCustomError(savingCore, "EnforcedPause");
      await expect(savingCore.connect(alice).renewDeposit(1, 1))
        .to.be.revertedWithCustomError(savingCore, "EnforcedPause");
      await expect(savingCore.connect(bob).autoRenewDeposit(1))
        .to.be.revertedWithCustomError(savingCore, "EnforcedPause");

      await savingCore.unpause();
      await savingCore.connect(alice).withdrawAtMaturity(1);
    });
  });

  describe("10. VaultManager", function () {
    it("Should fund and withdraw with the required events", async function () {
      const before = await mockUSDC.balanceOf(await vaultManager.getAddress());
      await mockUSDC.connect(owner).approve(await vaultManager.getAddress(), 10_000n * USDC);
      await expect(vaultManager.depositWithUSDC(10_000n * USDC))
        .to.emit(vaultManager, "VaultFunded")
        .withArgs(owner.address, 10_000n * USDC);
      expect((await mockUSDC.balanceOf(await vaultManager.getAddress())) - before).to.equal(10_000n * USDC);

      await expect(vaultManager.withdrawFunds(bob.address, 5_000n * USDC))
        .to.emit(vaultManager, "VaultWithdrawn")
        .withArgs(bob.address, 5_000n * USDC);
      expect(await mockUSDC.balanceOf(bob.address)).to.equal(15_000n * USDC);
    });

    it("Should support transfer to SavingCore and successful configuration updates", async function () {
      const savingCoreAddress = await savingCore.getAddress();
      const vaultAddress = await vaultManager.getAddress();
      const before = await mockUSDC.balanceOf(savingCoreAddress);

      await vaultManager.withdrawToSavingCore(1_000n * USDC);
      expect(await mockUSDC.balanceOf(savingCoreAddress)).to.equal(before + 1_000n * USDC);

      await expect(vaultManager.setFeeReceiver(bob.address))
        .to.emit(vaultManager, "FeeReceiverUpdated")
        .withArgs(feeReceiver.address, bob.address);
      expect(await vaultManager.feeReceiver()).to.equal(bob.address);

      await vaultManager.setSavingCore(owner.address);
      expect(await vaultManager.savingCore()).to.equal(owner.address);
      await vaultManager.setSavingCore(savingCoreAddress);
      expect(await vaultManager.savingCore()).to.equal(savingCoreAddress);

      await vaultManager.setUSDC(await mockUSDC.getAddress());
      expect(await vaultManager.mockUSDC()).to.equal(await mockUSDC.getAddress());
      expect(await mockUSDC.balanceOf(vaultAddress)).to.be.greaterThan(0n);
    });

    it("Should reject invalid amounts, receivers, and unauthorized admin calls", async function () {
      await expect(vaultManager.depositWithUSDC(0n)).to.be.revertedWith("Invalid amount");
      await expect(vaultManager.withdrawFunds(bob.address, 100_001n * USDC))
        .to.be.revertedWith("Insufficient vault balance");
      await expect(vaultManager.withdrawToSavingCore(100_001n * USDC))
        .to.be.revertedWith("Insufficient vault balance");

      await expect(vaultManager.setFeeReceiver(ethers.ZeroAddress)).to.be.revertedWith("Zero address");
      await expect(vaultManager.setSavingCore(ethers.ZeroAddress)).to.be.revertedWith("Zero address");
      await expect(vaultManager.setUSDC(ethers.ZeroAddress)).to.be.revertedWith("Zero address");

      await expect(vaultManager.connect(alice).withdrawFunds(bob.address, 1n))
        .to.be.revertedWithCustomError(vaultManager, "OwnableUnauthorizedAccount");
      await expect(vaultManager.connect(alice).withdrawToSavingCore(1n))
        .to.be.revertedWithCustomError(vaultManager, "OwnableUnauthorizedAccount");
      await expect(vaultManager.connect(alice).setFeeReceiver(bob.address))
        .to.be.revertedWithCustomError(vaultManager, "OwnableUnauthorizedAccount");
      await expect(vaultManager.connect(alice).setSavingCore(bob.address))
        .to.be.revertedWithCustomError(vaultManager, "OwnableUnauthorizedAccount");
      await expect(vaultManager.connect(alice).setUSDC(await mockUSDC.getAddress()))
        .to.be.revertedWithCustomError(vaultManager, "OwnableUnauthorizedAccount");
    });

    it("Should reject unauthorized payInterest", async function () {
      await expect(vaultManager.connect(alice).payInterest(1, 1n))
        .to.be.revertedWith("Unauthorized");
    });

    it("Should pause all vault operations and allow them after unpause", async function () {
      await expect(vaultManager.pause()).to.not.be.reverted;
      expect(await vaultManager.paused()).to.equal(true);

      await expect(vaultManager.depositWithUSDC(1n)).to.be.revertedWithCustomError(vaultManager, "EnforcedPause");
      await expect(vaultManager.withdrawToSavingCore(1n)).to.be.revertedWithCustomError(vaultManager, "EnforcedPause");
      await expect(vaultManager.withdrawFunds(bob.address, 1n))
        .to.be.revertedWithCustomError(vaultManager, "EnforcedPause");
      await expect(vaultManager.connect(alice).payInterest(1, 1n))
        .to.be.revertedWithCustomError(vaultManager, "EnforcedPause");
      await expect(vaultManager.connect(alice).pause())
        .to.be.revertedWithCustomError(vaultManager, "OwnableUnauthorizedAccount");

      await expect(vaultManager.unpause()).to.not.be.reverted;
      expect(await vaultManager.paused()).to.equal(false);
      await mockUSDC.connect(owner).approve(await vaultManager.getAddress(), 1n);
      await expect(vaultManager.depositWithUSDC(1n))
        .to.emit(vaultManager, "VaultFunded")
        .withArgs(owner.address, 1n);
    });

    it("Should revert withdraw when vault lacks interest and recover after funding", async function () {
      await vaultManager.withdrawFunds(owner.address, 100_000n * USDC);
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      const dep = await savingCore.deposits(1);
      await time.increaseTo(dep.maturityAt);

      await expect(savingCore.connect(alice).withdrawAtMaturity(1))
        .to.be.revertedWith("Insufficient vault for interest");
      expect((await savingCore.deposits(1)).status).to.equal(0n);

      await mockUSDC.connect(owner).approve(await vaultManager.getAddress(), 10_000n * USDC);
      await vaultManager.depositWithUSDC(10_000n * USDC);
      await expect(savingCore.connect(alice).withdrawAtMaturity(1))
        .to.emit(vaultManager, "InterestPaid");
      expect((await savingCore.deposits(1)).status).to.equal(1n);
    });
  });

  describe("11. Admin Setters", function () {
    it("Should reject zero addresses on SavingCore", async function () {
      await expect(savingCore.setVaultManager(ethers.ZeroAddress)).to.be.revertedWith("Zero address");
      await expect(savingCore.setMockUSDC(ethers.ZeroAddress)).to.be.revertedWith("Zero address");
      await expect(savingCore.setFeeReceiver(ethers.ZeroAddress)).to.be.revertedWith("Zero address");
    });

    it("Should emit FeeReceiverUpdated", async function () {
      await expect(savingCore.setFeeReceiver(bob.address))
        .to.emit(savingCore, "FeeReceiverUpdated");
      expect(await savingCore.feeReceiver()).to.equal(bob.address);
    });
  });

  describe("12. View Functions", function () {
    it("Should return plans, deposits, interest, remaining time, and grace status", async function () {
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      const dep = await savingCore.deposits(1);

      expect((await savingCore.getActivePlans()).length).to.equal(1);
      expect((await savingCore.getUserDeposits(alice.address)).length).to.equal(1);
      expect(await savingCore.calculateInterest(1)).to.equal(0n);
      expect(await savingCore.daysRemaining(1)).to.be.greaterThan(0n);
      expect(await savingCore.isWithinGracePeriod(1)).to.equal(false);

      await time.increaseTo(dep.maturityAt);
      expect(await savingCore.isWithinGracePeriod(1)).to.equal(true);
      expect(await savingCore.calculateInterest(1))
        .to.equal(interestFor(1000n * USDC, DEFAULT_APR, DEFAULT_TENOR));

      await time.increase(GRACE_PERIOD);
      expect(await savingCore.isWithinGracePeriod(1)).to.equal(false);
    });
  });

  describe("13. Precision & Rounding", function () {
    it("Should floor interest and keep dust in the vault", async function () {
      await savingCore.createPlan(190n, 0n, 14n, 0n, 0n);
      await savingCore.connect(alice).openDeposit(2, 1000n * USDC);
      const dep = await savingCore.deposits(1);

      const numerator = 1000n * USDC * 190n * 14n * 86400n;
      const denominator = 365n * 86400n * 10000n;
      const expected = numerator / denominator;

      expect(expected).to.equal(728767n);
      expect(numerator % denominator).to.be.greaterThan(0n);

      await time.increaseTo(dep.maturityAt);
      expect(await savingCore.calculateInterest(1)).to.equal(expected);

      const before = await mockUSDC.balanceOf(alice.address);
      await savingCore.connect(alice).withdrawAtMaturity(1);
      expect((await mockUSDC.balanceOf(alice.address)) - before).to.equal(1000n * USDC + expected);
    });
  });

  describe("14. Events", function () {
    it("Should emit Withdrawn and Renewed", async function () {
      await savingCore.connect(alice).openDeposit(1, 1000n * USDC);
      const dep = await savingCore.deposits(1);
      await time.increaseTo(dep.maturityAt);

      await expect(savingCore.connect(alice).renewDeposit(1, 1))
        .to.emit(savingCore, "Renewed");

      const dep2 = await savingCore.deposits(2);
      await time.increaseTo(dep2.maturityAt);
      await expect(savingCore.connect(alice).withdrawAtMaturity(2))
        .to.emit(savingCore, "Withdrawn");
    });
  });
});
