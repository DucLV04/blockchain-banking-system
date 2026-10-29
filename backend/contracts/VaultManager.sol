// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "./MockUSDC.sol";

contract VaultManager is Ownable2Step, Pausable {
    address public savingCore;
    address public feeReceiver;
    MockUSDC public mockUSDC;

    event VaultFunded(address funder, uint256 amount);
    event VaultWithdrawn(address receiver, uint256 amount);
    event FeeReceiverUpdated(address oldReceiver, address newReceiver);
    event InterestPaid(uint256 depositId, uint256 amount);

    constructor(
        address _savingCore,
        address _feeReceiver,
        address _mockUSDC
    ) Ownable(msg.sender) {
        savingCore = _savingCore;
        feeReceiver = _feeReceiver;
        mockUSDC = MockUSDC(_mockUSDC);
    }

    function depositWithUSDC(uint256 amount) external whenNotPaused {
        require(amount > 0, "Invalid amount");
        mockUSDC.transferFrom(msg.sender, address(this), amount);
        emit VaultFunded(msg.sender, amount);
    }

    function withdrawToSavingCore(uint256 amount) external onlyOwner whenNotPaused {
        require(mockUSDC.balanceOf(address(this)) >= amount, "Insufficient vault balance");
        mockUSDC.transfer(savingCore, amount);
    }

    function withdrawFunds(address receiver, uint256 amount) external onlyOwner whenNotPaused {
        require(mockUSDC.balanceOf(address(this)) >= amount, "Insufficient vault balance");
        mockUSDC.transfer(receiver, amount);
        emit VaultWithdrawn(receiver, amount);
    }

    function payInterest(uint256 depositId, uint256 amount) external whenNotPaused {
        require(msg.sender == savingCore, "Unauthorized");
        require(mockUSDC.balanceOf(address(this)) >= amount, "Insufficient vault for interest");
        mockUSDC.transfer(savingCore, amount);
        emit InterestPaid(depositId, amount);
    }

    function setFeeReceiver(address newReceiver) external onlyOwner {
        require(newReceiver != address(0), "Zero address");
        emit FeeReceiverUpdated(feeReceiver, newReceiver);
        feeReceiver = newReceiver;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setSavingCore(address _core) external onlyOwner {
        require(_core != address(0), "Zero address");
        savingCore = _core;
    }

    function setUSDC(address _usdc) external onlyOwner {
        require(_usdc != address(0), "Zero address");
        mockUSDC = MockUSDC(_usdc);
    }
}
