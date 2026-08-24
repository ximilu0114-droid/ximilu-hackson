// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title InboxDemo
 * @notice Sepolia-side receiver for the writability leg of the demo.
 *
 * The official Attestcoin Inbox (validating attestor-quorum signatures) is not
 * yet deployed; this contract implements the same validate→execute shape using
 * a single authorized relayer key as the stand-in trust root, so the flow and
 * its on-chain evidence are real while remaining honest about the difference.
 */
contract InboxDemo {
    address public authorizedRelayer;
    mapping(bytes32 => bool) public executedPayloads;
    uint256 public lastAmountReceived;
    bytes32 public lastPayloadHash;

    event MessageExecuted(bytes32 indexed payloadHash, address indexed executor, uint256 policyId, uint256 released);

    constructor(address relayer) {
        require(relayer != address(0), 'ZERO_RELAYER');
        authorizedRelayer = relayer;
    }

    function setAuthorizedRelayer(address next) external {
        require(msg.sender == authorizedRelayer, 'NOT_AUTHORIZED');
        authorizedRelayer = next;
    }

    /**
     * payload = abi.encode(policyId, sourceTxId, amount, released)
     * signature = EIP-191 signature of keccak256(payload) by the relayer.
     */
    function execute(bytes calldata payload, bytes calldata signature) external {
        bytes32 h = keccak256(payload);
        require(!executedPayloads[h], 'REPLAY');

        // stand-in for attestor quorum verification: one authorized signature
        bytes32 ethHash = keccak256(
            abi.encodePacked('\x19Ethereum Signed Message:\n32', h)
        );
        require(signature.length == 65, 'BAD_SIG');
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        address signer = ecrecover(ethHash, v, r, s);
        require(signer != address(0) && signer == authorizedRelayer, 'BAD_SIGNER');

        executedPayloads[h] = true;
        (uint256 policyId, , , uint256 released) = abi.decode(
            payload,
            (uint256, bytes32, uint256, uint256)
        );
        lastAmountReceived = released;
        lastPayloadHash = h;
        emit MessageExecuted(h, msg.sender, policyId, released);
    }
}
