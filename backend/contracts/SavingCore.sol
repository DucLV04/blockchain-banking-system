// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./interfaces/IMockUSDC.sol";
import "./VaultManager.sol";

contract SavingCore is ERC721, Ownable2Step, Pausable, ReentrancyGuard {
    uint256 public constant GRACE_PERIOD = 2 days;

    // Custom Errors
    error InvalidDepositAmount();
    error InvalidPlanParams();
    error PlanNotFound(uint256 planId);
    error PlanDisabled();
    error DepositNotFound(uint256 depositId);
    error NotDepositOwner();
    error DepositNotActive();
    error NotMatured();
    error AlreadyMatured();
    error SystemPaused();

    enum DepositStatus { Active, Withdrawn, ManualRenewed, AutoRenewed }

    struct SavingPlan {
        uint256 aprBps;
        uint256 penaltyBps;
        uint256 tenorDays;
        uint256 minDeposit;
        uint256 maxDeposit;
        bool isEnabled;
    }

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

    uint256 public nextPlanId;
    uint256 public nextDepositId;
    mapping(uint256 => SavingPlan) public plans;
    mapping(uint256 => Deposit) public deposits;
    
    address public vaultManager;
    IMockUSDC public mockUSDC;
    address public feeReceiver;
    
    // Track total committed interest to prevent over-withdrawal from vault
    uint256 public totalCommittedInterest;

    event PlanCreated(uint256 planId, uint256 tenorDays, uint256 aprBps);
    event PlanUpdated(uint256 planId, uint256 newAprBps);
    event DepositOpened(uint256 depositId, address owner, uint256 planId, uint256 principal, uint256 maturityAt, uint256 aprBpsAtOpen);
    event Withdrawn(uint256 depositId, address owner, uint256 principal, uint256 interest, bool isEarly);
    event Renewed(uint256 oldDepositId, uint256 newDepositId, uint256 newPrincipal, uint256 newPlanId);
    event PenaltyCharged(uint256 indexed depositId, address indexed receiver, uint256 penalty);
    event InterestDeferred(uint256 indexed depositId, address indexed owner, uint256 amount);
    event VaultManagerSet(address newVault);
    event FeeReceiverUpdated(address oldReceiver, address newReceiver);

    constructor(address initialOwner) ERC721("Deposit Certificate", "DPC") Ownable(initialOwner) {
        nextPlanId = 1;
        nextDepositId = 1;
        totalCommittedInterest = 0;
    }

    function setVaultManager(address _vault) external onlyOwner {
        require(_vault != address(0), "Zero address");
        vaultManager = _vault;
        emit VaultManagerSet(_vault);
    }

    function setMockUSDC(address _usdc) external onlyOwner {
        require(_usdc != address(0), "Zero address");
        mockUSDC = IMockUSDC(_usdc);
    }

    function setFeeReceiver(address _receiver) external onlyOwner {
        require(_receiver != address(0), "Zero address");
        emit FeeReceiverUpdated(feeReceiver, _receiver);
        feeReceiver = _receiver;
    }

    function createPlan(
        uint256 aprBps,
        uint256 penaltyBps,
        uint256 tenorDays,
        uint256 minDep,
        uint256 maxDep
    ) external onlyOwner returns (uint256) {
        _validatePlanParams(aprBps, penaltyBps, tenorDays, minDep, maxDep);

        uint256 planId = nextPlanId++;
        plans[planId] = SavingPlan({
            aprBps: aprBps,
            penaltyBps: penaltyBps,
            tenorDays: tenorDays,
            minDeposit: minDep,
            maxDeposit: maxDep,
            isEnabled: true
        });
        emit PlanCreated(planId, tenorDays, aprBps);
        return planId;
    }

    function updatePlan(uint256 planId, uint256 newAprBps) external onlyOwner {
        if (planId >= nextPlanId) revert PlanNotFound(planId);
        if (newAprBps == 0 || newAprBps > 10000) revert InvalidPlanParams();

        plans[planId].aprBps = newAprBps;
        emit PlanUpdated(planId, newAprBps);
    }

    function disablePlan(uint256 planId) external onlyOwner {
        require(planId < nextPlanId, "Plan not found");
        plans[planId].isEnabled = false;
        emit PlanUpdated(planId, plans[planId].aprBps);
    }

    function enablePlan(uint256 planId) external onlyOwner {
        require(planId < nextPlanId, "Plan not found");
        plans[planId].isEnabled = true;
        emit PlanUpdated(planId, plans[planId].aprBps);
    }

    function _validatePlanParams(
        uint256 aprBps,
        uint256 penaltyBps,
        uint256 tenorDays,
        uint256 minDep,
        uint256 maxDep
    ) internal pure {
        if (aprBps == 0) revert InvalidPlanParams();
        if (aprBps > 10000) revert InvalidPlanParams();
        if (penaltyBps > 10000) revert InvalidPlanParams();
        if (tenorDays == 0) revert InvalidPlanParams();
        if (tenorDays > 3650) revert InvalidPlanParams();
        if (maxDep > 0 && minDep > maxDep) revert InvalidPlanParams();
    }

    function openDeposit(uint256 planId, uint256 amount) external whenNotPaused nonReentrant {
        if (planId >= nextPlanId) revert PlanNotFound(planId);
        if (!plans[planId].isEnabled) revert PlanDisabled();
        if (amount == 0) revert InvalidDepositAmount();

        SavingPlan storage plan = plans[planId];
        if (plan.minDeposit > 0 && amount < plan.minDeposit) revert InvalidDepositAmount();
        if (plan.maxDeposit > 0 && amount > plan.maxDeposit) revert InvalidDepositAmount();

        uint256 depositId = nextDepositId++;
        uint256 tenor = plans[planId].tenorDays;
        uint256 interest = _calcInterest(amount, plans[planId].aprBps, tenor * 86400);
        
        deposits[depositId] = Deposit({
            owner: msg.sender,
            planId: planId,
            principal: amount,
            aprBpsAtOpen: plans[planId].aprBps,
            penaltyBpsAtOpen: plans[planId].penaltyBps,
            openTimestamp: block.timestamp,
            maturityAt: block.timestamp + tenor * 86400,
            status: DepositStatus.Active
        });

        totalCommittedInterest += interest;

        mockUSDC.transferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, depositId);
        emit DepositOpened(depositId, msg.sender, planId, amount, deposits[depositId].maturityAt, deposits[depositId].aprBpsAtOpen);
    }

    function withdrawAtMaturity(uint256 depositId) external whenNotPaused nonReentrant {
        if (depositId == 0 || depositId >= nextDepositId) revert DepositNotFound(depositId);
        if (ownerOf(depositId) != msg.sender) revert NotDepositOwner();
        
        Deposit storage dep = deposits[depositId];
        if (dep.status != DepositStatus.Active) revert DepositNotActive();
        if (block.timestamp < dep.maturityAt) revert NotMatured();

        uint256 interest = _fullInterestOf(dep);
        if (totalCommittedInterest > interest) {
            totalCommittedInterest = totalCommittedInterest - interest;
        } else {
            totalCommittedInterest = 0;
        }
        
        dep.status = DepositStatus.Withdrawn;
        VaultManager(vaultManager).payInterest(depositId, interest);
        mockUSDC.transfer(msg.sender, dep.principal + interest);
        emit Withdrawn(depositId, msg.sender, dep.principal, interest, false);
    }

    function earlyWithdraw(uint256 depositId) external whenNotPaused nonReentrant {
        if (depositId == 0 || depositId >= nextDepositId) revert DepositNotFound(depositId);
        if (ownerOf(depositId) != msg.sender) revert NotDepositOwner();
        
        Deposit storage dep = deposits[depositId];
        if (dep.status != DepositStatus.Active) revert DepositNotActive();
        if (block.timestamp >= dep.maturityAt) revert AlreadyMatured();

        uint256 penalty = (dep.principal * dep.penaltyBpsAtOpen) / 10000;
        uint256 netAmount = dep.principal - penalty;
        
        uint256 interest = _fullInterestOf(dep);
        if (totalCommittedInterest > interest) {
            totalCommittedInterest = totalCommittedInterest - interest;
        } else {
            totalCommittedInterest = 0;
        }
        
        dep.status = DepositStatus.Withdrawn;
        
        if (penalty > 0) {
            mockUSDC.transfer(feeReceiver, penalty);
            emit PenaltyCharged(depositId, feeReceiver, penalty);
        }
        
        mockUSDC.transfer(msg.sender, netAmount);
        emit Withdrawn(depositId, msg.sender, dep.principal, 0, true);
    }

    function renewDeposit(uint256 depositId, uint256 newPlanId) external whenNotPaused nonReentrant returns (uint256 newDepositId) {
        if (depositId == 0 || depositId >= nextDepositId) revert DepositNotFound(depositId);
        address currentOwner = ownerOf(depositId);
        if (currentOwner != msg.sender) revert NotDepositOwner();
        
        Deposit storage dep = deposits[depositId];
        if (dep.status != DepositStatus.Active) revert DepositNotActive();
        if (block.timestamp < dep.maturityAt) revert NotMatured();
        if (newPlanId >= nextPlanId) revert PlanNotFound(newPlanId);
        if (!plans[newPlanId].isEnabled) revert PlanDisabled();

        uint256 interest = _fullInterestOf(dep);
        uint256 newPrincipal = dep.principal + interest;
        
        if (totalCommittedInterest > interest) {
            totalCommittedInterest = totalCommittedInterest - interest;
        } else {
            totalCommittedInterest = 0;
        }
        totalCommittedInterest += _calcInterest(newPrincipal, plans[newPlanId].aprBps, plans[newPlanId].tenorDays * 86400);
        
        newDepositId = nextDepositId++;
        uint256 newTenor = plans[newPlanId].tenorDays;

        deposits[newDepositId] = Deposit({
            owner: currentOwner,
            planId: newPlanId,
            principal: newPrincipal,
            aprBpsAtOpen: plans[newPlanId].aprBps,
            penaltyBpsAtOpen: plans[newPlanId].penaltyBps,
            openTimestamp: block.timestamp,
            maturityAt: block.timestamp + newTenor * 86400,
            status: DepositStatus.Active
        });

        dep.status = DepositStatus.ManualRenewed;
        VaultManager(vaultManager).payInterest(depositId, interest);
        _mint(currentOwner, newDepositId);
        emit Renewed(depositId, newDepositId, newPrincipal, newPlanId);
    }

    function autoRenewDeposit(uint256 depositId) external whenNotPaused nonReentrant returns (uint256 newDepositId) {
        if (depositId == 0 || depositId >= nextDepositId) revert DepositNotFound(depositId);
        
        Deposit storage dep = deposits[depositId];
        if (dep.status != DepositStatus.Active) revert DepositNotActive();
        if (block.timestamp < dep.maturityAt + GRACE_PERIOD) revert NotMatured();
        if (!plans[dep.planId].isEnabled) revert PlanDisabled();

        address currentOwner = ownerOf(depositId);
        uint256 oldTenor = dep.maturityAt - dep.openTimestamp;
        uint256 interest = _fullInterestOf(dep);
        uint256 newPrincipal = dep.principal + interest;
        
        if (totalCommittedInterest > interest) {
            totalCommittedInterest = totalCommittedInterest - interest;
        } else {
            totalCommittedInterest = 0;
        }
        totalCommittedInterest += _calcInterest(newPrincipal, dep.aprBpsAtOpen, oldTenor);
        
        dep.status = DepositStatus.AutoRenewed;

        newDepositId = nextDepositId++;

        deposits[newDepositId] = Deposit({
            owner: currentOwner,
            planId: dep.planId,
            principal: newPrincipal,
            aprBpsAtOpen: dep.aprBpsAtOpen,
            penaltyBpsAtOpen: dep.penaltyBpsAtOpen,
            openTimestamp: block.timestamp,
            maturityAt: block.timestamp + oldTenor,
            status: DepositStatus.Active
        });

        VaultManager(vaultManager).payInterest(depositId, interest);
        _mint(currentOwner, newDepositId);
        emit Renewed(depositId, newDepositId, newPrincipal, dep.planId);
    }

    function _calcInterest(uint256 principal, uint256 aprBps, uint256 tenorSeconds) internal pure returns (uint256) {
        return (principal * aprBps * tenorSeconds) / (365 * 86400 * 10000);
    }

    function _fullInterestOf(Deposit storage dep) internal view returns (uint256) {
        return _calcInterest(dep.principal, dep.aprBpsAtOpen, dep.maturityAt - dep.openTimestamp);
    }

    function _interestOf(Deposit storage dep) internal view returns (uint256) {
        uint256 end = block.timestamp < dep.maturityAt ? block.timestamp : dep.maturityAt;
        if (end <= dep.openTimestamp) return 0;
        return _calcInterest(dep.principal, dep.aprBpsAtOpen, end - dep.openTimestamp);
    }
    
    function calculateInterest(uint256 depositId) external view returns (uint256) {
        return _interestOf(deposits[depositId]);
    }

    function getActivePlans() external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 1; i < nextPlanId; i++) {
            if (plans[i].isEnabled) count++;
        }
        
        uint256[] memory result = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 1; i < nextPlanId; i++) {
            if (plans[i].isEnabled) {
                result[idx] = i;
                idx++;
            }
        }
        return result;
    }

    function getUserDeposits(address user) external view returns (uint256[] memory) {
        uint256 count = 0;
        for (uint256 i = 1; i < nextDepositId; i++) {
            if (ownerOf(i) == user) count++;
        }
        
        uint256[] memory result = new uint256[](count);
        uint256 idx = 0;
        for (uint256 i = 1; i < nextDepositId; i++) {
            if (ownerOf(i) == user) {
                result[idx] = i;
                idx++;
            }
        }
        return result;
    }

    function daysRemaining(uint256 depositId) external view returns (int256) {
        Deposit storage dep = deposits[depositId];
        return int256(dep.maturityAt) - int256(block.timestamp);
    }

    function isWithinGracePeriod(uint256 depositId) external view returns (bool) {
        Deposit storage dep = deposits[depositId];
        if (block.timestamp < dep.maturityAt) return false;
        if (block.timestamp >= dep.maturityAt + GRACE_PERIOD) return false;
        return true;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
