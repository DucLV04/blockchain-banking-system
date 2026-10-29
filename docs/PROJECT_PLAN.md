# 📅 PROJECT PLAN — Blockchain Online Banking System

> **Dựa trên:** `PROJECT_SPECIFICATION.md` và `Final_Assignment.docx`  
> **ID:** xxxxx79 (A=9, B=7)  
> **Thời gian:** 5 Ngày  
> **Mục tiêu:** Hoàn thiện hệ thống Term Deposit, Frontend, Tests >90% coverage, và Documentation.

---

## 🌍 Constants & Rules (Bắt buộc tuân thủ)

> **Lưu ý:** Mọi logic code phải sử dụng chính xác các giá trị tính toán từ Student ID: **xxxxx79** (A=9, B=7).

### 1. Thông số cá nhân hóa (Student ID Variant)

| Tham số | Công thức | Giá trị thực tế | Ghi chú |
|---------|-----------|-----------------|---------|
| **A** | last digit | **9** | |
| **B** | 2nd last digit | **7** | |
| **defaultAPR** | 200 + A×25 | **425 bps (4.25%)** | Plan mặc định |
| **earlyPenalty** | 300 + B×50 | **650 bps (6.50%)** | Phạt mặc định |
| **defaultTenor** | B lẻ → 180 | **180 ngày** | B=7 (lẻ) |
| **gracePeriod** | (A mod 3) + 2 | **2 ngày** | 172,800 seconds |
| **vaultFunding** | deploy script | **1,000 USDC** | 1,000,000,000 units |

> Final §2.1 dùng **plan-level** `minDeposit`/`maxDeposit`; `0` = không giới hạn. Không có global min/max tenor/APR/penalty.

### 2. Công thức tính toán (Logic Core)

**Lãi suất (Simple Interest):**
```solidity
uint256 tenorSeconds = deposit.maturityAt - deposit.openTimestamp;
uint256 interest = (deposit.principal * deposit.aprBpsAtOpen * tenorSeconds) 
                   / (365 * 86400 * 10000);
```
*Lưu ý: Nhân trước chia sau để tránh mất precision. Interest luôn cap tại `maturityAt`.*

**Phạt rút trước (Early Withdrawal):**
```solidity
uint256 penalty = (deposit.principal * deposit.penaltyBpsAtOpen) / 10000;
uint256 userReceive = deposit.principal - penalty;
// toàn bộ penalty → feeReceiver, không chia theo fee BPS
```

### 3. Nguyên tắc kiến trúc bắt buộc

1.  **Separation of Duties:** `SavingCore` giữ **Principal** (tiền gốc). `VaultManager` giữ **Interest** (tiền lãi). Không được trộn lẫn.
2.  **Snapshot:** APR và Penalty được snapshot tại thời điểm mở deposit. Cập nhật plan sau đó **không ảnh hưởng** đến deposit cũ.
3.  **Auto-Renew:** Giữ nguyên **APR gốc** (`aprBpsAtOpen`) và **Tenor gốc**. Chỉ trigger khi `block.timestamp >= maturityAt + GRACE_PERIOD`.
4.  **USDC:** Mock token phải có **6 decimals** (không phải 18).

---

## 📅 DAY 1: Research & Design (No Code)

**Mục tiêu:** Hiểu rõ yêu cầu, thiết kế cấu trúc dữ liệu, và chuẩn bị tài liệu. Không viết code hợp đồng.

### Nhiệm vụ chi tiết

1.  **Phân tích Business Logic:**
    *   Nắm vững 5 user flows: `openDeposit`, `withdrawAtMaturity`, `earlyWithdraw`, `renewDeposit`, `autoRenewDeposit`.
    *   Xác định rõ boundary conditions: `>=` maturity cho rút gốc, `<` maturity cho rút sớm.
2.  **Thiết kế Data Structures:**
    *   Định nghĩa `SavingPlan` struct trong Solidity.
    *   Định nghĩa `Deposit` struct (owner, planId, principal, aprBpsAtOpen, penaltyBpsAtOpen, openTimestamp, maturityAt, status).
    *   Định nghĩa `DepositStatus` enum: `Active`, `Withdrawn`, `ManualRenewed`, `AutoRenewed`.
3.  **Chuẩn bị Constants:**
    *   Tính toán chính xác `defaultAPR`, `earlyPenalty`, `defaultTenor`, `GRACE_PERIOD` dựa trên Student ID xxxxx79.
    *   Không định nghĩa global min/max; dùng plan-level `minDeposit`/`maxDeposit` (`0` = unlimited).
4.  **Soạn thảo Design Answers (DRAFT):**
    *   Trả lời 7 câu hỏi trong `Final_Assignment.docx` (Section 8.2):
        1.  Transferable NFT: Ai rút khi chuyển NFT? (Owner của NFT tại thời điểm gọi).
        2.  Empty Vault: Xử lý khi vault trống? (Revert theo spec, nhưng ghi nhận alternative design).
        3.  Dead Bot: Bot offline? (User không mất lãi; auto-renew permissionless sau grace, không backdate).
        4.  Rounding Dust: Dust thuộc ai? (Vault).
        5.  Boundary Times: `>=` hay `>`? (Dùng `>=` cho maturity).
        6.  Disabled Plan: Renew vào plan disabled? (Không cho phép).
        7.  Attack Vector: Reentrancy? (Sử dụng `nonReentrant` hoặc CEI pattern).
5.  **Cập nhật README (Draft):**
    *   Thêm phần "Personal Variant" với bảng tính toán A=9, B=7.

**Deliverables Day 1:**
*   File `README.md` có phần Personal Variant.
*   File `PROJECT_SPECIFICATION.md` (đã có).
*   Bản nháp Design Answers.

---

## 📅 DAY 2: Smart Contracts Development

**Mục tiêu:** Code 3 hợp đồng chính, deploy lên local network, kiểm tra logic cơ bản.

### Nhiệm vụ chi tiết

#### 2.1. MockUSDC.sol
*   **Yêu cầu:** ERC20, 6 decimals, mintable để test.
*   **Logic:**
    *   Kế thừa `ERC20`, `ERC20Burnable`.
    *   Function `mint(address to, uint256 amount)` **public** (Final §1.1: anyone can mint for testing).
    *   Đảm bảo `decimals()` trả về 6.

#### 2.2. VaultManager.sol (Interest Pool)
*   **Yêu cầu:** Quản lý tiền lãi, fee receiver, pause.
*   **State:** `savingCore` (address), `feeReceiver` (address), `paused` (bool).
*   **Functions:**
    *   `depositWithUSDC(uint256 amount)`: Người đã approve MockUSDC nạp tiền vào vault.
    *   `withdrawFunds(address receiver, uint256 amount)`: Owner rút tiền từ vault nếu đủ số dư.
    *   `withdrawToSavingCore(uint256 amount)`: Owner chuyển tiền từ vault sang SavingCore.
    *   `payInterest(uint256 depositId, uint256 amount)`: Transfer interest từ vault → `SavingCore` (SavingCore trả principal + interest cho user).
    *   `pause()` / `unpause()`: Emergency stop.
    *   `setFeeReceiver(address)`: Chỉ set receiver; không có `feeReceiverBps`.

#### 2.3. SavingCore.sol (Business Logic)
*   **Yêu cầu:** Quản lý plans, deposits, NFT certificates.
*   **State:**
    *   `plans`: mapping.
    *   `deposits`: mapping (Deposit).
    *   `nextPlanId`, `nextDepositId`.
    *   `mockUSDC` (IERC20), `vaultManager`, `feeReceiver`.
    *   `totalCommittedInterest`.
    *   **Constant:** `GRACE_PERIOD = 2 days` (172,800 seconds).
*   **Functions:**
    *   `createPlan(...)`: Validate plan-level limits (`min <= max` khi cả hai > 0), tenor > 0.
    *   `updatePlan(...)`: Chỉ update APR.
    *   `openDeposit(uint256 planId, uint256 amount)`:
        1.  Check plan enabled; `amount > 0`; plan-level min/max (`0` = unlimited).
        2.  `mockUSDC.transferFrom`.
        3.  Mint NFT.
        4.  Record snapshot `aprBpsAtOpen`, `penaltyBpsAtOpen`.
        5.  `maturityAt = now + tenorDays * 86400`.
    *   `withdrawAtMaturity(uint256 depositId)`:
        1.  Check `ownerOf(depositId) == msg.sender`, `now >= maturityAt`.
        2.  Calc interest, cap tại maturity.
        3.  Update status `Withdrawn` trước external call.
        4.  Call `VaultManager.payInterest`, trả principal + interest.
    *   `earlyWithdraw(uint256 depositId)`:
        1.  Check `now < maturityAt`.
        2.  Calc penalty, update status `Withdrawn` trước transfer.
        3.  Transfer **toàn bộ** penalty -> feeReceiver.
        4.  Transfer remaining -> user.
    *   `renewDeposit(uint256 depositId, uint256 newPlanId)`:
        1.  Check `ownerOf(depositId) == msg.sender`, `now >= maturityAt`, new plan enabled.
        2.  Calc new principal = old + interest; pull interest từ vault.
        3.  Mint new NFT cho owner hiện tại; new maturity = `now + newTenor`.
    *   `autoRenewDeposit(uint256 depositId)`:
        1.  **Permissionless**, check `now >= maturityAt + GRACE_PERIOD`.
        2.  Check plan gốc còn enabled.
        3.  Calc interest dùng **APR gốc**; new tenor = **Tenor gốc**.
        4.  Deposit mới bắt đầu tại `block.timestamp`; mint NFT cho owner hiện tại.
    *   `getUserDeposits(address)`: Filter bằng `ownerOf(i)`, không dùng snapshot owner.

#### 2.4. Deploy & Initial Check
*   Deploy lên Hardhat Local Network.
*   Mint mock USDC cho test accounts.
*   Nạp vault 1.000 USDC trong deploy script; test có thể dùng số tiền fixture riêng.
*   Verify ABI export.

**Deliverables Day 2:**
*   3 file `.sol` hoàn chỉnh.
*   Deploy thành công lên local.
*   ABI files trong `data/abi`.

---

## 📅 DAY 3: Frontend Development

**Mục tiêu:** Xây dựng giao diện React kết nối wallet, hiển thị plans, cho phép mở deposit/rút tiền.

### Nhiệm vụ chi tiết

#### 3.1. Setup & Types
*   Cấu hình Vite + React và CSS hiện có trong `frontend/src/styles.css`.
*   **ABI:** Dùng ABI tối thiểu trong `frontend/src/contracts.ts`, không yêu cầu copy toàn bộ ABI.
*   **Contract Helpers (`contracts.ts`):**
    *   Hàm `savingCoreContract`, `mockUsdcContract`.
    *   Hàm format: `formatUsdc(amount)`, `parseUsdc(amount)`, `formatApr(bps)`, `formatAddress(address)`.
    *   Định nghĩa interface `SavingPlan`, `Deposit` trùng với Solidity.

#### 3.2. Wallet Context
*   Kết nối MetaMask trực tiếp trong `App.tsx`.
*   Fetch active plans, user deposits và refresh balance.

#### 3.3. Pages & Components
*   **Màn hình demo:** Connect wallet, xem balance, xem plans, mở deposit và quản lý danh sách NFT deposits.
*   Các thao tác withdraw maturity, early withdraw và manual renew được hiển thị trực tiếp trên từng deposit; không tách thành các page/modal bắt buộc.

#### 3.4. Integration
*   Connect Frontend to Local Backend (`http://127.0.0.1:8545`).
*   Test flow: Connect -> View Plans -> Open Deposit -> View in MyDeposits.

**Deliverables Day 3:**
*   Frontend chạy bằng Vite trên cổng mặc định của project.
*   Có giao diện demo tập trung trong `App.tsx` và `styles.css`.
*   Tương tác được với smart contract.

---

## 📅 DAY 4: Test Coverage (>90%)

**Mục tiêu:** Viết test suite đầy đủ, đảm bảo >90% coverage, xử lý các edge cases.

### Nhiệm vụ chi tiết

#### 4.1. Test Helpers
*   `time.ts`: Helper `increaseTo(timestamp)`, `increase(seconds)`.
*   Fixture setup: deploy contract, mint USDC và nạp vault bằng số tiền dành riêng cho test.

#### 4.2. Unit Tests (Hardhat + Chai)
*   **MockUSDC:** Mint, transfer, balanceOf.
*   **SavingCore - Plans:**
    *   Create valid plan (dùng params A=9, B=7).
    *   Create invalid plan (tenor = 0; min > max khi cả hai > 0).
    *   Plan-level limits: `0` = unlimited.
*   **SavingCore - Open Deposit:**
    *   Happy path: Deposit 1000 USDC.
    *   Edge: Below plan min, Above plan max.
    *   Edge: Disabled plan.
*   **SavingCore - Withdraw at Maturity:**
    *   Fast forward time to `maturityAt`.
    *   Check correct interest (formula verification).
    *   Check NFT status update.
    *   Edge: Too early (revert).
*   **SavingCore - Early Withdrawal:**
    *   Check penalty calculation.
    *   Check feeReceiver receives correct amount.
    *   Check interest = 0.
*   **SavingCore - Renewal:**
    *   Manual: Check new principal = old + interest; new plan enabled.
    *   Auto: Check APR locked, tenor locked; permissionless; plan gốc enabled.
    *   Edge: Before grace period (revert); auto-renew không backdate.
    *   Edge: NFT transferred → renew/rút bởi owner hiện tại; `getUserDeposits` đúng.
*   **VaultManager:**
    *   Fund, Withdraw.
    *   **Critical:** Insufficient vault balance -> Revert on interest payment.

#### 4.3. Coverage Check
*   Chạy `npm run test:gas` hoặc coverage script.
*   Đảm bảo statements, branches, functions và lines đều >90%; kết quả hiện tại đạt branch 94.02% và các metric còn lại 100%.

**Deliverables Day 4:**
*   Tất cả tests passing.
*   Coverage report >90%.
*   Xử lý đúng các edge cases (Vault empty, Boundary times).

---

## 📅 DAY 5: Final Polish, Docs & Bonus

**Mục tiêu:** Hoàn thiện README, trả lời Design Questions, kiểm tra phạm vi bonus, và chuẩn bị Demo.

### Nhiệm vụ chi tiết

#### 5.1. Finalize Documentation (README.md)
*   **Personal Variant:** Cập nhật bảng A=9, B=7.
*   **Design Answers:** Viết đầy đủ 7 câu trả lời dựa trên logic đã code (Day 1 draft).
*   **Architecture:** Giải thích tách biệt VaultManager và SavingCore.
*   **Run Guide:** Hướng dẫn chạy test, deploy, frontend.

#### 5.2. Creative Challenges (Bonus +10 pts)
*   Chọn tối đa 2 challenges từ Final §8.3 (mỗi cái +5):
    *   **C1 (Principal luôn an toàn):** Trả principal tại maturity, cho claim interest sau khi vault có tiền.
    *   **C2 (Solvency guard):** Chưa claim hoàn thành. Code có `totalCommittedInterest` để accounting nhưng `withdrawFunds` chưa giới hạn phần surplus.
    *   **C3 (Partial early withdrawal):** Rút một phần principal, penalty chỉ trên phần rút.
    *   **C4 (Top-up deposit):** Thêm principal vào deposit active với interest accounting rõ ràng.
    *   **C5 (Ý tưởng riêng):** Mô tả gap + fix trước khi implement.
*   Viết test cho bonus features.
*   Ghi note trong README: problem, solution, trade-off.

#### 5.3. Final Deployment & Demo
*   Deploy lên Sepolia Testnet (nếu có RPC key) hoặc chuẩn bị video demo local.
*   Quay video 3-5 phút:
    *   Show code.
    *   Show tests passing.
    *   Show frontend flow (Open -> Wait -> Withdraw).
    *   Show Design Answers.

**Deliverables Day 5:**
*   README hoàn chỉnh.
*   Bonus chỉ được claim nếu đã implement, test và ghi rõ trong README; bản hiện tại không claim C1-C5.
*   Demo video.
*   Codebase sạch, ready for submission.

---

## ⚠️ Critical Reminders for AI Agent

1.  **Student ID:** Luôn dùng **A=9, B=7**. Không dùng giá trị ví dụ trong spec (như ...47).
2.  **USDC:** Luôn dùng **6 decimals**.
3.  **Interest Formula:** Luôn `multiply before divide`.
4.  **Vault:** Luôn check `vault.balance >= interest` trước khi pay.
5.  **Auto-Renew:** Luôn dùng `aprBpsAtOpen` (snapshot), không dùng rate hiện tại của plan; permissionless sau grace; không backdate.
6.  **Boundary:** Dùng `>=` cho maturity check; `GRACE_PERIOD` tính bằng giây.
7.  **No Mixing:** Không bao giờ dùng tiền từ `SavingCore` để trả lãi. Phải qua `VaultManager`.
8.  **Interest:** Luôn cap tại `maturityAt`; không dùng `block.timestamp` sau maturity.
9.  **NFT Auth:** Dùng `ownerOf(depositId)`, không dùng `deposits[id].owner` snapshot.
10. **Limits:** Chỉ plan-level min/max; `0` = unlimited; không có global constraints.
