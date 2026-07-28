// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RecourseEscrow
 * @dev Escrowed settlement for agent payments. Evidence bundles
 * (hash-committed) replace raw payloads — closes x402 #1645 receipts gap.
 * Arbiter role controls dispute resolution; auto-refund after TIMEOUT.
 */
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract RecourseEscrow {
    address public immutable USDC;
    address public arbiter;
    address public owner;
    uint256 public constant TIMEOUT = 14 days;

    constructor(address usdc_, address arbiter_) {
        USDC = usdc_;
        arbiter = arbiter_;
        owner = msg.sender;
    }

    enum Status { Active, Confirmed, Disputed, Resolved, Refunded }

    struct Escrow {
        address buyer;
        address seller;
        uint256 amount;
        bytes32 taskId;
        bytes32 evidenceBundleHash;
        uint256 createdAt;
        bool delivered;
        bool disputed;
        bool resolved;
        uint256 disputeRaisedAt;
        address payoutTo;
    }

    mapping(uint256 => Escrow) public escrows;
    uint256 public nextId = 1;

    event EscrowCreated(uint256 indexed id, address indexed buyer, address indexed seller,
                         uint256 amount, bytes32 taskId, bytes32 evidenceHash);
    event DeliveryConfirmed(uint256 indexed id, bytes32 evidenceHash);
    event DisputeRaised(uint256 indexed id, bytes32 disputeEvidenceHash);
    event Resolved(uint256 indexed id, bool buyerWins, address payoutTo, uint256 amount);
    event AutoRefund(uint256 indexed id);
    event ArbiterChanged(address indexed oldArbiter, address indexed newArbiter);

    modifier onlyBuyer(uint256 id) {
        require(msg.sender == escrows[id].buyer, "not buyer");
        _;
    }

    modifier onlyArbiter() {
        require(msg.sender == arbiter, "not arbiter");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function setArbiter(address newArbiter) external onlyOwner {
        require(newArbiter != address(0), "zero address");
        emit ArbiterChanged(arbiter, newArbiter);
        arbiter = newArbiter;
    }

    function statusOf(uint256 id) public view returns (Status) {
        Escrow storage e = escrows[id];
        require(e.buyer != address(0), "no escrow");
        if (e.resolved) return Status.Resolved;
        if (e.disputed) {
            if (block.timestamp - e.disputeRaisedAt > TIMEOUT) return Status.Refunded;
            return Status.Disputed;
        }
        if (e.delivered) return Status.Confirmed;
        return Status.Active;
    }

    function createEscrow(address buyer, address seller, uint256 amount,
                           bytes32 taskId, bytes32 evidenceBundleHash) public returns (uint256 id) {
        require(amount > 0, "zero amount");
        require(seller != address(0) && buyer != address(0), "zero address");
        id = nextId++;
        IERC20(USDC).transferFrom(buyer, address(this), amount);
        escrows[id] = Escrow({
            buyer: buyer, seller: seller, amount: amount, taskId: taskId,
            evidenceBundleHash: evidenceBundleHash, createdAt: block.timestamp,
            delivered: false, disputed: false, resolved: false,
            disputeRaisedAt: 0, payoutTo: address(0)
        });
        emit EscrowCreated(id, buyer, seller, amount, taskId, evidenceBundleHash);
    }

    function confirmDelivery(uint256 id, bytes32 evidenceHash) public onlyBuyer(id) {
        Escrow storage e = escrows[id];
        require(!e.disputed && !e.resolved, "disputed/resolved");
        e.delivered = true;
        e.evidenceBundleHash = evidenceHash;
        e.resolved = true;
        e.payoutTo = e.seller;
        require(IERC20(USDC).transfer(e.seller, e.amount), "transfer failed");
        emit DeliveryConfirmed(id, evidenceHash);
        emit Resolved(id, false, e.seller, e.amount);
    }

    function raiseDispute(uint256 id, bytes32 disputeEvidenceHash) public onlyBuyer(id) {
        Escrow storage e = escrows[id];
        Status s = statusOf(id);
        require(s == Status.Active || s == Status.Confirmed, "not in progress");
        e.disputed = true;
        e.disputeRaisedAt = block.timestamp;
        e.evidenceBundleHash = disputeEvidenceHash;
        emit DisputeRaised(id, disputeEvidenceHash);
    }

    function resolveDispute(uint256 id, bool buyerWins, address payoutTo) external onlyArbiter {
        Escrow storage e = escrows[id];
        require(e.disputed, "not disputed");
        require(!e.resolved, "already resolved");
        require(payoutTo == e.buyer || payoutTo == e.seller, "invalid payout");
        if (buyerWins) require(payoutTo == e.buyer, "buyerWins mismatch");
        else require(payoutTo == e.seller, "sellerWins mismatch");
        e.resolved = true;
        e.payoutTo = payoutTo;
        require(IERC20(USDC).transfer(payoutTo, e.amount), "transfer failed");
        emit Resolved(id, buyerWins, payoutTo, e.amount);
    }

    function autoRefund(uint256 id) public {
        Escrow storage e = escrows[id];
        require(e.disputed, "not disputed");
        require(!e.resolved, "already resolved");
        require(block.timestamp - e.disputeRaisedAt > TIMEOUT, "timeout not reached");
        e.resolved = true;
        e.payoutTo = e.buyer;
        require(IERC20(USDC).transfer(e.buyer, e.amount), "transfer failed");
        emit AutoRefund(id);
        emit Resolved(id, true, e.buyer, e.amount);
    }
}
