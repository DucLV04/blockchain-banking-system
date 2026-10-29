# Blockchain Term Deposit

Hệ thống tiền gửi có kỳ hạn trên blockchain. Người dùng gửi MockUSDC vào smart contract, nhận NFT ERC721 làm chứng nhận tiền gửi, nhận lãi đơn khi đáo hạn hoặc có thể rút trước hạn với phí phạt.

> **Lưu ý:** Đây là project học tập sử dụng MockUSDC, không phải hệ thống ngân hàng hoặc tài sản tài chính thực tế.

## 1. Tính năng

### Người gửi tiền

- Xem các saving plan đang hoạt động.
- Mở deposit bằng MockUSDC.
- Nhận NFT ERC721 đại diện cho deposit.
- Rút tiền khi đáo hạn và nhận principal + interest.
- Rút trước hạn và chịu penalty.
- Gia hạn thủ công sang plan khác sau maturity.
- Auto-renew permissionless sau grace period.
- Chuyển NFT cho người khác; quyền thao tác thuộc về owner hiện tại của NFT.

### Quản trị viên

- Tạo, cập nhật, enable và disable saving plan.
- Nạp tiền vào interest vault.
- Rút tiền khỏi vault hoặc chuyển tiền sang `SavingCore`.
- Cấu hình fee receiver.
- Pause/unpause các thao tác khẩn cấp.

## 2. Kiến trúc

```text
MockUSDC
   │
   ├── SavingCore ── giữ principal của người dùng
   │      └──── ERC721 deposit certificate
   │
   └── VaultManager ── giữ nguồn tiền lãi của ngân hàng
```

| Contract | Trách nhiệm |
|---|---|
| [`MockUSDC.sol`](./backend/contracts/MockUSDC.sol) | ERC20 test token, 6 decimals, public mint |
| [`SavingCore.sol`](./backend/contracts/SavingCore.sol) | Plan, deposit, NFT, interest, withdrawal và renewal |
| [`VaultManager.sol`](./backend/contracts/VaultManager.sol) | Interest pool, funding, payout, withdrawal và pause |

Principal và interest được tách thành hai pool độc lập. `SavingCore` không dùng principal của deposit khác để trả lãi.

## 3. Thông số project

Các tham số cá nhân hóa được tính từ hai chữ số cuối của mã sinh viên đã ẩn:

| Tham số | Công thức | Giá trị |
|---|---|---:|
| APR mặc định | `200 + A × 25` | `425 bps = 4,25%` |
| Penalty mặc định | `300 + B × 50` | `650 bps = 6,50%` |
| Kỳ hạn mặc định | `B` lẻ → `180 ngày` | `180 ngày` |
| Grace period | `(A mod 3) + 2` | `2 ngày` |

Plan mặc định trong script deploy:

- APR: `425 bps`;
- penalty: `650 bps`;
- tenor: `180 ngày`;
- minimum deposit: `550 USDC`;
- maximum deposit: `5.500 USDC`.

## 4. Quy tắc nghiệp vụ

### Lãi đơn

```text
interest =
  principal × aprBpsAtOpen × tenorSeconds
  / (365 × 86400 × 10000)
```

APR được snapshot khi mở deposit. Phép chia số nguyên làm tròn xuống và thời gian tính lãi được giới hạn tại `maturityAt`.

### Rút trước hạn

```text
penalty = principal × penaltyBpsAtOpen / 10000
userReceive = principal - penalty
```

Toàn bộ penalty được chuyển tới `feeReceiver`; rút trước hạn không nhận interest.

### Các flow chính

1. **Open deposit:** approve MockUSDC → gọi `openDeposit(planId, amount)` → chuyển principal vào `SavingCore` và mint NFT.
2. **Maturity withdrawal:** sau `maturityAt`, owner NFT gọi `withdrawAtMaturity`.
3. **Early withdrawal:** trước `maturityAt`, owner NFT gọi `earlyWithdraw`.
4. **Manual renewal:** sau maturity, owner NFT gọi `renewDeposit(depositId, newPlanId)`.
5. **Auto-renewal:** sau `maturityAt + 2 ngày`, bất kỳ account nào cũng có thể gọi `autoRenewDeposit`.

Nếu vault không đủ interest, giao dịch maturity withdrawal hoặc renewal sẽ revert nguyên tử. Principal vẫn nằm trong `SavingCore` và deposit vẫn ở trạng thái active.

## 5. Bảo mật và kiểm soát quyền

- `Ownable2Step` cho các thao tác quản trị.
- `ReentrancyGuard` cho các flow thay đổi trạng thái deposit.
- Checks-Effects-Interactions: cập nhật status trước external call.
- Kiểm tra `ownerOf(depositId)` thay vì dùng owner snapshot để xác định quyền.
- `Pausable` tại `SavingCore` và `VaultManager`.
- Kiểm tra plan, amount, maturity, status và vault balance.
- Deposit cũ vẫn có thể xử lý sau khi plan bị disable; deposit mới hoặc renewal vào plan disabled bị từ chối.

## 6. Events

`SavingCore` phát năm event nghiệp vụ chính:

```solidity
PlanCreated(uint256 planId, uint256 tenorDays, uint256 aprBps)
PlanUpdated(uint256 planId, uint256 newAprBps)
DepositOpened(
    uint256 depositId,
    address owner,
    uint256 planId,
    uint256 principal,
    uint256 maturityAt,
    uint256 aprBpsAtOpen
)
Withdrawn(
    uint256 depositId,
    address owner,
    uint256 principal,
    uint256 interest,
    bool isEarly
)
Renewed(
    uint256 oldDepositId,
    uint256 newDepositId,
    uint256 newPrincipal,
    uint256 newPlanId
)
```

Các event hỗ trợ gồm `VaultFunded`, `VaultWithdrawn`, `InterestPaid`, `FeeReceiverUpdated`, `PenaltyCharged` và `Minted`.

## 7. Kiểm thử

Test suite nằm tại [`Project.test.js`](./backend/test/Project.test.js).

```text
49 tests passing
Statements: 100%
Branches:   94.02%
Functions:  100%
Lines:      100%
```

Các nhóm test gồm:

- MockUSDC và decimals;
- plan validation và admin controls;
- open deposit;
- maturity withdrawal;
- early withdrawal;
- manual renewal;
- auto-renewal;
- NFT transfer;
- pause/unpause;
- vault funding và insufficient balance;
- event emission;
- rounding và zero-interest cases.

Chạy test:

```powershell
cd "C:\Users\duclu\OneDrive\Máy tính\Capstone Project\backend"
npm install
npm test
npx hardhat coverage
```

## 8. Chạy demo local

### Yêu cầu

- Node.js `>= 18`;
- npm `>= 9`;
- MetaMask.

### Khởi động blockchain

Terminal 1:

```powershell
cd "C:\Users\duclu\OneDrive\Máy tính\Capstone Project\backend"
npm install
npx hardhat compile
npm run node
```

Thông số Hardhat Local:

```text
RPC URL: http://127.0.0.1:8545
Chain ID: 31337
```

### Deploy contracts

Terminal 2:

```powershell
cd "C:\Users\duclu\OneDrive\Máy tính\Capstone Project\backend"
npx hardhat run scripts/deploy-all.js --network localhost
```

Lưu lại địa chỉ `MockUSDC`, `VaultManager` và `SavingCore`.

### Chạy frontend

Terminal 3:

```powershell
cd "C:\Users\duclu\OneDrive\Máy tính\Capstone Project\frontend"
Copy-Item .env.example .env
```

Điền địa chỉ contract vào `.env`:

```env
VITE_SAVING_CORE_ADDRESS=0x...
VITE_MOCK_USDC_ADDRESS=0x...
VITE_VAULT_MANAGER_ADDRESS=0x...
```

Sau đó:

```powershell
npm install
npm run dev
```

Mở `http://localhost:5173`.

Trong MetaMask, thêm mạng:

```text
Network name: Hardhat Local
RPC URL: http://127.0.0.1:8545
Chain ID: 31337
Currency symbol: ETH
```

Import một private key test do Hardhat in ra, sau đó:

1. Connect MetaMask.
2. Chọn plan.
3. Approve và mở deposit.
4. Kiểm tra NFT certificate.
5. Thử early withdrawal hoặc manual renewal.

Frontend hiện là một màn hình demo tập trung, gồm kết nối ví, xem balance, xem plan, mở deposit và quản lý các deposit.

## 9. Triển khai Sepolia

Sepolia cần:

- ví test riêng;
- Sepolia ETH;
- RPC endpoint;
- private key và API key chỉ lưu trong `backend/.env`.

Tạo file môi trường:

```powershell
cd "C:\Users\duclu\OneDrive\Máy tính\Capstone Project\backend"
Copy-Item .env_example .env
```

Thiết lập:

```env
RPC_URL_SEPOLIA=https://eth-sepolia.g.alchemy.com/v2/YOUR_API_KEY
TESTNET_PRIVATE_KEY=0xYOUR_TEST_PRIVATE_KEY
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_API_KEY
REPORT_GAS=0
```

Deploy:

```powershell
npm install
npx hardhat compile
npx hardhat run scripts/deploy-all.js --network sepolia
```

Sau khi deploy, cập nhật ba địa chỉ contract vào `frontend/.env`, chọn Sepolia trong MetaMask và chạy frontend bằng `npm run dev`.

Coverage và unit test dùng Hardhat Network local; chúng không chạy trực tiếp trên Sepolia. Sepolia phù hợp để kiểm tra triển khai và tương tác thực tế qua frontend hoặc script.

Auto-renew cần chờ thời gian thực trên Sepolia vì không thể dùng `evm_increaseTime`. Để demo nhanh, dùng Hardhat Local với plan tenor ngắn trong môi trường phát triển.

## 10. Các câu hỏi thiết kế

### NFT có thể chuyển nhượng không?

Có. Người đang sở hữu NFT tại thời điểm gọi hàm là người có quyền rút hoặc renew. Nếu Alice chuyển NFT cho Bob trước maturity thì Bob có thể thao tác với deposit, còn Alice không còn quyền. Điều này hỗ trợ tính thanh khoản nhưng cũng có nghĩa là mất NFT sẽ mất quyền kiểm soát deposit. NFT mới khi renew được mint cho owner hiện tại, không dùng owner snapshot trong struct `Deposit`.

**Bằng chứng trong code:** `SavingCore.sol:184`, `205`, `234-235`, `281` và `297-309`.

### Nếu vault không đủ tiền thì sao?

`VaultManager.payInterest` revert nếu số dư vault nhỏ hơn interest cần trả. Vì `withdrawAtMaturity` và renewal gọi vault trước khi hoàn tất settlement, toàn bộ transaction revert nguyên tử: principal không bị mất, deposit vẫn active và người dùng có thể thử lại sau khi vault được nạp thêm. Một alternative là trả principal trước rồi cho claim interest sau, nhưng project chọn revert để giữ settlement đơn giản và nhất quán.

**Bằng chứng trong code:** `VaultManager.sol:45-49` kiểm tra số dư và chỉ cho `SavingCore` gọi; `SavingCore.sol:197-200` thực hiện payout sau lời gọi vault.

### Nếu bot auto-renew ngừng hoạt động?

Deposit đã qua grace period vẫn giữ trạng thái `Active`; người dùng không mất lãi vì APR và penalty đã snapshot, còn interest được cap tại maturity. Người dùng vẫn có thể rút sau maturity hoặc renew thủ công sang plan enabled. Auto-renew là permissionless nên keeper khác có thể gọi thay bot cũ; deposit mới bắt đầu tại thời điểm gọi, không backdate.

**Bằng chứng trong code:** `SavingCore.sol:182-200` cho maturity withdrawal, `232-241` cho manual renewal và `273-279` cho permissionless auto-renew.

### Rounding dust thuộc về ai?

Interest được tính bằng phép chia số nguyên nên được làm tròn xuống. Vault chỉ trả phần interest đã làm tròn; phần dust nhỏ hơn một đơn vị token vẫn ở lại vault. Việc này không làm thiếu khoản interest đã cam kết vì `floor(trueInterest) <= trueInterest`, và settlement luôn tính đến maturity thay vì thời điểm rút.

**Bằng chứng trong code:** `SavingCore.sol:313-314` dùng integer division; `317-324` tính full interest theo khoảng thời gian đến maturity. Test rounding nằm trong nhóm `Precision & Rounding` của `backend/test/Project.test.js`.

### Boundary time được xử lý thế nào?

- Tại đúng `maturityAt`, maturity withdrawal được phép vì điều kiện `block.timestamp < maturityAt` không còn đúng; early withdrawal bị từ chối vì dùng `block.timestamp >= maturityAt`.
- Tại đúng `maturityAt + GRACE_PERIOD`, auto-renew được phép vì điều kiện `block.timestamp < maturityAt + GRACE_PERIOD` không còn đúng.
- Manual renewal chỉ yêu cầu `block.timestamp >= maturityAt`, không có upper bound của grace period; vì vậy vẫn được phép nếu deposit còn active và chưa auto-renew.

**Bằng chứng trong code:** `SavingCore.sol:188`, `209`, `239`, `278`; `GRACE_PERIOD` được khai báo tại `SavingCore.sol:13`.

### Plan bị disable ảnh hưởng thế nào?

Disable plan chỉ ngăn deposit mới; các deposit cũ vẫn có thể maturity withdraw hoặc early withdraw. Manual renewal yêu cầu plan đích đang enabled. Auto-renew cũng yêu cầu plan gốc vẫn enabled, vì auto-renew tạo một deposit mới theo plan đó.

**Bằng chứng trong code:** `SavingCore.sol:153` kiểm tra plan khi mở deposit; `232-241` kiểm tra plan đích khi manual renew; `273-280` kiểm tra plan gốc khi auto-renew.

### Các biện pháp chống tấn công

Một attack thực tế là gọi lại `withdrawAtMaturity` trong quá trình token/vault transfer để rút hai lần. Các flow chính dùng `nonReentrant`; status được cập nhật trước external call, nên lần gọi lại sẽ thất bại vì deposit không còn `Active`. Kiểm tra ERC721 ownership cũng ngăn người không sở hữu NFT thao tác.

**Bằng chứng trong code:** `SavingCore.sol:151`, `182`, `203`, `232`, `273` dùng `nonReentrant`; status được cập nhật trước external call ở `197-200`, `221-229`, `267-270` và `293-310`. Test suite bao phủ pause, unauthorized calls, repeated withdrawal và các nhánh lỗi liên quan.

## 11. Giới hạn hiện tại

- `MockUSDC` chỉ phục vụ test và demo.
- Auto-renew trên Sepolia cần chờ maturity/grace period thực tế.
- `totalCommittedInterest` hiện phục vụ accounting; `VaultManager.withdrawFunds` chưa giới hạn admin chỉ được rút phần surplus. Đây là hướng mở rộng cho phiên bản sau.
- Chưa triển khai partial withdrawal, top-up deposit hoặc delayed-interest claim.

## 12. Cấu trúc repository

```text
backend/
  contracts/
    MockUSDC.sol
    SavingCore.sol
    VaultManager.sol
    interfaces/IMockUSDC.sol
  config/variant.ts
  scripts/deploy-all.js
  test/Project.test.js
  package.json

frontend/
  src/
    App.tsx
    contracts.ts
    main.tsx
    styles.css
  .env.example
  package.json

docs/
  Final_Assignment.docx
  PROJECT_SPECIFICATION.md
  PROJECT_PLAN.md
```
