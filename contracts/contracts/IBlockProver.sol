// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IBlockProver
 * @notice Mirror of the Attestcoin Protocol BlockProver precompile (0x...0FD2).
 * The precompile proves that a transaction is included in a block of a
 * confirmed source chain (Merkle + continuity proofs against attestations),
 * but it does NOT check transaction success — callers must verify the
 * receipt status themselves.
 */
interface IBlockProver {
    struct MerkleProofEntry {
        bytes32 hash;
        bool isLeft;
    }

    struct MerkleProof {
        bytes32 root;
        MerkleProofEntry[] siblings;
    }

    struct ContinuityProof {
        bytes32 lowerEndpointDigest;
        bytes32[] roots;
    }

    /// @notice Read-only verification of a single transaction proof.
    function verify(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external view returns (bool);

    /// @notice State-changing verification; reverts on invalid proof and
    /// emits TransactionVerified(chainKey, height, transactionIndex) on success.
    function verifyAndEmit(
        uint64 chainKey,
        uint64 height,
        bytes calldata encodedTransaction,
        MerkleProof calldata merkleProof,
        ContinuityProof calldata continuityProof
    ) external;
}
