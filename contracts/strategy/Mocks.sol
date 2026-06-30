// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Minimal ERC-20 with a public mint for tests.
contract MockERC20 is ERC20 {
    constructor(string memory name, string memory symbol) ERC20(name, symbol) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Simulates Aave v2 LendingPool: holds tokens on deposit, returns them on withdraw.
contract MockLendingPool {
    // Track deposited amounts per (token, onBehalfOf).
    mapping(address => mapping(address => uint256)) public deposited;

    function deposit(
        address asset,
        uint256 amount,
        address onBehalfOf,
        uint16 /*referralCode*/
    ) external {
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        deposited[asset][onBehalfOf] += amount;
    }

    function withdraw(
        address asset,
        uint256 amount,
        address to
    ) external returns (uint256) {
        deposited[asset][msg.sender] -= amount;
        IERC20(asset).transfer(to, amount);
        return amount;
    }
}

/// @dev Simulates Compound cToken: 1:1 exchange rate for simplicity.
contract MockCToken {
    address public underlying;
    mapping(address => uint256) public balanceOf;
    uint256 public exchangeRateStored = 1e18;

    constructor(address _underlying) {
        underlying = _underlying;
    }

    /// @dev mint() returns 0 on success (Compound convention).
    function mint(uint256 mintAmount) external returns (uint256) {
        IERC20(underlying).transferFrom(msg.sender, address(this), mintAmount);
        balanceOf[msg.sender] += mintAmount;
        return 0;
    }

    /// @dev redeem() returns 0 on success.
    function redeem(uint256 redeemTokens) external returns (uint256) {
        require(balanceOf[msg.sender] >= redeemTokens, "MockCToken: insufficient");
        balanceOf[msg.sender] -= redeemTokens;
        IERC20(underlying).transfer(msg.sender, redeemTokens);
        return 0;
    }

    /// @dev exchangeRateCurrent() accrues interest — no-op in mock.
    function exchangeRateCurrent() external returns (uint256) {
        return exchangeRateStored;
    }
}
