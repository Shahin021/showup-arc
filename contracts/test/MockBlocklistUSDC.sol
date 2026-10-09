// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only USDC mock that reproduces USDC's blocklist: transfers
/// to or from a blocked address revert, as they do on Arc.
/// @dev Anyone can mint and block. Never use this contract in production.
contract MockBlocklistUSDC is ERC20 {
    mapping(address => bool) public blocked;

    error AccountBlocked(address account);

    constructor() ERC20("Mock Blocklist USDC", "mbUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address account, bool value) external {
        blocked[account] = value;
    }

    function _update(
        address from,
        address to,
        uint256 value
    ) internal override {
        if (blocked[from]) {
            revert AccountBlocked(from);
        }
        if (blocked[to]) {
            revert AccountBlocked(to);
        }
        super._update(from, to, value);
    }
}
