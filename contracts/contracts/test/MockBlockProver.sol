// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import '../IBlockProver.sol';

/**
 * @notice Test double for the BlockProver precompile.
 * Behavior is baked into immutable runtime code (constructor arg), because in
 * tests its runtime bytecode gets copied to the canonical precompile address
 * via `hardhat_setCode` — storage does NOT survive that copy.
 */
contract MockBlockProver {
    bool public immutable RESULT;

    event TransactionVerified(uint64 indexed chainKey, uint64 indexed height, uint64 transactionIndex);

    constructor(bool initialResult) {
        RESULT = initialResult;
    }

    function verify(
        uint64,
        uint64,
        bytes calldata,
        IBlockProver.MerkleProof calldata,
        IBlockProver.ContinuityProof calldata
    ) external view returns (bool) {
        return RESULT;
    }

    function verifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata,
        IBlockProver.MerkleProof calldata,
        IBlockProver.ContinuityProof calldata
    ) external {
        require(RESULT, 'INVALID_PROOF');
        emit TransactionVerified(chainKey, height, 0);
    }
}
