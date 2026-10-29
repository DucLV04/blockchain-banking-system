# 📄 PROJECT SPECIFICATION — Blockchain Online Banking System


> **ID:** xxxxx79  
> **Phiên bản:** 1.0  

---

## Mục lục

1. [Tổng quan hệ thống](#1-tổng-quan-hệ-thống)
2. [Nguyên tắc kiến trúc](#2-nguyên-tắc-kiến-trúc)
3. [Cấu trúc dữ liệu](#3-cấu-trúc-dữ-liệu)
4. [Quy trình nghiệp vụ](#4-quy-trình-nghiệp-vụ)
5. [Thông số cá nhân hóa (Student ID: xxxxx79)](#5-thông-số-cá-nhân-hóa)
6. [Danh sách sự kiện bắt buộc](#6-danh-sách-sự-kiện-bắt-buộc)
7. [Câu hỏi bảo vệ (Oral Defense)](#7-câu-hỏi-bảo-vệ)
8. [Thách thức sáng tạo (Bonus)](#8-thách-thức-sáng-tạo)
9. [Hướng dẫn cho AI trong quá trình hiện thực](#9-hướng-dẫn-cho-ai-trong-quá-trình-hiện-thực)

---

## 1. Tổng quan hệ thống

### 1.1 Mục tiêu

Xây dựng hệ thống **tiết kiệm trực tuyến trên blockchain** (term deposit system) — tương tự tài khoản ngân hàng nhưng chạy hoàn toàn trên smart contract. Người dùng khóa token trong một thời gian cố định, nhận lãi suất, và có thể rút tiền khi kỳ hạn kết thúc.

### 1.2 Các vai trò

| Vai trò | Mô tả |
|---------|--------|
| **Depositor (Người gửi tiền)** | Mở deposit, nhận lãi, rút tiền, hoặc gia hạn |
| **Bank Admin (Quản trị viên)** | Tạo plan quản lý vault, nhận phí, pause/unpause hệ thống |

### 1.3 Kiến trúc 3 hợp đồng

| Hợp đồng | Chức năng | Lý do tách riêng |
|----------|-----------|-------------------|
| **MockUSDC.sol** | ERC20 giả, 6 decimals, mintable | USDC thật không cho phép mint. Cần token test 6 decimals để phát hiện bug decimal sớm |
| **VaultManager.sol** | Giữ tiền ngân hàng (interest pool). Cho phép fund vault, admin rút tiền, cấu hình fee receiver và pause | Tiền ngân hàng phải tách biệt với principal của user. Nếu vault trống hoặc có bug, tiền gửi vẫn an toàn |
| **SavingCore.sol** | Logic nghiệp vụ: plans, open deposit, withdraw, renew (manual + auto), ERC721 NFT | Quy tắc nghiệp vụ thay đổi thường xuyên hơn lưu trữ tiền. Tách logic khỏi tiền storage giúp code dễ test, dễ audit, đúng thiết kế thực tế (separation of duties) |

### 1.4 Nguyên tắc cốt lõi

> **RULE:** `SavingCore` giữ **principal** của người dùng. `VaultManager` giữ **tiền lãi** của ngân hàng. **Lãi suất luôn đến từ vault, KHÔNG bao giờ từ principal của user.** Nếu trộn 2 pool này → thiết kế sai.

---

## 2. Nguyên tắc kiến trúc

### 2.1 Nguyên tắc bắt buộc

| # | Nguyên tắc | Mô tả |
|---|-----------|-------|
| R1 | **Tách biệt pool tiền** | Principal (user) ≠ Interest (vault). Không được trộn lẫn |
| R2 | **Snapshot APR & penalty** | APR và penalty được capture tại thời điểm mở deposit. Cập nhật plan sau đó **không ảnh hưởng** đến deposit hiện tại |
| R3 | **Lãi đơn (Simple Interest)** | Chỉ áp dụng lãi đơn trong kỳ hạn. Không compounding trong 1 deposit term |
| R4 | **Lãi từ vault** | Nếu vault không đủ tiền → withdraw **revert**. Đây là quy tắc mặc định |
| R5 | **Auto-renew giữ APR gốc** | Auto-renew dùng `aprBpsAtOpen` ban đầu, không phải rate hiện tại của plan |
| R6 | **Pause = emergency stop** | Khi paused: không open deposit, không withdraw, không renew |
| R7 | **Admin không sửa deposit** | Admin không thể thay đổi deposit đã mở |
| R8 | **Integer arithmetic** | Tất cả token amounts lưu ở smallest unit (wei-equivalent). USDC 6 decimals → 1 USDC = 1,000,000 units |

### 2.2 Công thức lãi suất

```
interest = (principal × aprBpsAtOpen × tenorSeconds) / (365 × 24 × 3600 × 10,000)

Trong đó:
  tenorSeconds = deposit.maturityAt - deposit.openTimestamp
  (interest luôn được cap tại maturityAt; không cộng thời gian sau maturity)
  10,000 = chuyển basis points thành tỷ lệ thập phân
```

**Ví dụ:** Alice gửi 1,000 USDC (1,000,000,000 units) trong 90 ngày, APR 2.5% (250 bps):

```
tenorSeconds = 90 × 86,400 = 7,776,000
interest = (1,000,000,000 × 250 × 7,776,000) / (31,536,000 × 10,000)
         = 6,164,383 units ≈ 6.16 USDC
Alice nhận: 1,006.16 USDC
```

### 2.3 Công thức phạt rút trước

```
penalty = (principal × penaltyBpsAtOpen) / 10,000
user receives = principal - penalty
penalty → feeReceiver
```

**Ví dụ:** Alice rút trước từ 1,000 USDC với phạt 5% (500 bps):

```
penalty = (1,000,000,000 × 500) / 10,000 = 50,000,000 = 50 USDC
Alice nhận: 950 USDC
feeReceiver nhận: 50 USDC
Lãi = 0
```

---

## 3. Cấu trúc dữ liệu

### 3.1 SavingPlan (struct trong SavingCore)

```solidity
struct SavingPlan {
    uint256 aprBps;         // Lãi suất hàng năm (bps: 100 = 1%)
    uint256 penaltyBps;     // Phạt rút trước (bps)
    uint256 tenorDays;      // Kỳ hạn (ngày)
    uint256 minDeposit;     // Tối thiểu (units); 0 = không giới hạn
    uint256 maxDeposit;     // Tối đa (units); 0 = không giới hạn
    bool   isEnabled;       // Cho phép mở deposit mới?
}
```

### 3.2 Deposit (struct trong SavingCore)

```solidity
struct Deposit {
    address owner;           // Owner snapshot lúc mở; authorization dùng ownerOf(depositId)
    uint256 planId;          // Plan được chọn
    uint256 principal;       // Gốc (units)
    uint256 aprBpsAtOpen;    // APR snapshot tại thời điểm mở
    uint256 penaltyBpsAtOpen; // Penalty snapshot tại thời điểm mở
    uint256 openTimestamp;   // block.timestamp khi mở
    uint256 maturityAt;      // openTimestamp + tenorDays × 86400
    uint8  status;           // 0=Active, 1=Withdrawn, 2=ManualRenewed, 3=AutoRenewed
}
```

### 3.3 DepositStatus enum

| Giá trị | Hằng | Mô tả |
|---------|------|-------|
| 0 | `Active` | Deposit đang hoạt động |
| 1 | `Withdrawn` | Đã rút (cả mature và early) |
| 2 | `ManualRenewed` | Đã gia hạn thủ công |
| 3 | `AutoRenewed` | Đã gia hạn tự động |

### 3.4 State variables chính trong SavingCore

```solidity
mapping(uint256 => SavingPlan) public plans;
uint256 public nextPlanId;

mapping(uint256 => Deposit) public deposits;
uint256 public nextDepositId;

IMockUSDC public mockUSDC;       // Token address
address public vaultManager;     // VaultManager contract
address public feeReceiver;      // Nhận toàn bộ penalty rút trước
uint256 public constant GRACE_PERIOD = 2 days; // Từ Student ID

// Accounting phục vụ theo dõi interest đã cam kết; chưa phải solvency guard hoàn chỉnh
uint256 public totalCommittedInterest;
```

### 3.5 State variables chính trong VaultManager

```solidity
address public savingCore;        // Core contract address
address public feeReceiver;       // Nhận toàn bộ penalty từ early withdraw
bool public paused;               // Emergency pause
IERC20 public mockUSDC;
```

---

## 4. Quy trình nghiệp vụ

### 4.1 Mở deposit (openDeposit)

```
User flow:
1. User approve tokens → SavingCore contract
2. User call openDeposit(planId, amount)

Contract logic:
1. Check: plan exists && plan.isEnabled
2. Check: amount > 0
3. Check: nếu plan.minDeposit > 0 thì amount >= plan.minDeposit
4. Check: nếu plan.maxDeposit > 0 thì amount <= plan.maxDeposit
5. Transfer tokens từ user → SavingCore (holds principal)
6. Mint ERC721 NFT → user với depositId
7. Record deposit:
   - aprBpsAtOpen = plan.aprBps (snapshot)
   - penaltyBpsAtOpen = plan.penaltyBps (snapshot)
   - maturityAt = block.timestamp + plan.tenorDays × 86400
   - status = Active
8. Emit DepositOpened event
```

**Ràng buộc:**
- Plan phải `enabled`
- Amount phải > 0
- Plan-level `minDeposit`/`maxDeposit`: giá trị `0` = không giới hạn
- Không áp global min/max (Final §2.1)
- Người dùng phải approve đủ token trước

### 4.2 Rút khi đáo hạn (withdrawAtMaturity)

```
User flow:
1. Đợi đến maturityAt
2. Call withdrawAtMaturity(depositId)

Contract logic:
1. Check: !paused
2. Check: ownerOf(depositId) == msg.sender
3. Check: deposit.status == Active
4. Check: block.timestamp >= maturityAt
5. Calculate interest (cap tại maturity):
   tenorSeconds = deposit.maturityAt - deposit.openTimestamp
   interest = (principal × aprBpsAtOpen × tenorSeconds) / (365 × 86400 × 10000)
6. Check: VaultManager có đủ interest
7. Update deposit.status = Withdrawn
8. Request interest từ VaultManager → SavingCore
9. Transfer principal + interest từ SavingCore → user
10. Emit Withdrawn(depositId, owner, principal, interest, false)
```

**Ràng buộc:**
- `block.timestamp >= maturityAt` (>=, không phải >)
- Interest được cap tại `maturityAt`; không cộng thời gian sau maturity
- Vault phải có đủ tiền → nếu không **revert**
- Chỉ owner hiện tại của NFT mới rút được
- Status phải được update trước external call (CEI)

### 4.3 Rút trước hạn (earlyWithdraw)

```
User flow:
1. Call earlyWithdraw(depositId)

Contract logic:
1. Check: !paused
2. Check: ownerOf(depositId) == msg.sender
3. Check: deposit.status == Active
4. Check: block.timestamp < maturityAt
5. Calculate penalty:
   penalty = (principal × penaltyBpsAtOpen) / 10000
6. Calculate userReceive = principal - penalty
7. Update deposit.status = Withdrawn
8. Transfer toàn bộ penalty → feeReceiver
9. Transfer userReceive → user
10. Emit Withdrawn(depositId, owner, principal, 0, true)
```

**Ràng buộc:**
- Chỉ rút khi `block.timestamp < maturityAt`
- Không có lãi
- Phạt được tính từ principal
- **Toàn bộ penalty** gửi đến feeReceiver (không chia theo fee BPS)
- Status phải được update trước transfer (CEI)

### 4.4 Gia hạn thủ công (renewDeposit)

```
User flow:
1. Call renewDeposit(depositId, newPlanId)

Contract logic:
1. Check: !paused
2. Check: ownerOf(depositId) == msg.sender
3. Check: deposit.status == Active
4. Check: block.timestamp >= maturityAt
5. Calculate interest earned on old deposit (cap tại maturity)
6. newPrincipal = principal + interest
7. Prepare new deposit and set old deposit.status = ManualRenewed
8. Request interest từ VaultManager → SavingCore (để back newPrincipal)
9. Mint new NFT cho owner hiện tại của NFT (ownerOf)
10. Emit Renewed(oldDepositId, newDepositId, newPrincipal, newPlanId)
```

**Ràng buộc:**
- Chỉ thực hiện khi `block.timestamp >= maturityAt`
- Interest được **compound** vào principal mới
- Plan mới phải `enabled`
- APR mới = APR hiện tại của plan (không phải APR cũ)
- Interest phải được chuyển từ VaultManager sang SavingCore để đảm bảo newPrincipal được back 1:1
- NFT mới mint cho owner hiện tại, không dùng owner snapshot

### 4.5 Gia hạn tự động (autoRenewDeposit)

```
Bot/keeper flow (off-chain):
1. Call autoRenewDeposit(depositId) — permissionless sau grace period

Contract logic:
1. Check: !paused
2. Check: deposit exists && deposit.status == Active
3. Check: block.timestamp >= maturityAt + GRACE_PERIOD (days → seconds)
4. Check: plan gốc vẫn enabled; nếu disabled → revert
5. Calculate interest (cap tại maturity):
   tenorSeconds = deposit.maturityAt - deposit.openTimestamp
   interest = (principal × aprBpsAtOpen × tenorSeconds) / (365 × 86400 × 10000)
6. newPrincipal = principal + interest
7. Request interest từ VaultManager → SavingCore (để back newPrincipal)
8. New tenor = SAME as original deposit (tenorDays of original plan)
9. APR locked = aprBpsAtOpen (GUARD against rate decrease)
10. Calculate new maturityAt = block.timestamp + originalTenor × 86400
11. Update old deposit.status = AutoRenewed and prepare the new deposit
12. Request interest từ VaultManager → SavingCore (để back newPrincipal)
13. Mint new NFT cho owner hiện tại của NFT (ownerOf)
14. Emit Renewed(oldDepositId, newDepositId, newPrincipal, originalPlanId)
```

**Ràng buộc:**
- Chỉ thực hiện sau `maturityAt + GRACE_PERIOD`
- **Permissionless:** bất kỳ ai/keeper đều có thể gọi, không cần là owner
- **Giữ nguyên tenor gốc** (không dùng tenor của plan hiện tại)
- **Giữ nguyên APR gốc** (`aprBpsAtOpen`) — bảo vệ user khỏi rate decrease
- Không auto-renew nếu plan gốc bị disabled
- New maturity = `block.timestamp + originalTenor` (không backdate)
- Interest phải được chuyển từ VaultManager sang SavingCore để đảm bảo newPrincipal được back 1:1
- NFT mới mint cho owner hiện tại, không dùng owner snapshot

### 4.6 Grace Period (Kỳ ân hạn)

```
Grace period = GRACE_PERIOD days sau maturityAt

Ví dụ (Student ID xxxxx79):
  maturityAt = Day 90
  GRACE_PERIOD = 2 days
  Grace period ends = Day 92

  Day 90 → Day 91: User có thể withdraw hoặc manual renew
  Day 92+: Bot/keeper có thể trigger autoRenew
```

> **Lưu ý:** Ví dụ "Day 93" trong Final §3.5 là cho ID mẫu kết thúc `...47` (A=7 → 3 ngày). Với `xxxxx79` (A=9), grace period là **2 ngày** → Day 92.

---

## 5. Thông số cá nhân hóa

> **Student ID: xxxxx79**  
> **A = 9** (số cuối)  
> **B = 7** (số thứ 2 từ cuối)

### 5.1 Bảng thông số

| Tham số | Công thức | Giá trị | Ghi chú |
|---------|-----------|---------|---------|
| **A** | last digit | **9** | |
| **B** | 2nd last digit | **7** | |
| **gracePeriod** | `(A mod 3) + 2` | **2 ngày** | A=9 → (9 mod 3)+2 = 2 |
| **defaultAPR** | `200 + A × 25` | **425 bps (4.25%)** | Plan mặc định |
| **earlyPenalty** | `300 + B × 50` | **650 bps (6.50%)** | Phạt mặc định |
| **defaultTenor** | `B` lẻ → `180` | **180 ngày** | B=7 (lẻ) |

### 5.2 Constraints trong hợp đồng

```solidity
// Constants trong SavingCore (chỉ giữ GRACE_PERIOD từ Assignment)
GRACE_PERIOD    = 2 days = 172,800 seconds
```

### 5.3 Ví dụ plan hợp lệ (dùng thông số cá nhân)

```
Plan ID 1 (Default Plan):
  tenorDays: 180 (B=7 is odd → 180 days)
  aprBps: 425 (200 + 9×25 = 425 bps = 4.25%)
  penaltyBps: 650 (300 + 7×50 = 650 bps = 6.50%)
  minDeposit: 550 USDC (plan-level)
  maxDeposit: 5,500 USDC (plan-level)
  isEnabled: true

Plan ID 2:
  tenorDays: 90
  aprBps: 500 (5.00%)
  penaltyBps: 650 (6.50%)
  minDeposit: 550 USDC
  maxDeposit: 3,000 USDC
  isEnabled: true

Plan ID 3:
  tenorDays: 180
  aprBps: 800 (8.00%)
  penaltyBps: 650 (6.50%)
  minDeposit: 1,000 USDC
  maxDeposit: 5,500 USDC
  isEnabled: true
```

> **Lưu ý:** `minDeposit`/`maxDeposit` ở trên là **plan-level**, không phải global limits. Giá trị `0` = không giới hạn. Final §2.1 không định nghĩa global min/max.

---

## 6. Danh sách sự kiện bắt buộc

### 6.1 SavingCore Events

```solidity
event PlanCreated(uint256 planId, uint256 tenorDays, uint256 aprBps);
event PlanUpdated(uint256 planId, uint256 newAprBps);

event DepositOpened(
    uint256 depositId,
    address owner,
    uint256 planId,
    uint256 principal,
    uint256 maturityAt,
    uint256 aprBpsAtOpen
);

event Withdrawn(
    uint256 depositId,
    address owner,
    uint256 principal,
    uint256 interest,
    bool isEarly
);

event Renewed(
    uint256 oldDepositId,
    uint256 newDepositId,
    uint256 newPrincipal,
    uint256 newPlanId
);
```

### 6.2 VaultManager Events (bổ sung)

```solidity
event VaultFunded(address funder, uint256 amount);
event VaultWithdrawn(address receiver, uint256 amount);
event InterestPaid(uint256 depositId, uint256 amount);
event FeeReceiverUpdated(address oldReceiver, address newReceiver);
```

### 6.3 MockUSDC Events

```solidity
// Standard ERC20 events: Transfer, Approval
// Custom: public mint for testing
event Minted(address to, uint256 amount);
```

---

## 7. Câu hỏi bảo vệ (Oral Defense)

> **Lưu ý:** Trong buổi bảo vệ, giáo viên sẽ chọn 2-3 câu hỏi ngẫu nhiên và có thể thay đổi số liệu ("what if penalty was 0 bps?"). Nếu không giải thích được code của mình → mất điểm liên quan, dù code có chạy.
>
> **Nguồn chính thức:** `README.md` mục "Open Design Questions". Mục này phải luôn khớp với README.

### Q1: Transferable certificate

**Câu hỏi:** Deposit NFT có thể transfer. Nếu Alice bán NFT cho Bob trước maturity, ai có thể rút — Alice hay Bob? Hành vi này tốt hay nguy hiểm? Chỉ ra dòng code quyết định.

**Đáp án thiết kế:**
- **Ai rút:** Người đang nắm giữ NFT tại thời điểm gọi hàm. Nếu Alice chuyển NFT cho Bob trước maturity, **Bob** rút được, Alice không.
- **Code quyết định:** `SavingCore.sol:184,205,234,281` dùng `ownerOf(depositId) != msg.sender` để chặn người không sở hữu NFT.
- **Đánh giá:** Tốt cho tính thanh khoản/chuyển nhượng, nhưng nguy hiểm vì mất NFT = mất quyền rút. Nên cảnh báo user hoặc thêm cờ `transferable`.
- **Nguyên tắc:** Khi renew, NFT mới phải mint cho owner hiện tại của NFT; không dùng `deposits[depositId].owner` đã snapshot.
- **Đã sửa:** `getUserDeposits` filter bằng `ownerOf(i)` (`SavingCore.sol:348-358`), nên sau khi transfer NFT, danh sách trả về đúng owner hiện tại.

### Q2: Empty vault

**Câu hỏi:** User đến maturity nhưng vault không đủ tiền cho interest. Spec nói "revert". Vấn đề gì xảy ra cho user? Design alternative nào?

**Đáp án thiết kế:**
- **Hệ quả:** `VaultManager.payInterest` revert khi vault không đủ interest (`VaultManager.sol:45-52`). Vì `withdrawAtMaturity` gọi `payInterest` trước khi trả principal (`SavingCore.sol:197-199`), toàn bộ giao dịch revert; user không mất principal nhưng không rút được tại maturity cho đến khi vault được fund.
- **Trước maturity:** User vẫn có thể `earlyWithdraw`, nhận principal trừ penalty.
- **Alternative:** Trả principal trước và cho user claim interest sau (C1), queue system, hoặc partial payout.
- **Lựa chọn:** Revert — đơn giản, an toàn, đúng base spec.

### Q3: Dead bot

**Câu hỏi:** Auto-renew bot offline 1 tháng. Deposits qua grace period sẽ sao? User mất gì? Đề xuất change bảo vệ user.

**Đáp án thiết kế:**
- **Hệ quả:** Deposit đã qua grace vẫn `Active`; user không mất lãi vì APR/penalty đã snapshot và interest được cap tại maturity.
- **Quyền của user:** User vẫn `withdrawAtMaturity` được bất kỳ lúc nào sau maturity, hoặc manual renew sang plan enabled. Bot chết không khóa vốn.
- **Cơ chế bảo vệ:** Sau grace period, `autoRenewDeposit` được thiết kế **permissionless** — bất kỳ ai/keeper đều có thể trigger (`SavingCore.sol:273-311`); deposit mới bắt đầu tại `block.timestamp`, không backdate.
- **Đề xuất:** Giữ grace period 2 ngày; nếu plan bị disable thì không auto-renew.

### Q4: Rounding dust

**Câu hỏi:** Integer division làm mất precision. "Dust" thuộc về ai? Có thể gây revert hay wrong balance không? Chứng minh bằng test case.

**Đáp án thiết kế:**
- **Dust thuộc về:** Vault. `_calcInterest` dùng floor division (`SavingCore.sol`); vault chỉ trả đúng floor interest, phần lẻ không rời vault.
- **Có gây revert không?** Không, vì `floor(interest) <= true interest`.
- **Có gây wrong balance không?** Không, miễn là interest được cap tại maturity. Settlement dùng `_fullInterestOf` với `maturityAt - openTimestamp`; view `calculateInterest` dùng `_interestOf`, cap tại `min(block.timestamp, maturityAt)`.
- **Test case:** 1,000 USDC, APR 190 bps, 14 ngày → interest = 728,767 units; dust ≈ 0.123287 units.

### Q5: Boundary times

**Câu hỏi:** Tại exact second của maturityAt, withdraw là "early" hay "at maturity"? Tại exact end của grace period, user vẫn manual renew được không?

**Đáp án thiết kế:**
- **Tại exact maturityAt:** `withdrawAtMaturity` yêu cầu `block.timestamp >= maturityAt` (`SavingCore.sol:188`) → exact second là **at maturity**. `earlyWithdraw` revert khi `block.timestamp >= maturityAt` (`:209`) → không thể early tại đúng maturity.
- **Tại exact end grace period:** `autoRenewDeposit` cho phép khi `block.timestamp >= maturityAt + GRACE_PERIOD` (`:278`) → exact end được auto-renew.
- **Manual renew tại exact end grace:** `renewDeposit` chỉ yêu cầu `block.timestamp >= maturityAt` (`:239`), không có upper bound → vẫn manual renew được nếu deposit còn `Active` và bot chưa auto-renew.

### Q6: Disabled plan với active deposits

**Câu hỏi:** Admin disable plan khi nhiều deposit từ plan đó vẫn active. Users có thể làm gì? Có thể renew INTO disabled plan không?

**Đáp án thiết kế:**
- **Deposit cũ:** Vẫn `Active`; user có thể `withdrawAtMaturity`, `earlyWithdraw`, hoặc manual renew sang plan enabled.
- **Renew INTO disabled:** Không. `renewDeposit` check `plans[newPlanId].isEnabled` (`SavingCore.sol:241`).
- **Auto-renew:** Cũng không được renew vào plan disabled. `autoRenewDeposit` phải check `plans[dep.planId].isEnabled` trước khi tạo deposit mới.
- **Lý do:** Disable = ngừng nhận deposit mới; auto-renew tạo deposit mới nên phải tuân thủ cùng quy tắc.

### Q7: Attack thinking

**Câu hỏi:** Mô tả một realistic attack và mechanism trong code để ngăn chặn.

**Đáp án thiết kế:**
- **Attack:** Reentrancy trên `withdrawAtMaturity`.
- **Countermeasure:** `SavingCore` dùng `ReentrancyGuard` (`SavingCore.sol:8,12`) và `nonReentrant` trên `openDeposit`, `withdrawAtMaturity`, `earlyWithdraw`, `renewDeposit`, `autoRenewDeposit` (`:151,182,203,232,273`).
- **CEI:** Status được set trước external call: `Withdrawn` trước `payInterest`/transfer (`:197-199`), `Withdrawn` trước penalty/transfer (`:221-228`), `ManualRenewed`/`AutoRenewed` trước mint (`:267-269,293-309`). Gọi lại sẽ revert `DepositNotActive`.
- **Lớp bổ sung:** `Pausable` để emergency stop; test suite đã bao phủ pause, unauthorized calls, repeated withdrawal và các nhánh lỗi liên quan.

---

## 8. Thách thức sáng tạo (Bonus, tối đa +10 điểm)

> Mỗi challenge implement + test đúng: +5 điểm, tối đa +10. Base flows §3 phải pass trước.

### C1: Principal luôn an toàn

| Mục | Chi tiết |
|-----|----------|
| **Problem** | Base spec revert toàn bộ khi vault thiếu interest → bank có thể khóa principal của user bằng cách không fund vault |
| **Solution** | Trả principal ngay tại maturity; user claim interest sau khi vault có tiền (hoặc queue phần interest) |
| **Trade-off** | Complexity ↑, nhưng user luôn lấy lại được tiền gốc |

### C2: Solvency guard

| Mục | Chi tiết |
|-----|----------|
| **Problem** | Admin có thể rút toàn bộ vault, làm các khoản interest đã hứa trở nên không trả được |
| **Solution** | Nếu triển khai bonus: track tổng interest đã cam kết cho active deposits; hàm rút vault chỉ cho rút phần surplus |
| **Trạng thái hiện tại** | Chưa triển khai đầy đủ. `SavingCore` có `totalCommittedInterest` để accounting, nhưng `VaultManager.withdrawFunds` hiện chỉ kiểm tra số dư vault |
| **Trade-off** | Cần cập nhật accounting mỗi lần open/withdraw/renew; admin bị giới hạn quyền rút |

### C3: Partial early withdrawal

| Mục | Chi tiết |
|-----|----------|
| **Problem** | Base spec all-or-nothing: cần 10% vốn vẫn phải phá toàn bộ deposit và chịu full penalty |
| **Solution** | Cho rút một phần principal trước maturity; penalty chỉ áp lên phần rút; phần còn lại tiếp tục earning interest |
| **Trade-off** | Phải xử lý split deposit/NFT hoặc giảm principal; tăng complexity |

### C4: Top-up deposit

| Mục | Chi tiết |
|-----|----------|
| **Problem** | User muốn thêm vốn vào deposit active nhưng base spec buộc mở deposit mới với APR hiện tại (có thể thấp hơn) |
| **Solution** | Cho thêm principal vào deposit active; phần top-up có thể dùng APR snapshot cũ hoặc APR mới, phải định nghĩa rõ cách tính interest |
| **Trade-off** | Interest accounting phức tạp; cần test kỹ boundary và snapshot |

### C5: Ý tưởng riêng

| Mục | Chi tiết |
|-----|----------|
| **Problem** | Base spec còn gap thực tế (ví dụ: NFT transfer restriction, grace period extension, oracle APR) |
| **Solution** | Mô tả gap + fix trong README trước khi implement |
| **Trade-off** | Tùy feature; không có problem rõ ràng = không bonus |

**Quy tắc bonus:**
1. Base flows phải pass tất cả tests
2. Mỗi challenge cần test riêng
3. Mỗi challenge cần README note: problem, solution, trade-off
4. Không test hoặc không note = không bonus

---

## 9. Hướng dẫn cho AI trong quá trình hiện thực

### 9.1 Smart Contract Implementation

#### Ưu tiên thứ tự

1. **MockUSDC.sol** — ERC20 base, 6 decimals, mintable function
2. **SavingCore.sol** — Business logic core
3. **VaultManager.sol** — Vault + admin controls
4. **Interfaces** — IMockUSDC, ISavingCore, IVaultManager

#### MockUSDC.sol — Requirements

```solidity
// Must include:
- ERC20 from OpenZeppelin
- ERC20Burnable
- Function: mint(address to, uint256 amount) — public for testing (Final §1.1)
- Decimals: 6 (NOT 18!)
```

#### SavingCore.sol — Critical Implementation Details

```solidity
// INTEREST FORMULA — multiply BEFORE divide to avoid precision loss:
uint256 tenorSeconds = deposit.maturityAt - deposit.openTimestamp;
uint256 interest = (deposit.principal * deposit.aprBpsAtOpen * tenorSeconds)
                   / (365 * 86400 * 10000);

// KEY: principal × aprBps × tenor → must not overflow
// Use 256-bit math. Max: 5.5B × 1900 × 365×86400 ≈ 3.5×10^20 < 2^256 ✓

// DEPOSIT OPEN — validation order matters:
1. require(plans[planId].isEnabled, "Plan disabled");
2. require(amount > 0, "Zero deposit");
3. if (plans[planId].minDeposit > 0) require(amount >= plans[planId].minDeposit, "Below min");
4. if (plans[planId].maxDeposit > 0) require(amount <= plans[planId].maxDeposit, "Above max");

// SNAPSHOT — store these at open time:
deposit.aprBpsAtOpen = plans[planId].aprBps;
deposit.penaltyBpsAtOpen = plans[planId].penaltyBps;

// MATURE CHECK — use >=:
require(block.timestamp >= deposit.maturityAt, "Not mature");

// EARLY WITHDRAW CHECK — use <:
require(block.timestamp < deposit.maturityAt, "Already mature");

// AUTO RENEW CHECK — use >= with grace period:
require(block.timestamp >= deposit.maturityAt + GRACE_PERIOD, "Too early");

// PENALTY CALCULATION — toàn bộ penalty → feeReceiver:
uint256 penalty = (deposit.principal * deposit.penaltyBpsAtOpen) / 10000;
uint256 userReceive = deposit.principal - penalty;

// REENTRANCY PROTECTION:
- Use OpenZeppelin ReentrancyGuard on withdraw functions
- OR use Checks-Effects-Interactions pattern
```

#### VaultManager.sol — Critical Implementation Details

```solidity
// VAULT FUNDING:
- Funder approves MockUSDC, then calls depositWithUSDC(amount)
- Transfer USDC from admin → VaultManager
- Emit VaultFunded event

// WITHDRAW FROM VAULT:
- Admin calls withdrawFunds(receiver, amount)
- Transfer USDC from VaultManager → receiver
- Emit VaultWithdrawn event

// MOVE FUNDS TO SAVING CORE:
- Admin calls withdrawToSavingCore(amount)
- Transfer USDC from VaultManager → SavingCore

// INTEREST PAYMENT:
- SavingCore calls payInterest(depositId, amount)
- Check: vault balance >= amount → revert if insufficient
- Transfer USDC from VaultManager → SavingCore (SavingCore trả principal + interest cho user)
- Emit InterestPaid event

// PAUSE:
- Admin calls pause() / unpause()
- Use OpenZeppelin Pausable
- `whenNotPaused` blocks vault funding, vault withdrawals and interest payment
- `SavingCore` separately blocks open, withdraw and renew operations
```

### 9.2 Testing Strategy

#### Coverage target: > 90%

#### Test categories

| Category | Tests |
|----------|-------|
| **createPlan** | Valid plan, disabled plan, invalid plan id, minDeposit > maxDeposit (khi cả hai > 0), zero tenor |
| **openDeposit** | Happy path, below minDeposit, above maxDeposit, disabled plan, zero amount, insufficient balance, insufficient allowance |
| **withdrawAtMaturity** | Correct interest, too early (1s before), already withdrawn, paused, vault insufficient, non-owner withdraw |
| **earlyWithdraw** | Correct penalty, no interest, penalty to feeReceiver, at maturity (should use withdrawAtMaturity), paused |
| **renewDeposit** | Correct new principal, status update, APR locked, non-owner, too early, paused, disabled newPlan |
| **autoRenewDeposit** | Before grace period (revert), after grace period, APR locked to original, tenor from original, paused |
| **Vault** | Fund, withdraw, insufficient for interest, pause/unpause |
| **Admin** | createPlan, updatePlan, enable/disable, setFeeReceiver, pause |
| **Edge cases** | Zero interest (APR=0), max APR, boundary timestamps, large deposits |

#### Test helpers

```typescript
// Time helpers (Hardhat)
import { time } from "@nomicfoundation/hardhat-network-helpers";

// Fast-forward to maturity
await time.increaseTo(deposit.maturityAt);

// Fast-forward past grace period
await time.increase(GRACE_PERIOD_SECONDS + 1);

// Snapshot before action
const snapshot = await ethers.provider.send("evm_snapshot", []);

// Reset after test
await ethers.provider.send("evm_revert", [snapshot]);
```

#### Test data (Student ID: xxxxx79)

```typescript
const A = 9;
const B = 7;
const DEFAULT_APR_BPS = 200 + A * 25;    // 425 bps
const EARLY_PENALTY_BPS = 300 + B * 50;  // 650 bps
const DEFAULT_TENOR_DAYS = 180;          // B lẻ
const GRACE_PERIOD_DAYS = (A % 3) + 2;   // 2 ngày
const GRACE_PERIOD_SECONDS = GRACE_PERIOD_DAYS * 86400;
const PLAN_MIN_DEPOSIT = 550n * 10n**6n; // 550 USDC (plan-level example)
const PLAN_MAX_DEPOSIT = 5500n * 10n**6n; // 5,500 USDC (plan-level example)
const VAULT_FUNDING = 100000n * 10n**6n;  // Test fixture in Project.test.js
```

### 9.3 Frontend Implementation

#### Demo interface

The demo may be implemented as a single React screen rather than separate routes.
The current implementation provides:

- MetaMask connection and account display;
- active plan list and plan selection;
- MockUSDC balance display;
- approve + open deposit flow;
- deposit certificate list with status and maturity;
- maturity withdrawal, early withdrawal and manual renewal actions.

#### Contract interaction

```typescript
// From frontend/src/contracts.ts
- savingCoreContract(providerOrSigner)
- mockUsdcContract(providerOrSigner)
- formatUsdc(amount)
- parseUsdc(amountString)
- formatApr(bps)
- formatAddress(address)
```

### 9.4 Design Decisions to Document

Trong README.md section "Design Answers", phải giải thích:

1. **Transferable NFT:** Ai rút khi NFT được transfer? Tốt hay nguy hiểm?
2. **Empty vault:** Revert hay partial payout? Lý do?
3. **Dead bot:** User mất gì? Bảo vệ thế nào?
4. **Rounding dust:** Dust thuộc ai? Test case chứng minh?
5. **Boundary times:** `>=` hay `>`? Giải thích từng case?
6. **Disabled plan:** Users có thể làm gì? Renew INTO disabled?
7. **Attack vector:** one realistic attack + countermeasure

### 9.5 Common Mistakes to Avoid

| ❌ Sai | ✅ Đúng |
|--------|---------|
| Dùng 18 decimals cho USDC | Dùng **6 decimals** cho USDC |
| Trộn principal và interest pool | Tách biệt: SavingCore = principal, VaultManager = interest |
| Dùng plan rate cho auto-renew | Dùng **aprBpsAtOpen** (snapshot) cho auto-renew |
| Dùng `>` thay vì `>=` cho maturity | Dùng `>=` → user có thể rút tại exact maturity |
| Không check `isEnabled` khi renew | Check plan.isEnabled cho newPlanId |
| Không protect from reentrancy | Dùng ReentrancyGuard hoặc CEI pattern |
| Rounding precision loss | **Multiply before divide**: `(p × apr × t) / (365 × 86400 × 10000)` |
| Admin sửa deposit đã mở | Admin không có function để sửa deposit |
| Interest từ principal pool | Interest luôn từ **VaultManager** |
| Grace period check sai | `block.timestamp >= maturityAt + GRACE_PERIOD` (GRACE_PERIOD tính bằng giây) |

### 9.6 OpenZeppelin Libraries Used

| Library | Purpose |
|---------|---------|
| `ERC20` | MockUSDC base |
| `ERC20Burnable` | Token burning |
| `Ownable` | Access control |
| `ERC721` | Deposit certificates |
| `Pausable` | Emergency stop |
| `ReentrancyGuard` | Protect withdraw functions |

### 9.7 Gas Optimization Tips

1. Use `uint256` for all amounts (cheaper than splitting)
2. Pack structs to minimize storage slots
3. Use `view`/`pure` functions where possible
4. Emit events for all state changes (required for frontend)
5. Use `mapping` instead of `array` for lookups

---

## Phụ lục A: Công thức tổng hợp

### Interest calculation

```
interest = (principal × aprBpsAtOpen × tenorSeconds) / (365 × 86400 × 10000)

Where:
  principal = deposited amount in smallest unit (USDC × 10^6)
  aprBpsAtOpen = APR in basis points at deposit open
  tenorSeconds = deposit.maturityAt - deposit.openTimestamp
  365 × 86400 = seconds in a year
  10000 = convert bps to decimal
```

### Penalty calculation

```
penalty = (principal × penaltyBpsAtOpen) / 10000
userReceives = principal - penalty
penalty → feeReceiver (100%, không chia theo fee BPS)
```

### Renewal

```
Manual Renew:
  newPrincipal = principal + interest
  newAPR = current plan APR (snapshot at renew time)
  newTenor = new plan tenor
  newMaturity = block.timestamp + newTenor × 86400

Auto Renew:
  newPrincipal = principal + interest
  newAPR = aprBpsAtOpen (LOCKED — original rate)
  newTenor = original tenor (SAME as deposit)
  newMaturity = block.timestamp + originalTenor × 86400
```

---

## Phụ lục B: Checklists

### Pre-deployment checklist

- [ ] All constants use Student ID values (A=9, B=7)
- [ ] USDC decimals = 6
- [ ] Interest formula: multiply before divide
- [ ] Grace period: 2 days
- [ ] Vault funded with the amount required by the selected test fixture
- [ ] All events emitted correctly
- [ ] Reentrancy protection on withdraw
- [ ] Pause functionality works
- [ ] Plan validation (enabled, plan-level limits, tenor > 0)

### Pre-test checklist

- [ ] Test with A=9, B=7 values
- [ ] Coverage > 90%
- [ ] All edge cases tested
- [ ] Time fast-forward in tests
- [ ] Vault insufficient fund test
- [ ] Boundary timestamp tests
- [ ] Non-owner withdraw test
- [ ] Disabled plan tests

### Pre-demo checklist

- [ ] Frontend connects to MetaMask
- [ ] Can view plans
- [ ] Can open deposit
- [ ] Can view deposits
- [ ] Can withdraw at maturity
- [ ] Can renew deposit
- [ ] All numbers match Student ID variant
- [ ] Demo video 3-5 minutes

---

*File này được tạo từ Final_Assignment.docx — Dùng làm reference cho các lần chạy tiếp theo. Mọi thay đổi code phải tuân thủ các ràng buộc trong tài liệu này.*
