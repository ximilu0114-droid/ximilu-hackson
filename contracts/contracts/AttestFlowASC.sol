// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import './IBlockProver.sol';

/**
 * @title AttestFlowASC
 * @notice Attestcoin Smart Contract (ASC): cross-chain payment settlement.
 *
 * A policy watches a source-chain (e.g. Ethereum Sepolia) payee address.
 * When a verified source transaction pays that payee at least `minAmount`
 * (native currency or ERC-20 `transfer`), the contract:
 *   1. verifies the inclusion proof via the BlockProver precompile,
 *   2. decodes the attested transaction bytes,
 *   3. enforces success status, replay protection and policy match,
 *   4. records an on-chain receipt and releases escrowed native CTC
 *      to the policy beneficiary at the configured rate.
 *
 * SECURITY NOTE: the precompile only proves *inclusion*, not success.
 * `receiptStatus == 1` is enforced here from the attested receipt bytes.
 */
contract AttestFlowASC {
    // Canonical Attestcoin Protocol BlockProver precompile on Creditcoin CC3.
    IBlockProver public constant BLOCK_PROVER =
        IBlockProver(0x0000000000000000000000000000000000000FD2);

    // ---------------------------------------------------------------- //
    //                              Types                               //
    // ---------------------------------------------------------------- //

    struct Policy {
        uint64 chainKey; // source chain key on Creditcoin
        address token; // ERC20 token; address(0) = native payments
        uint8 tokenDecimals;
        address payee; // watched recipient on the source chain
        uint256 minAmount; // in token base units
        address beneficiary; // who receives escrowed CTC upon settlement
        uint64 destChainKey; // destination chain for the writability message
        address destContract; // destination Inbox/application contract
        uint256 payoutRatioE18; // CTC wei released per 1 whole token unit
        bool active;
    }

    struct TxView {
        address from;
        address to;
        bool toIsNull;
        uint256 value;
        bytes data;
        bool receiptStatus;
    }

    // ---------------------------------------------------------------- //
    //                             Storage                              //
    // ---------------------------------------------------------------- //

    address public owner;
    mapping(address => bool) public operators;

    Policy[] private _policies;
    mapping(bytes32 => uint256) public policyIdByPayee; // keccak(chainKey,payee,token) => policyId+1
    mapping(bytes32 => bool) public settledTxs; // keccak(chainKey,height,txIndex)
    mapping(uint256 => uint256) public totalSettledPerPolicy;
    mapping(address => uint256) public creditOf; // cumulative CTC released per beneficiary

    uint256 public escrowBalance;

    // ---------------------------------------------------------------- //
    //                             Events                               //
    // ---------------------------------------------------------------- //

    event PolicyCreated(uint256 indexed policyId, Policy policy);
    event PolicyActiveSet(uint256 indexed policyId, bool active);

    /// Writability step-1 semantics: published for delivery to destChainKey.
    /// When official Outbox lands on testnet this maps 1:1 to outbox.publish().
    event MessagePublished(uint64 destChainKey, address destContract, bytes payload);

    event PaymentSettled(
        uint256 indexed policyId,
        bytes32 indexed sourceTxId,
        address indexed payer,
        address token,
        uint256 amount,
        address beneficiary,
        uint256 releasedAmount,
        uint64 srcHeight,
        uint64 srcTxIndex
    );
    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    // ---------------------------------------------------------------- //
    //                          Access control                          //
    // ---------------------------------------------------------------- //

    constructor() {
        owner = msg.sender;
        operators[msg.sender] = true;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, 'NOT_OWNER');
        _;
    }

    modifier onlyOperator() {
        require(operators[msg.sender], 'NOT_OPERATOR');
        _;
    }

    function setOperator(address op, bool enabled) external onlyOwner {
        operators[op] = enabled;
    }

    function transferOwnership(address next) external onlyOwner {
        require(next != address(0), 'ZERO_OWNER');
        owner = next;
    }

    receive() external payable {
        escrowBalance += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    function withdrawEscrow(uint256 amount) external onlyOwner {
        require(amount <= escrowBalance, 'INSUFFICIENT_ESCROW');
        escrowBalance -= amount;
        (bool ok, ) = payable(owner).call{value: amount}('');
        require(ok, 'WITHDRAW_FAILED');
        emit Withdrawn(owner, amount);
    }

    // ---------------------------------------------------------------- //
    //                            Policies                              //
    // ---------------------------------------------------------------- //

    function createPolicy(
        uint64 chainKey,
        address token,
        uint8 tokenDecimals,
        address payee,
        uint256 minAmount,
        address beneficiary,
        uint64 destChainKey,
        address destContract,
        uint256 payoutRatioE18
    ) external onlyOwner returns (uint256 policyId) {
        require(payee != address(0), 'ZERO_PAYEE');
        require(beneficiary != address(0), 'ZERO_BENEFICIARY');
        require(destContract != address(0), 'ZERO_DESTINATION');
        require(tokenDecimals <= 77, 'DECIMALS_TOO_LARGE');
        require(payoutRatioE18 > 0, 'ZERO_PAYOUT_RATIO');

        bytes32 id = keccak256(abi.encodePacked(chainKey, payee, token));
        require(policyIdByPayee[id] == 0, 'POLICY_EXISTS');

        Policy memory p = Policy({
            chainKey: chainKey,
            token: token,
            tokenDecimals: tokenDecimals,
            payee: payee,
            minAmount: minAmount,
            beneficiary: beneficiary,
            destChainKey: destChainKey,
            destContract: destContract,
            payoutRatioE18: payoutRatioE18,
            active: true
        });
        _policies.push(p);
        policyId = _policies.length - 1;
        policyIdByPayee[id] = policyId + 1;
        emit PolicyCreated(policyId, p);
    }

    function setPolicyActive(uint256 policyId, bool active) external onlyOwner {
        _policies[policyId].active = active;
        emit PolicyActiveSet(policyId, active);
    }

    function getPolicy(uint256 policyId) external view returns (Policy memory) {
        return _policies[policyId];
    }

    function policyCount() external view returns (uint256) {
        return _policies.length;
    }

    function findPolicy(
        uint64 chainKey,
        address payee,
        address token
    ) external view returns (int256) {
        bytes32 id = keccak256(abi.encodePacked(chainKey, payee, token));
        uint256 slot = policyIdByPayee[id];
        if (slot == 0) return -1;
        return int256(slot - 1);
    }

    // ---------------------------------------------------------------- //
    //                          Settlement                              //
    // ---------------------------------------------------------------- //

    /**
     * @notice Verify a source-chain payment proof and settle the matching policy.
     * @param policyId Target policy.
     * @param chainKey Source chain key (must equal policy.chainKey).
     * @param height Source block height of the payment tx.
     * @param txIndex Index of the payment tx within its block.
     */
    function settle(
        uint256 policyId,
        uint64 chainKey,
        uint64 height,
        uint64 txIndex,
        bytes calldata encodedTransaction,
        IBlockProver.MerkleProof calldata merkleProof,
        IBlockProver.ContinuityProof calldata continuityProof
    ) external onlyOperator {
        Policy storage p = _policies[policyId];
        require(p.active, 'POLICY_INACTIVE');
        require(chainKey == p.chainKey, 'CHAIN_MISMATCH');

        // 1) Cryptographic verification against attestations.
        // NOTE: we use the read-only verify() rather than verifyAndEmit():
        // on CC3 testnet state-changing precompile calls from contract context
        // revert, while verify() works identically for our purposes (the ASC
        // emits its own settlement events; no dependency on precompile events).
        bool verified = BLOCK_PROVER.verify(
            chainKey,
            height,
            encodedTransaction,
            merkleProof,
            continuityProof
        );
        require(verified, 'PROOF_INVALID');

        // `verify()` does not accept txIndex. Bind the operator-provided value
        // to the verified Merkle path so the same proof cannot be replayed by
        // changing txIndex and therefore changing the replay-protection key.
        uint64 proofTxIndex = BLOCK_PROVER.calculateTxIndex(merkleProof);
        require(proofTxIndex == txIndex, 'TX_INDEX_MISMATCH');

        // 2) Replay protection — each source tx settles exactly once.
        bytes32 sourceTxId = keccak256(
            abi.encodePacked(chainKey, height, proofTxIndex)
        );
        require(!settledTxs[sourceTxId], 'ALREADY_SETTLED');
        settledTxs[sourceTxId] = true;

        // 3) Decode the ATTESTED transaction bytes (layout defined by the
        //    protocol encoding v1: (uint8 txType, bytes[] chunks); chunk[0]
        //    carries common fields for every type; the LAST chunk carries
        //    the receipt incl. status).
        TxView memory tv = _decodeTx(encodedTransaction);

        // 4) The precompile does NOT check success — we must:
        require(tv.receiptStatus, 'SOURCE_TX_FAILED');

        // 5) Policy match + amount.
        (bool matched, uint256 amount) = _matchPolicy(tv, p);
        require(matched, 'POLICY_NOT_MATCHED');
        require(amount >= p.minAmount, 'AMOUNT_TOO_LOW');

        // 6) Release escrowed CTC at the configured ratio.
        uint256 released = (amount * p.payoutRatioE18) / (10 ** p.tokenDecimals);
        require(released > 0, 'RELEASE_ZERO');
        require(released <= escrowBalance, 'INSUFFICIENT_ESCROW');
        escrowBalance -= released;
        creditOf[p.beneficiary] += released;
        (bool sent, ) = payable(p.beneficiary).call{value: released}('');
        require(sent, 'RELEASE_FAILED');

        totalSettledPerPolicy[policyId] += 1;
        emit PaymentSettled(
            policyId,
            sourceTxId,
            tv.from,
            p.token,
            amount,
            p.beneficiary,
            released,
            height,
            proofTxIndex
        );

        // Writability step 1: publish settlement result for the destination
        // chain relayer network (payload consumed by the beneficiary-side app).
        emit MessagePublished(
            p.destChainKey,
            p.destContract,
            abi.encode(policyId, sourceTxId, amount, released)
        );
    }

    // ---------------------------------------------------------------- //
    //                          Decoding                                //
    // ---------------------------------------------------------------- //

    /// @notice Debug/introspection: decode protocol-encoded source tx bytes
    /// without verification. Used by tests, the agent and the dashboard.
    function previewTx(
        bytes memory txBytes
    ) external pure returns (TxView memory tv) {
        tv = _decodeTx(txBytes);
    }

    /// @notice Step-by-step introspection of _matchPolicy for debugging.
    function debugMatch(
        bytes memory txBytes,
        uint256 policyId
    )
        external
        view
        returns (
            bool toIsNull_,
            bool tokenIsZero,
            bool toEqToken,
            uint256 dataLen,
            bytes4 selector_,
            address recipient,
            uint256 amt,
            bool recEqPayee
        )
    {
        Policy storage p = _policies[policyId];
        TxView memory tv = _decodeTx(txBytes);
        toIsNull_ = tv.toIsNull;
        tokenIsZero = p.token == address(0);
        toEqToken = tv.to == p.token;
        dataLen = tv.data.length;
        selector_ = dataLen >= 4 ? _readSelector(tv.data) : bytes4(0);
        recipient = dataLen >= 36 ? _readAddress(tv.data, 4) : address(0);
        amt = dataLen >= 68 ? _readUint(tv.data, 36) : 0;
        recEqPayee = recipient == p.payee;
    }

    struct Log {
        address addr;
        bytes32[] topics;
        bytes data;
    }

    function _decodeTx(bytes memory txBytes) internal pure returns (TxView memory tv) {
        (, bytes[] memory chunks) = abi.decode(txBytes, (uint8, bytes[]));
        require(chunks.length >= 3, 'BAD_ENCODING');

        // chunk[0]: nonce, gasLimit, from, toIsNull, to, value, data
        (
            ,
            ,
            address from,
            bool toIsNull,
            address to,
            uint256 value,
            bytes memory data
        ) = abi.decode(
                chunks[0],
                (uint64, uint64, address, bool, address, uint256, bytes)
            );

        // last chunk (identical layout for every tx type): receiptStatus, gasUsed, logs[], logsBloom
        bytes memory lastChunk = chunks[chunks.length - 1];
        (uint8 status, , , ) = abi.decode(lastChunk, (uint8, uint64, Log[], bytes));

        tv = TxView({
            from: from,
            to: to,
            toIsNull: toIsNull,
            value: value,
            data: data,
            receiptStatus: status == 1
        });
    }

    function _matchPolicy(
        TxView memory tv,
        Policy storage p
    ) internal view returns (bool matched, uint256 amount) {
        if (tv.toIsNull) return (false, 0);

        if (p.token == address(0)) {
            // Native payment: recipient + value
            if (tv.to == p.payee && tv.value > 0) return (true, tv.value);
            return (false, 0);
        }

        // ERC20 paths against the token contract:
        //   transfer(address,uint256)     selector 0xa9059cbb, len 68
        //   transferFrom(address,address,uint256) selector 0x23b872dd, len 100
        if (tv.to != p.token) return (false, 0);

        if (tv.data.length == 68 && _readSelector(tv.data) == 0xa9059cbb) {
            address recipient = _readAddress(tv.data, 4);
            uint256 amt = _readUint(tv.data, 36);
            if (recipient == p.payee && amt > 0) return (true, amt);
        }

        if (
            tv.data.length == 100 &&
            _readSelector(tv.data) == 0x23b872dd
        ) {
            address recipient = _readAddress(tv.data, 36);
            uint256 amt = _readUint(tv.data, 68);
            if (recipient == p.payee && amt > 0) return (true, amt);
        }

        return (false, 0);
    }

    /// @dev Big-endian 32-byte word reader — pure Solidity, no assembly
    ///      (inline-asm proved unreliable under the viaIR pipeline).
    function _readUint(bytes memory d, uint256 off) internal pure returns (uint256 v) {
        require(d.length >= off + 32, 'READ_OOB');
        for (uint256 i = 0; i < 32; ++i) {
            v = (v << 8) | uint256(uint8(d[off + i]));
        }
    }

    function _readAddress(bytes memory d, uint256 off) internal pure returns (address) {
        return address(uint160(_readUint(d, off)));
    }

    function _readSelector(bytes memory d) internal pure returns (bytes4) {
        require(d.length >= 4, 'READ_OOB');
        return bytes4(uint32(_readUint(d, 0) >> 224));
    }
}
