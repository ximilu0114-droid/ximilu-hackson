// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import './IBlockProver.sol';

/// Minimal experiment: does verifyAndEmit work when called FROM a contract on CC3?
contract ProverForwarder {
    function forwardVerify(
        uint64 chainKey,
        uint64 height,
        bytes calldata txBytes,
        IBlockProver.MerkleProof calldata mp,
        IBlockProver.ContinuityProof calldata cp
    ) external returns (bool) {
        return IBlockProver(0x0000000000000000000000000000000000000FD2).verify(chainKey, height, txBytes, mp, cp);
    }

    function forwardVerifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata txBytes,
        IBlockProver.MerkleProof calldata mp,
        IBlockProver.ContinuityProof calldata cp
    ) external {
        IBlockProver(0x0000000000000000000000000000000000000FD2).verifyAndEmit(chainKey, height, txBytes, mp, cp);
    }
}
