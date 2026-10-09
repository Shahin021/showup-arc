// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @notice Test-only smart contract wallet (like a Circle SCA wallet): it
/// executes calls for its owner and validates signatures with ERC-1271.
/// @dev Never use this contract in production.
contract MockERC1271Wallet is IERC1271 {
    address public immutable owner;

    error NotOwner();
    error CallFailed(bytes reason);

    constructor(address owner_) {
        owner = owner_;
    }

    function execute(address target, bytes calldata data)
        external
        returns (bytes memory result)
    {
        if (msg.sender != owner) {
            revert NotOwner();
        }
        bool success;
        (success, result) = target.call(data);
        if (!success) {
            revert CallFailed(result);
        }
    }

    function isValidSignature(bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4)
    {
        (address recovered, ECDSA.RecoverError error, ) =
            ECDSA.tryRecover(hash, signature);
        if (error == ECDSA.RecoverError.NoError && recovered == owner) {
            return IERC1271.isValidSignature.selector;
        }
        return 0xffffffff;
    }
}
