// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only USDC mock for local and Remix testing.
/// @dev Anyone can mint tokens. Never use this contract in production.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        require(to != address(0), "MockUSDC: zero address");

        _mint(to, amount);
    }
}
