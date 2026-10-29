# Hệ thống ngân hàng trực tuyến trên Blockchain

Hệ thống tiền gửi có kỳ hạn trên blockchain, sử dụng lãi đơn, vault trả lãi và NFT ERC721 đại diện cho chứng nhận tiền gửi.

**Mã số sinh viên:** `xxxxx79`  
**A:** `9` (chữ số cuối)  
**B:** `7` (chữ số áp chót)

## 1. Tổng quan

Hệ thống cho phép người gửi tiền:

- xem các gói tiết kiệm đang hoạt động;
- mở tiền gửi bằng MockUSDC;
- nhận NFT ERC721 đại diện cho tiền gửi;
- rút tiền khi đáo hạn kèm lãi đơn;
- rút trước hạn kèm phí phạt;
- gia hạn thủ công sau khi đáo hạn; và
- được keeper tự động gia hạn sau thời gian ân hạn.

Quản trị viên ngân hàng có thể tạo và quản lý plan, nạp/rút tiền vault, thiết lập địa chỉ nhận phí và pause/unpause hệ thống.

## 2. Kiến trúc hệ thống

| Hợp đồng | Trách nhiệm |
|---|---|
| `backend/contracts/MockUSDC.sol` | Token ERC20 dùng để test, có 6 decimals và cho phép mint công khai. |
| `backend/contracts/VaultManager.sol` | Lưu tiền lãi của ngân hàng và quản lý các thao tác vault. |
| `backend/contracts/SavingCore.sol` | Quản lý plan, tiền gửi, NFT ERC721, rút tiền và gia hạn. |

### Tách biệt nguồn tiền

`SavingCore` giữ tiền gốc của người dùng. `VaultManager` giữ tiền của ngân hàng dùng để trả lãi. Lãi không được lấy từ tiền gốc của người dùng khác.

Sau khi deploy, các hợp đồng được liên kết theo thứ tự:

1. Deploy `MockUSDC`.
2. Deploy `SavingCore`.
3. Deploy `VaultManager`.
4. Thiết lập địa chỉ token và địa chỉ liên kết giữa các contract.
5. Tạo plan và nạp tiền vào vault.

### Các lựa chọn thiết kế

- `MockUSDC.mint()` được để public vì Final Assignment yêu cầu token test có thể mint tự do.
- `SavingCore` sử dụng `ReentrancyGuard`, `Pausable` và cập nhật trạng thái trước external call.
- Quyền thao tác deposit dựa trên `ownerOf(depositId)`, nên người đang giữ NFT là người có quyền với deposit.
- API vault hiện tại dùng `depositWithUSDC`, `withdrawFunds` và `withdrawToSavingCore`, tương ứng với các flow `fundVault` và `withdrawVault` trong assignment.
- `SavingCore` và `VaultManager` có trạng thái pause riêng vì mỗi contract quản lý một nhóm thao tác khác nhau.
- `totalCommittedInterest` chỉ dùng để theo dõi accounting; `withdrawFunds` chưa dùng biến này để giới hạn phần surplus. Vì vậy C2 chưa được claim là bonus đã hoàn thành.

## 3. Thông số cá nhân hóa

| Tham số | Công thức | Giá trị |
|---|---|---:|
| Grace period | `(A mod 3) + 2` ngày | **2 ngày** |
| APR mặc định | `200 + A × 25` bps | **425 bps (4,25%)** |
| Phí phạt mặc định | `300 + B × 50` bps | **650 bps (6,50%)** |
| Kỳ hạn mặc định | B lẻ → 180 ngày | **180 ngày** |

Script deploy tạo plan mặc định với:

- APR: `425` bps;
- phí phạt: `650` bps;
- kỳ hạn: `180` ngày;
- tiền gửi tối thiểu: `550 USDC`;
- tiền gửi tối đa: `5.500 USDC`.

## 4. Cấu trúc dữ liệu và công thức

### SavingPlan

```solidity
struct SavingPlan {
    uint256 aprBps;
    uint256 penaltyBps;
    uint256 tenorDays;
    uint256 minDeposit;
    uint256 maxDeposit;
    bool isEnabled;
}
```

`minDeposit` hoặc `maxDeposit` bằng `0` nghĩa là không giới hạn.

### Deposit

```solidity
struct Deposit {
    address owner;
    uint256 planId;
    uint256 principal;
    uint256 aprBpsAtOpen;
    uint256 penaltyBpsAtOpen;
    uint256 openTimestamp;
    uint256 maturityAt;
    DepositStatus status;
}
```

APR và penalty được snapshot tại thời điểm mở deposit. Việc cập nhật plan sau đó không ảnh hưởng đến deposit đã mở.

### Tính lãi

```text
interest =
  principal × aprBpsAtOpen × tenorSeconds
  / (365 × 86400 × 10000)
```

Code sử dụng phép chia số nguyên làm tròn xuống và chỉ tính lãi đến `maturityAt`.

### Phí phạt rút trước hạn

```text
penalty = principal × penaltyBpsAtOpen / 10000
userReceive = principal - penalty
```

Toàn bộ penalty được chuyển đến `feeReceiver`; rút trước hạn không nhận lãi.

## 5. Các quy trình chính

### Mở deposit

Người dùng approve MockUSDC cho `SavingCore`, sau đó gọi `openDeposit(planId, amount)`. Contract kiểm tra plan và số tiền, chuyển tiền gốc vào `SavingCore`, snapshot APR/penalty và mint NFT.

### Rút khi đáo hạn

Khi `block.timestamp >= maturityAt`, người đang giữ NFT có thể gọi `withdrawAtMaturity`. Contract yêu cầu lãi từ `VaultManager`, trả principal cộng interest và chuyển trạng thái thành `Withdrawn`. Nếu vault không đủ tiền lãi, giao dịch revert.

### Rút trước hạn

Khi `block.timestamp < maturityAt`, người giữ NFT có thể gọi `earlyWithdraw`. Contract chuyển trạng thái thành `Withdrawn`, gửi penalty đến `feeReceiver` và trả phần principal còn lại.

### Gia hạn thủ công

Từ thời điểm đáo hạn, người giữ NFT có thể gọi `renewDeposit(depositId, newPlanId)`. Lãi của deposit cũ được lấy từ vault và cộng vào principal mới. NFT mới được mint theo plan mới đang enabled.

### Gia hạn tự động

Sau `maturityAt + 2 ngày`, bất kỳ ai cũng có thể gọi `autoRenewDeposit`. Plan gốc phải vẫn enabled. Deposit mới giữ APR, penalty và tenor ban đầu, đồng thời NFT mới được mint cho người đang giữ NFT cũ.

## 6. Các event bắt buộc

`SavingCore` phát các event:

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
Withdrawn(uint256 depositId, address owner, uint256 principal, uint256 interest, bool isEarly)
Renewed(uint256 oldDepositId, uint256 newDepositId, uint256 newPrincipal, uint256 newPlanId)
```

Các event bổ sung gồm `VaultFunded`, `VaultWithdrawn`, `InterestPaid`, `FeeReceiverUpdated` và `Minted`.

## 7. Câu trả lời Oral Defense

### Q1. Chứng nhận NFT có thể chuyển nhượng

NFT có thể được chuyển nhượng. Các hàm rút và manual renew kiểm tra `ownerOf(depositId)`; auto-renew lấy owner hiện tại trước khi mint NFT mới. Vì vậy, nếu Alice chuyển NFT cho Bob thì Bob có quyền thao tác với deposit. Cách này tăng tính thanh khoản nhưng nếu mất NFT thì cũng mất quyền rút tiền. NFT mới khi renew được mint cho owner hiện tại, không dùng địa chỉ snapshot trong `Deposit.owner`.

**Bằng chứng trong code:** `SavingCore.sol:184`, `205`, `234-235`, `281`, `297-309`.

### Q2. Vault không đủ tiền

Nếu vault không đủ tiền trả lãi, `VaultManager.payInterest` sẽ revert. Do giao dịch có tính nguyên tử, principal không bị mất và deposit vẫn active, nhưng người dùng chưa thể rút khi đáo hạn cho đến khi vault được nạp thêm. Phương án khác là trả principal trước và cho claim interest sau. Project chọn revert vì đây là base rule của assignment và giữ settlement đơn giản, nhất quán.

**Bằng chứng trong code:** `VaultManager.sol:45-49` kiểm tra số dư và chỉ cho `savingCore` gọi; `SavingCore.sol:197-200` gọi vault trước khi chuyển tiền cho user. Nếu external call revert, toàn bộ transaction và thay đổi trạng thái được rollback.

### Q3. Bot auto-renew bị ngừng hoạt động

Bot bị offline không làm mất deposit hoặc làm giảm lãi của người dùng. Deposit vẫn active; người dùng vẫn có thể rút sau maturity hoặc gia hạn thủ công vào plan enabled. Auto-renew là permissionless nên keeper khác có thể gọi thay bot cũ. Trong hệ thống thực tế có thể dùng nhiều keeper hoặc bổ sung cơ chế user-triggered fallback.

**Bằng chứng trong code:** `SavingCore.sol:182-200` cho phép withdraw sau maturity; `232-241` cho phép manual renew sau maturity; `273-279` không yêu cầu caller của auto-renew là owner.

### Q4. Phần lẻ do làm tròn

Lãi được tính bằng phép chia số nguyên làm tròn xuống. Phần lẻ không được chuyển ra khỏi vault nên vault giữ phần dust. Vì số tiền trả luôn không lớn hơn lãi thực, việc làm tròn không gây thiếu tiền lãi. Test có trường hợp 14 ngày, APR 190 bps và kiểm tra kết quả integer chính xác.

**Bằng chứng trong code:** `SavingCore.sol:313-314` dùng phép chia số nguyên; `317-324` giới hạn interest tại maturity. Test tương ứng nằm trong `backend/test/Project.test.js`, phần `Precision & Rounding`.

### Q5. Thời điểm biên

Tại đúng `maturityAt`, `withdrawAtMaturity` được phép vì điều kiện `block.timestamp < maturityAt` không còn đúng; `earlyWithdraw` bị từ chối vì dùng `block.timestamp >= maturityAt`. Tại đúng `maturityAt + GRACE_PERIOD`, auto-renew được phép vì điều kiện `block.timestamp < maturityAt + GRACE_PERIOD` không còn đúng. Manual renew không có giới hạn kết thúc grace period, nên vẫn có thể thực hiện sau maturity nếu deposit chưa bị xử lý.

**Bằng chứng trong code:** `SavingCore.sol:188`, `209`, `239`, `278`; hằng số grace period ở `SavingCore.sol:13`.

### Q6. Plan bị disable

Disable plan chỉ ngăn deposit mới. Các deposit cũ vẫn có thể withdraw hoặc early withdraw. Manual renew yêu cầu plan đích phải enabled. Auto-renew cũng yêu cầu plan gốc vẫn enabled, nên disable plan gốc sẽ ngăn tạo deposit tự động mới.

**Bằng chứng trong code:** `SavingCore.sol:153` chặn mở deposit vào plan disabled; `232-241` kiểm tra plan đích khi manual renew; `273-280` kiểm tra plan gốc khi auto-renew.

### Q7. Phân tích tấn công

Tấn công chính được kiểm thử là reentrancy hoặc withdraw hai lần. Các flow deposit đều dùng `nonReentrant`; trạng thái được cập nhật trước khi gọi token hoặc vault. Vì vậy lần gọi lại sẽ thất bại do deposit không còn ở trạng thái `Active`. Kiểm tra ERC721 ownership cũng ngăn người không sở hữu NFT thao tác.

**Bằng chứng trong code:** `SavingCore.sol:151`, `182`, `203`, `232`, `273` dùng `nonReentrant`; trạng thái được cập nhật trước external call ở `197-200`, `221-229`, `267-270` và `293-310`; kiểm tra owner ở `184`, `205` và `235`.

## 8. Kiểm thử

Backend dùng Hardhat, ethers.js, Chai và Solidity Coverage.

```powershell
cd "C:\Users\duclu\OneDrive\Máy tính\Capstone Project\backend"
npm install
npm test
npx hardhat coverage
```

Kết quả kiểm thử hiện tại:

| Chỉ số | Kết quả |
|---|---:|
| Số test | **49 passing** |
| Statements | **100%** |
| Branches | **94,02%** |
| Functions | **100%** |
| Lines | **100%** |

Test bao phủ validation plan, các flow chính, chuyển NFT, pause, quản trị vault, vault thiếu tiền, rounding, event và thông số cá nhân hóa.

## 9. Chạy demo local từ đầu đến cuối

### Yêu cầu

- Node.js `>= 18`;
- npm `>= 9`;
- MetaMask.

### Khởi động backend

Mở Terminal 1:

```powershell
cd "C:\Users\duclu\OneDrive\Máy tính\Capstone Project\backend"
npm install
npx hardhat compile
npm run node
```

Giữ terminal này hoạt động. Blockchain local sử dụng:

```text
RPC URL: http://127.0.0.1:8545
Chain ID: 31337
```

### Deploy contract

Mở Terminal 2:

```powershell
cd "C:\Users\duclu\OneDrive\Máy tính\Capstone Project\backend"
npx hardhat run scripts/deploy-all.js --network localhost
```

Lưu lại ba địa chỉ được in ra: `MockUSDC`, `VaultManager` và `SavingCore`.

### Cấu hình và chạy frontend

Mở Terminal 3:

```powershell
cd "C:\Users\duclu\OneDrive\Máy tính\Capstone Project\frontend"
Copy-Item .env.example .env
```

Điền địa chỉ contract vào `frontend/.env`:

```env
VITE_SAVING_CORE_ADDRESS=0x...
VITE_MOCK_USDC_ADDRESS=0x...
VITE_VAULT_MANAGER_ADDRESS=0x...
```

Sau đó chạy:

```powershell
npm install
npm run dev
```

Mở `http://localhost:5173`.

### Cấu hình MetaMask

Thêm mạng sau vào MetaMask:

```text
Tên mạng: Hardhat Local
RPC URL: http://127.0.0.1:8545
Chain ID: 31337
Currency symbol: ETH
```

Import một private key do `npm run node` in ra, sau đó kết nối MetaMask trong frontend.

### Trình tự demo

1. Kết nối ví.
2. Kiểm tra plan enabled và số dư MockUSDC.
3. Chọn plan, nhập số tiền trong giới hạn.
4. Bấm **Open deposit** và approve MockUSDC.
5. Xác nhận giao dịch mở deposit và kiểm tra NFT certificate.
6. Trước maturity, thử **Early withdraw**.
7. Sau maturity, chọn **Withdraw at maturity** hoặc chọn plan enabled để **Renew**.

Frontend chỉ là client demo. Không thể tua thời gian blockchain trực tiếp từ giao diện; dùng test Hardhat hoặc công cụ phát triển local để kiểm tra maturity và grace period.

## 10. Triển khai và demo trên Sepolia Testnet

`npm test` và `npx hardhat coverage` chạy trên Hardhat Network cục bộ, không chạy trực tiếp trên Sepolia. Trên Sepolia, quy trình kiểm thử phù hợp là deploy contract thật lên testnet, sau đó tương tác qua frontend hoặc script kiểm tra.

### Chuẩn bị

Cần có:

- ví deploy riêng cho Sepolia;
- private key của ví deploy;
- Sepolia ETH để trả gas;
- RPC endpoint Sepolia từ Alchemy, Infura hoặc nhà cung cấp tương đương; và
- Etherscan API key nếu muốn verify contract.

Không commit file `.env` hoặc chia sẻ private key.

### Cấu hình biến môi trường

Từ thư mục `backend`:

```powershell
cd "C:\Users\duclu\OneDrive\Máy tính\Capstone Project\backend"
Copy-Item .env_example .env
```

Điền các giá trị thật vào `backend/.env`:

```env
RPC_URL_SEPOLIA=https://eth-sepolia.g.alchemy.com/v2/DEMO_API_KEY
TESTNET_PRIVATE_KEY=0xPRIVATE_KEY_CUA_VI_DEPLOY
ETHERSCAN_API_KEY=YOUR_ETHERSCAN_API_KEY
REPORT_GAS=0
```

`TESTNET_PRIVATE_KEY` phải là private key 32-byte, gồm cả tiền tố `0x`. Không dùng private key chứa tài sản thật.

### Compile và deploy lên Sepolia

```powershell
cd "C:\Users\duclu\OneDrive\Máy tính\Capstone Project\backend"
npm install
npx hardhat compile
npx hardhat run scripts/deploy-all.js --network sepolia
```

Script sẽ:

1. deploy `MockUSDC`;
2. mint MockUSDC cho ví deploy;
3. deploy `VaultManager`;
4. deploy `SavingCore`;
5. thiết lập các địa chỉ liên kết;
6. tạo plan mặc định theo Student ID `xxxxx79`; và
7. nạp `1.000 MockUSDC` vào vault.

Lưu lại ba địa chỉ contract được in ra:

```text
MockUSDC
VaultManager
SavingCore
```

Có thể kiểm tra giao dịch và địa chỉ contract trên:

```text
https://sepolia.etherscan.io
```

### Cấu hình frontend dùng Sepolia

Trong `frontend/.env`, điền địa chỉ contract Sepolia:

```env
VITE_SAVING_CORE_ADDRESS=địa_chỉ_SavingCore_trên_Sepolia
VITE_MOCK_USDC_ADDRESS=địa_chỉ_MockUSDC_trên_Sepolia
VITE_VAULT_MANAGER_ADDRESS=địa_chỉ_VaultManager_trên_Sepolia
```

Sau đó chạy frontend:

```powershell
cd "C:\Users\duclu\OneDrive\Máy tính\Capstone Project\frontend"
npm install
npm run dev
```

Trong MetaMask:

1. Chọn mạng **Sepolia Test Network**.
2. Kết nối đúng ví deploy hoặc ví test đã nhận MockUSDC.
3. Mở `http://localhost:5173`.
4. Kiểm tra plan, số dư token và các địa chỉ contract trước khi giao dịch.

### Kiểm thử các flow trên Sepolia

Các flow có thể kiểm thử thủ công:

1. Kết nối ví trên Sepolia.
2. Kiểm tra plan mặc định.
3. Approve MockUSDC cho `SavingCore`.
4. Mở deposit trong giới hạn `550–5.500 USDC`.
5. Kiểm tra NFT certificate và thông tin deposit.
6. Kiểm thử early withdrawal trước maturity.
7. Kiểm thử manual renew sau maturity.
8. Kiểm tra event `DepositOpened`, `Withdrawn` và `Renewed` trên Etherscan.

Vì plan mặc định có kỳ hạn 180 ngày, không nên chờ đến maturity để demo. Có thể tạo thêm plan test ngắn hạn bằng admin:

```text
tenorDays: 1
aprBps: 425
penaltyBps: 650
minDeposit: 0
maxDeposit: 0
```

Sau đó chờ khoảng 1 ngày để kiểm thử maturity. Không thể tua thời gian Sepolia như Hardhat Network.

### Giới hạn khi kiểm thử Sepolia

- `MockUSDC` là token test của project, không phải USDC thật.
- Mọi giao dịch Sepolia đều tiêu tốn Sepolia ETH.
- `npm test` không phải test runner cho Sepolia; nó dùng fixture và thời gian giả lập của Hardhat.
- Không dùng các địa chỉ contract local trong cấu hình frontend Sepolia.
- Nếu khởi động deploy lại, các địa chỉ contract sẽ thay đổi và cần cập nhật lại `frontend/.env`.

## 11. Cấu trúc repository

```text
backend/
  contracts/
    MockUSDC.sol
    VaultManager.sol
    SavingCore.sol
    interfaces/IMockUSDC.sol
  scripts/deploy-all.js
  test/Project.test.js
frontend/
  src/App.tsx
  src/contracts.ts
  src/styles.css
  .env.example
docs/
  Final_Assignment.docx
  PROJECT_SPECIFICATION.md
```

## 12. Phạm vi bonus

Các flow cơ bản của assignment đã được triển khai và kiểm thử. Project không claim hoàn thành bonus C1-C5:

- C1: chưa triển khai cơ chế trả principal trước, claim lãi sau;
- C2: chưa triển khai đầy đủ solvency guard cho việc rút vault;
- C3: chưa hỗ trợ rút một phần principal;
- C4: chưa hỗ trợ top-up deposit; và
- C5: không claim ý tưởng bổ sung.

## 13. Kết quả đối chiếu tài liệu

`docs/Final_Assignment.docx` là tài liệu tham chiếu chính. Code và README được đối chiếu theo các yêu cầu bắt buộc trong tài liệu này.

### Các yêu cầu đã đáp ứng

- Đủ ba contract chính: `MockUSDC`, `VaultManager`, `SavingCore`.
- MockUSDC có 6 decimals và `mint` public cho testing (`MockUSDC.sol:12-22`).
- Có ERC721 certificate và các trạng thái `Active`, `Withdrawn`, `ManualRenewed`, `AutoRenewed` (`SavingCore.sol:27`, `38-47`).
- Có snapshot APR/penalty, simple interest, early withdrawal, manual renew và auto-renew (`SavingCore.sol:151-310`).
- Có năm event bắt buộc của `SavingCore` (`SavingCore.sol:61-65`).
- Có test Hardhat với coverage branch toàn project trên 90%.
- Có frontend demo cho xem plan, mở deposit, xem deposit, withdraw và renew.

### Các điểm cần trình bày rõ khi submission

1. **Tên hàm vault:** Final Assignment mô tả `fundVault`/`withdrawVault`, trong khi code dùng `depositWithUSDC`/`withdrawFunds`/`withdrawToSavingCore` (`VaultManager.sol:28-43`). Chức năng tương ứng đã có, nhưng tên API khác.
2. **Pause:** `SavingCore` chặn open/withdraw/renew bằng `whenNotPaused` (`SavingCore.sol:151`, `182`, `203`, `232`, `273`). `VaultManager` có pause riêng cho các thao tác vault (`VaultManager.sol:28`, `31`, `37`, `43`). Đây là lựa chọn kiến trúc cần giải thích khi bảo vệ.
3. **C2 Solvency Guard:** biến `totalCommittedInterest` được cập nhật (`SavingCore.sol:59`, `175`, `191-195`, `215-219`, `246-251`, `286-291`), nhưng `withdrawFunds` chỉ kiểm tra số dư hiện tại (`VaultManager.sol:39-41`). Vì vậy không claim C2 bonus.
4. **Tài liệu mở rộng:** `PROJECT_SPECIFICATION.md` có một số yêu cầu mở rộng ngoài Final Assignment, như event bổ sung, quy tắc pause khi mở deposit và mô tả `Minted` là admin-only. Khi có khác biệt, Final Assignment được ưu tiên; `MockUSDC.mint` trong code giữ public đúng theo Final Assignment.
