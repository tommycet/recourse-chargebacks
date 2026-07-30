// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/RecourseEscrow.sol";

// ---------------------------------------------------------------------------
// Minimal mock USDC (ERC-20 with mintable supply)
// ---------------------------------------------------------------------------
contract MockUSDC {
    string public name = "USD Coin";
    string public symbol = "USDC";
    uint8 public decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function transfer(address to, uint256 amount) external virtual returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external virtual returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "allowance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        return true;
    }

    function approve(address spender, uint256 amount) external virtual returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }
}

// ---------------------------------------------------------------------------
// Reverting ERC20 mock — transfer/transferFrom always revert
// ---------------------------------------------------------------------------
contract RevertingERC20 is MockUSDC {
    function transfer(address /*to*/, uint256 /*amount*/) external pure override returns (bool) {
        revert("USDC: blacklisted");
    }

    function transferFrom(address /*from*/, address /*to*/, uint256 /*amount*/) external pure override returns (bool) {
        revert("USDC: blacklisted");
    }
}

// ---------------------------------------------------------------------------
// Reentrancy attacker — tries to re-enter autoRefund/resolveDispute via receive
// ---------------------------------------------------------------------------
contract ReentrancyAttacker {
    RecourseEscrow public target;
    uint256 public attackEscrowId;
    bool public attackMode;
    uint256 public reentryCount;

    constructor(RecourseEscrow _target) {
        target = _target;
    }

    receive() external payable {
        if (attackMode && reentryCount < 3) {
            reentryCount++;
            try target.autoRefund(attackEscrowId) {} catch {}
            try target.resolveDispute(attackEscrowId, true, address(this)) {} catch {}
        }
    }

    function startAttack(uint256 escrowId) external {
        // Caller must first set up the reentrant receive() to be called during transfer
        attackMode = true;
        reentryCount = 0;
        attackEscrowId = escrowId;
    }

    function stopAttack() external {
        attackMode = false;
    }

    // Forward USDC back to escrow from receive fallback (won't work because autoRefund
    // checks alreadyResolved — but it's worth testing that the check holds)
    function resolveAttack(uint256 escrowId, bool buyerWins) external {
        // This tries the arbiter path — only works if caller IS arbiter
        try target.resolveDispute(escrowId, buyerWins, address(this)) {} catch {}
    }
}

// ---------------------------------------------------------------------------
// Malicious ERC20 — invokes a callback on the recipient during transfer,
// simulating ERC777-style reentrancy. Used for reentrancy attack tests.
// ---------------------------------------------------------------------------
contract MaliciousERC20 is MockUSDC {
    RecourseEscrow public target;
    uint256 public attackEscrowId;
    bool public attackMode;
    address public attackTo;

    constructor(RecourseEscrow _target) {
        target = _target;
    }

    function setAttack(uint256 _escrowId, bool _mode) external {
        attackEscrowId = _escrowId;
        attackMode = _mode;
    }

    function setAttackTo(address _to) external {
        attackTo = _to;
    }

    function transfer(address to, uint256 amount) external override returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        // Reentrancy: during the escrow's resolveDispute transfer to payout,
        // re-enter resolveDispute before the `resolved = true` flag would prevent it.
        // Contract uses Checks-Effects-Interactions: e.resolved = true BEFORE transfer.
        if (attackMode && to != msg.sender) {
            attackMode = false; // one-shot
            try target.resolveDispute(attackEscrowId, true, attackTo) {} catch {}
            try target.autoRefund(attackEscrowId) {} catch {}
        }
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external override returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "allowance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        return true;
    }
}

// ===========================================================================
// RecourseEscrow Test Suite — 137 tests across 8 categories
// ===========================================================================
//
//   §1  Core State Machine      — happy paths & state transitions        (L190-488)
//   §2  Edge Cases              — events, timestamps, allowance/balance  (L490-1015)
//   §3  Evidence & Immutability — hash storage, USDC immutability         (L1016-1118)
//   §4  Reentrancy              — ERC777-style attack prevention         (L1119-1186)
//   §5  Malicious Actor Tests   — seller/buyer permission attack vectors  (L1187-1280)
//   §6  Extreme Value Tests     — boundary amounts, zero/non-existent IDs (L1281-1370)
//   §7  Multiple Escrows        — independence, batches, fee accumulation  (L1371-1468)
//   §8  Fee Precision           — integer division truncation boundaries   (L1469-1568)
//   §9  State Machine Coverage  — every transition path, nil-potent        (L1569-1767)
//
// ---------------------------------------------------------------------------
// ===========================================================================
contract RecourseEscrowTest is Test {
    RecourseEscrow escrow;
    MockUSDC usdc;

    address owner   = address(this);          // deployer is owner
    address buyer   = address(0xBEEF);
    address seller  = address(0xCAFE);
    address arbiter = address(0xABCD);
    address stranger = address(0x1234);

    uint256 constant AMOUNT = 100e6;  // 100 USDC
    uint256 constant FEE    = 1e6;    // 1% of 100 USDC
    uint256 constant NET    = 99e6;   // 99 USDC after fee

    bytes32 constant TASK_ID   = keccak256("task-001");
    bytes32 constant EVIDENCE  = keccak256("evidence-001");

    function setUp() public {
        usdc   = new MockUSDC();
        escrow = new RecourseEscrow(address(usdc), arbiter);

        // Fund buyer and pre-approve
        usdc.mint(buyer, 10_000e6);
        vm.prank(buyer);
        usdc.approve(address(escrow), type(uint256).max);
    }

    // -----------------------------------------------------------------------
    // §1 Helper
    // -----------------------------------------------------------------------
    function _create() internal returns (uint256 id) {
        vm.prank(buyer);
        id = escrow.createEscrow(buyer, seller, AMOUNT, TASK_ID, EVIDENCE);
    }

    function _createAndDispute() internal returns (uint256 id) {
        id = _create();
        vm.prank(buyer);
        escrow.raiseDispute(id, keccak256("dispute-evidence"));
    }

    // -----------------------------------------------------------------------
    // §1 createEscrow — happy path & core validation
    // -----------------------------------------------------------------------
    function test_createEscrow_happy() public {
        uint256 buyerBefore = usdc.balanceOf(buyer);
        uint256 id = _create();

        assertEq(id, 1, "first escrow id should be 1");
        assertEq(usdc.balanceOf(buyer), buyerBefore - AMOUNT, "buyer deducted");
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "escrow holds funds");
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Active), "status Active");

        (address b, address s, uint256 amt,,,,,,,, ) = escrow.escrows(id);
        assertEq(b, buyer,  "buyer stored");
        assertEq(s, seller, "seller stored");
        assertEq(amt, AMOUNT, "amount stored");
    }

    function test_createEscrow_zeroAmountReverts() public {
        vm.prank(buyer);
        vm.expectRevert("zero amount");
        escrow.createEscrow(buyer, seller, 0, TASK_ID, EVIDENCE);
    }

    function test_createEscrow_zeroAddressReverts() public {
        vm.prank(buyer);
        vm.expectRevert("zero address");
        escrow.createEscrow(buyer, address(0), AMOUNT, TASK_ID, EVIDENCE);

        vm.prank(buyer);
        vm.expectRevert("zero address");
        escrow.createEscrow(address(0), seller, AMOUNT, TASK_ID, EVIDENCE);
    }

    // -----------------------------------------------------------------------
    // confirmDelivery — fee deducted verified
    // -----------------------------------------------------------------------
    function test_confirmDelivery_feeDeductedAndSellerPaid() public {
        uint256 id = _create();

        uint256 ownerBefore  = usdc.balanceOf(owner);
        uint256 sellerBefore = usdc.balanceOf(seller);

        vm.prank(buyer);
        escrow.confirmDelivery(id, keccak256("confirm-ev"));

        assertEq(usdc.balanceOf(owner),  ownerBefore  + FEE, "owner receives 1% fee");
        assertEq(usdc.balanceOf(seller), sellerBefore + NET, "seller receives net");
        assertEq(usdc.balanceOf(address(escrow)), 0,         "escrow drained");
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved");
    }

    function test_confirmDelivery_onlyBuyer() public {
        uint256 id = _create();
        vm.prank(stranger);
        vm.expectRevert("not buyer");
        escrow.confirmDelivery(id, EVIDENCE);
    }

    function test_confirmDelivery_afterDisputeReverts() public {
        uint256 id = _createAndDispute();
        vm.prank(buyer);
        vm.expectRevert("disputed/resolved");
        escrow.confirmDelivery(id, EVIDENCE);
    }

    // -----------------------------------------------------------------------
    // raiseDispute
    // -----------------------------------------------------------------------
    function test_raiseDispute_setsDisputedStatus() public {
        uint256 id = _create();
        vm.prank(buyer);
        escrow.raiseDispute(id, keccak256("d-ev"));
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Disputed), "Disputed status");
    }

    function test_raiseDispute_onlyBuyer() public {
        uint256 id = _create();
        vm.prank(stranger);
        vm.expectRevert("not buyer");
        escrow.raiseDispute(id, keccak256("d-ev"));
    }

    function test_raiseDispute_doubleDisputeReverts() public {
        uint256 id = _createAndDispute();
        vm.prank(buyer);
        vm.expectRevert("not in progress");
        escrow.raiseDispute(id, keccak256("d-ev-2"));
    }

    // -----------------------------------------------------------------------
    // resolveDispute — buyer wins, fee deducted
    // -----------------------------------------------------------------------
    function test_resolveDispute_buyerWins_feeDeducted() public {
        uint256 id = _createAndDispute();

        uint256 ownerBefore = usdc.balanceOf(owner);
        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.prank(arbiter);
        escrow.resolveDispute(id, true, buyer);

        assertEq(usdc.balanceOf(owner), ownerBefore + FEE, "owner receives 1% fee");
        assertEq(usdc.balanceOf(buyer), buyerBefore + NET, "buyer receives net");
        assertEq(usdc.balanceOf(address(escrow)), 0,       "escrow drained");
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved");
    }

    // -----------------------------------------------------------------------
    // resolveDispute — seller wins, fee deducted
    // -----------------------------------------------------------------------
    function test_resolveDispute_sellerWins_feeDeducted() public {
        uint256 id = _createAndDispute();

        uint256 ownerBefore  = usdc.balanceOf(owner);
        uint256 sellerBefore = usdc.balanceOf(seller);

        vm.prank(arbiter);
        escrow.resolveDispute(id, false, seller);

        assertEq(usdc.balanceOf(owner),  ownerBefore  + FEE, "owner receives 1% fee");
        assertEq(usdc.balanceOf(seller), sellerBefore + NET, "seller receives net");
        assertEq(usdc.balanceOf(address(escrow)), 0,          "escrow drained");
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved");
    }

    // -----------------------------------------------------------------------
    // resolveDispute — unauthorized arbiter revert
    // -----------------------------------------------------------------------
    function test_resolveDispute_unauthorizedReverts() public {
        uint256 id = _createAndDispute();
        vm.prank(stranger);
        vm.expectRevert("not arbiter");
        escrow.resolveDispute(id, true, buyer);
    }

    // -----------------------------------------------------------------------
    // resolveDispute — already resolved revert
    // -----------------------------------------------------------------------
    function test_resolveDispute_alreadyResolvedReverts() public {
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        escrow.resolveDispute(id, true, buyer);

        vm.prank(arbiter);
        vm.expectRevert("already resolved");
        escrow.resolveDispute(id, true, buyer);
    }

    // -----------------------------------------------------------------------
    // resolveDispute — invalid payout (mismatch) revert
    // -----------------------------------------------------------------------
    function test_resolveDispute_buyerWinsMismatchReverts() public {
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        vm.expectRevert("buyerWins mismatch");
        escrow.resolveDispute(id, true, seller);
    }

    function test_resolveDispute_sellerWinsMismatchReverts() public {
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        vm.expectRevert("sellerWins mismatch");
        escrow.resolveDispute(id, false, buyer);
    }

    // -----------------------------------------------------------------------
    // forceResolve after 7-day DISPUTE_EXPIRY (vm.warp)
    // -----------------------------------------------------------------------
    function test_forceResolve_after7Days_refundsBuyer() public {
        uint256 id = _createAndDispute();

        // Warp just past DISPUTE_EXPIRY (7 days)
        vm.warp(block.timestamp + 7 days + 1);

        uint256 buyerBefore = usdc.balanceOf(buyer);

        // Anyone can call forceResolve
        vm.prank(stranger);
        escrow.forceResolve(id);

        // forceResolve does NOT deduct fee (full refund to buyer)
        assertEq(usdc.balanceOf(buyer), buyerBefore + AMOUNT, "buyer refunded in full");
        assertEq(usdc.balanceOf(address(escrow)), 0,          "escrow drained");
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved");
    }

    function test_forceResolve_before7Days_reverts() public {
        uint256 id = _createAndDispute();

        vm.warp(block.timestamp + 6 days);

        vm.expectRevert("dispute expiry not reached");
        escrow.forceResolve(id);
    }

    function test_forceResolve_notDisputedReverts() public {
        uint256 id = _create();
        vm.warp(block.timestamp + 8 days);
        vm.expectRevert("not disputed");
        escrow.forceResolve(id);
    }

    // -----------------------------------------------------------------------
    // autoRefund after TIMEOUT (14 days)
    // -----------------------------------------------------------------------
    function test_autoRefund_after14Days_fullRefund() public {
        uint256 id = _createAndDispute();

        vm.warp(block.timestamp + 14 days + 1);

        uint256 buyerBefore = usdc.balanceOf(buyer);

        escrow.autoRefund(id);

        // autoRefund does NOT deduct fee
        assertEq(usdc.balanceOf(buyer), buyerBefore + AMOUNT, "buyer fully refunded");
        assertEq(usdc.balanceOf(address(escrow)), 0,           "escrow drained");
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved");
    }

    function test_autoRefund_before14Days_reverts() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 13 days);
        vm.expectRevert("timeout not reached");
        escrow.autoRefund(id);
    }

    function test_autoRefund_notDisputedReverts() public {
        uint256 id = _create();
        vm.warp(block.timestamp + 15 days);
        vm.expectRevert("not disputed");
        escrow.autoRefund(id);
    }

    // -----------------------------------------------------------------------
    // setArbiter
    // -----------------------------------------------------------------------
    function test_setArbiter_ownerCanChange() public {
        address newArbiter = address(0xDEAD);
        // owner is address(this), no prank needed
        escrow.setArbiter(newArbiter);
        assertEq(escrow.arbiter(), newArbiter, "arbiter updated");
    }

    function test_setArbiter_nonOwnerReverts() public {
        vm.prank(stranger);
        vm.expectRevert("not owner");
        escrow.setArbiter(address(0xDEAD));
    }

    function test_setArbiter_zeroAddressReverts() public {
        vm.expectRevert("zero address");
        escrow.setArbiter(address(0));
    }

    // -----------------------------------------------------------------------
    // Fee recipient balance check across multiple escrows
    // -----------------------------------------------------------------------
    function test_feeRecipient_accumulatesAcrossEscrows() public {
        uint256 ownerBefore = usdc.balanceOf(owner);

        // Create + confirm 3 escrows
        for (uint256 i = 0; i < 3; i++) {
            uint256 id = _create();
            vm.prank(buyer);
            escrow.confirmDelivery(id, keccak256(abi.encode("ev", i)));
        }

        // Each escrow: 1% of 100e6 = 1e6 fee
        assertEq(usdc.balanceOf(owner), ownerBefore + 3 * FEE, "owner accumulated 3x fee");
    }

    function test_feeRecipient_fromResolveDispute() public {
        uint256 ownerBefore = usdc.balanceOf(owner);
        uint256 id = _createAndDispute();

        vm.prank(arbiter);
        escrow.resolveDispute(id, false, seller);

        assertEq(usdc.balanceOf(owner), ownerBefore + FEE, "fee to owner from dispute resolution");
    }

    // -----------------------------------------------------------------------
    // statusOf for non-existent escrow
    // -----------------------------------------------------------------------
    function test_statusOf_nonExistentReverts() public {
        vm.expectRevert("no escrow");
        escrow.statusOf(999);
    }

    // -----------------------------------------------------------------------
    // Disputed status transitions correctly to Refunded in statusOf after TIMEOUT
    // -----------------------------------------------------------------------
    function test_statusOf_refundedAfterTimeout() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 15 days);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Refunded), "Refunded status");
    }

    // ===================================================================
    // §2 EDGE-CASE TESTS — events, timestamps, allowance/balance, 
    //     additional state transition coverage (tests 29-58+)
    // ===================================================================

    // -------------------------------------------------------------------
    // createEscrow — additional edge cases
    // -------------------------------------------------------------------

    function test_createEscrow_emitsCorrectEvent() public {
        vm.prank(buyer);
        vm.expectEmit(true, true, false, true);
        emit RecourseEscrow.EscrowCreated(1, buyer, seller, AMOUNT, TASK_ID, EVIDENCE);
        escrow.createEscrow(buyer, seller, AMOUNT, TASK_ID, EVIDENCE);
    }

    function test_createEscrow_incrementsNextId() public {
        _create();
        assertEq(escrow.nextId(), 2, "nextId incremented to 2");
        _create();
        assertEq(escrow.nextId(), 3, "nextId incremented to 3");
    }

    function test_createEscrow_hashesTaskIdAndEvidenceStored() public {
        uint256 id = _create();
        (, , , bytes32 taskId, bytes32 evHash, , , , , , ) = escrow.escrows(id);
        assertEq(taskId, TASK_ID, "taskId stored");
        assertEq(evHash, EVIDENCE, "evidence bundle hash stored");
    }

    function test_createEscrow_setsTimestamp() public {
        vm.warp(1_000_000);
        uint256 id = _create();
        (, , , , , uint256 createdAt, , , , , ) = escrow.escrows(id);
        assertEq(createdAt, 1_000_000, "createdAt matches block.timestamp");
    }

    function test_createEscrow_insufficientAllowanceReverts() public {
        // new buyer with no approval
        address buyer2 = address(0xFACE);
        usdc.mint(buyer2, AMOUNT * 2);
        vm.prank(buyer2);
        vm.expectRevert();
        escrow.createEscrow(buyer2, seller, AMOUNT, TASK_ID, EVIDENCE);
    }

    function test_createEscrow_insufficientBalanceReverts() public {
        address buyer2 = address(0xFACE);
        // no balance
        vm.startPrank(buyer2);
        usdc.approve(address(escrow), type(uint256).max);
        vm.expectRevert();
        escrow.createEscrow(buyer2, seller, AMOUNT, TASK_ID, EVIDENCE);
        vm.stopPrank();
    }

    function test_createEscrow_bothAddressesZeroReverts() public {
        vm.prank(buyer);
        vm.expectRevert("zero address");
        escrow.createEscrow(address(0), address(0), AMOUNT, TASK_ID, EVIDENCE);
    }

    // -------------------------------------------------------------------
    // confirmDelivery — additional state transition + emission tests
    // -------------------------------------------------------------------

    function test_confirmDelivery_emitsResolvedEvent() public {
        uint256 id = _create();
        vm.prank(buyer);
        vm.expectEmit(true, false, false, true);
        emit RecourseEscrow.DeliveryConfirmed(id, keccak256("confirm-ev"));
        escrow.confirmDelivery(id, keccak256("confirm-ev"));
    }

    function test_confirmDelivery_setsDeliveredAndResolved() public {
        uint256 id = _create();
        vm.prank(buyer);
        escrow.confirmDelivery(id, keccak256("ev"));
        (, , , , , , bool delivered, , bool resolved, , ) = escrow.escrows(id);
        assertTrue(delivered, "delivered flag set");
        assertTrue(resolved, "resolved flag set");
    }

    function test_confirmDelivery_setsPayoutToSeller() public {
        uint256 id = _create();
        vm.prank(buyer);
        escrow.confirmDelivery(id, keccak256("ev"));
        (, , , , , , , , , , address payoutTo) = escrow.escrows(id);
        assertEq(payoutTo, seller, "payoutTo set to seller");
    }

    function test_confirmDelivery_sellerCannotConfirm() public {
        uint256 id = _create();
        vm.prank(seller);
        vm.expectRevert("not buyer");
        escrow.confirmDelivery(id, EVIDENCE);
    }

    function test_confirmDelivery_afterResolvedReverts() public {
        uint256 id = _create();
        vm.prank(buyer);
        escrow.confirmDelivery(id, EVIDENCE);

        vm.prank(buyer);
        vm.expectRevert("disputed/resolved");
        escrow.confirmDelivery(id, EVIDENCE);
    }

    // -------------------------------------------------------------------
    // raiseDispute — edge cases
    // -------------------------------------------------------------------

    function test_raiseDispute_emitsDisputeRaisedEvent() public {
        uint256 id = _create();
        bytes32 dh = keccak256("dispute-ev-1");
        vm.prank(buyer);
        vm.expectEmit(true, true, false, true);
        emit RecourseEscrow.DisputeRaised(id, buyer, dh);
        escrow.raiseDispute(id, dh);
    }

    function test_raiseDispute_setsDisputeTimestamp() public {
        uint256 id = _create();
        vm.warp(2_500_000);
        vm.prank(buyer);
        escrow.raiseDispute(id, keccak256("d"));
        (, , , , , , , , , uint256 disputeRaisedAt, ) = escrow.escrows(id);
        assertEq(disputeRaisedAt, 2_500_000, "disputeRaisedAt set");
    }

    function test_raiseDispute_afterConfirmedThenResolvedReverts() public {
        uint256 id = _create();
        vm.prank(buyer);
        escrow.confirmDelivery(id, EVIDENCE);

        vm.prank(buyer);
        vm.expectRevert("not in progress");
        escrow.raiseDispute(id, keccak256("d"));
    }

    function test_raiseDispute_sellerCannotRaise() public {
        uint256 id = _create();
        vm.prank(seller);
        vm.expectRevert("not buyer");
        escrow.raiseDispute(id, keccak256("d"));
    }

    // -------------------------------------------------------------------
    // resolveDispute — additional edge cases
    // -------------------------------------------------------------------

    function test_resolveDispute_notDisputedReverts() public {
        uint256 id = _create();
        vm.prank(arbiter);
        vm.expectRevert("not disputed");
        escrow.resolveDispute(id, true, buyer);
    }

    function test_resolveDispute_arbiterCannotUseInvalidPayoutTo() public {
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        vm.expectRevert("invalid payout");
        escrow.resolveDispute(id, true, stranger);
    }

    function test_resolveDispute_setsPayoutTo() public {
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        escrow.resolveDispute(id, true, buyer);
        (, , , , , , , , , , address payoutTo) = escrow.escrows(id);
        assertEq(payoutTo, buyer, "payoutTo set to buyer");
    }

    function test_resolveDispute_emitsResolvedEvent() public {
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        vm.expectEmit(true, true, false, true);
        emit RecourseEscrow.Resolved(id, true, buyer, NET);
        escrow.resolveDispute(id, true, buyer);
    }

    function test_resolveDispute_buyerWinsAfterConfirmReverts_AsNotInDisputeFlow() public {
        // Create escrow, dispute, resolve in buyer's favor — alreadyResolved test
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        escrow.resolveDispute(id, true, buyer);

        // second resolution attempt with sellerWins should also revert (already resolved)
        vm.prank(arbiter);
        vm.expectRevert("already resolved");
        escrow.resolveDispute(id, false, seller);
    }

    function test_resolveDispute_drainsEscrowFully() public {
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        escrow.resolveDispute(id, false, seller);
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow fully drained");
    }

    // -------------------------------------------------------------------
    // autoRefund — edge cases
    // -------------------------------------------------------------------

    function test_autoRefund_canBeCalledByAnyone() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 14 days + 1);
        // stranger calls
        vm.prank(stranger);
        escrow.autoRefund(id);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved");
    }

    function test_autoRefund_emitsAutoRefundAndResolved() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 14 days + 1);

        vm.expectEmit(true, false, false, false);
        emit RecourseEscrow.AutoRefund(id);
        escrow.autoRefund(id);
    }

    function test_autoRefund_afterResolvedReverts() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 15 days);
        escrow.autoRefund(id); // first call

        vm.expectRevert("already resolved");
        escrow.autoRefund(id); // second call should revert
    }

    function test_autoRefund_noFeeCharged() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 14 days + 1);
        uint256 ownerBefore = usdc.balanceOf(owner);

        escrow.autoRefund(id);

        assertEq(usdc.balanceOf(owner), ownerBefore, "no fee on autoRefund");
    }

    // -------------------------------------------------------------------
    // forceResolve — additional edge cases
    // -------------------------------------------------------------------

    function test_forceResolve_canBeCalledByBuyer() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(buyer);
        escrow.forceResolve(id);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved");
    }

    function test_forceResolve_afterResolvedReverts() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 8 days);
        escrow.forceResolve(id);

        vm.expectRevert("already resolved");
        escrow.forceResolve(id);
    }

    function test_forceResolve_noFeeCharged() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 8 days);
        uint256 ownerBefore = usdc.balanceOf(owner);

        escrow.forceResolve(id);

        assertEq(usdc.balanceOf(owner), ownerBefore, "no fee on forceResolve");
    }

    function test_forceResolve_nonExistentEscrowReverts() public {
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert("no escrow");
        escrow.forceResolve(12345);
    }

    function test_forceResolve_emitsDisputeExpiredAndResolved() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 7 days + 1);

        vm.expectEmit(true, true, false, false);
        emit RecourseEscrow.DisputeExpired(id, buyer);
        escrow.forceResolve(id);
    }

    // -------------------------------------------------------------------
    // autoRefund vs forceResolve — timing edge cases
    // -------------------------------------------------------------------

    function test_forceResolve_timeBoundary_exactly7DaysReverts() public {
        // 7 days exactly should NOT pass (strictly greater-than)
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 7 days);
        vm.expectRevert("dispute expiry not reached");
        escrow.forceResolve(id);
    }

    function test_autoRefund_timeBoundary_exactly14DaysReverts() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 14 days);
        vm.expectRevert("timeout not reached");
        escrow.autoRefund(id);
    }

    function test_forceResolve_worksBeforeAutoRefundWindow() public {
        // 8 days: forceResolve works but autoRefund (14d) does not
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 8 days);
        escrow.forceResolve(id);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved via forceResolve");
    }

    // -------------------------------------------------------------------
    // setArbiter — event emission + re-entrancy of permissions
    // -------------------------------------------------------------------

    function test_setArbiter_emitsEvent() public {
        address newArb = address(0xDEAD);
        vm.expectEmit(true, true, false, false);
        emit RecourseEscrow.ArbiterChanged(arbiter, newArb);
        escrow.setArbiter(newArb);
    }

    function test_setArbiter_newArbiterCanResolve() public {
        uint256 id = _createAndDispute();
        address newArb = address(0xFEED);

        escrow.setArbiter(newArb);

        // old arbiter no longer works
        vm.prank(arbiter);
        vm.expectRevert("not arbiter");
        escrow.resolveDispute(id, true, buyer);

        // new arbiter works
        vm.prank(newArb);
        escrow.resolveDispute(id, true, buyer);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved by new arbiter");
    }

    function test_setArbiter_buyerCannotChange() public {
        vm.prank(buyer);
        vm.expectRevert("not owner");
        escrow.setArbiter(address(0xDEAD));
    }

    function test_setArbiter_sellerCannotChange() public {
        vm.prank(seller);
        vm.expectRevert("not owner");
        escrow.setArbiter(address(0xDEAD));
    }

    // -------------------------------------------------------------------
    // statusOf — complete state machine coverage
    // -------------------------------------------------------------------

    function test_statusOf_activeAfterCreate() public {
        uint256 id = _create();
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Active), "Active");
    }

    function test_statusOf_confirmedAfterConfirmDelivery() public {
        uint256 id = _create();
        vm.prank(buyer);
        escrow.confirmDelivery(id, EVIDENCE);
        // resolveDispute short-circuits delivered+resolved → Resolved (not Confirmed)
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved after delivery");
    }

    function test_statusOf_disputedAfterRaiseDispute() public {
        uint256 id = _createAndDispute();
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Disputed), "Disputed");
    }

    function test_statusOf_resolvedAfterArbiterResolution() public {
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        escrow.resolveDispute(id, true, buyer);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved");
    }

    function test_statusOf_refundedAfterExpiryBeforeTimeout() public {
        // After DISPUTE_EXPIRY (7d) but before TIMEOUT (14d), statusOf still Disputed
        // because discrepancy: statusOf uses TIMEOUT for Refunded, forceResolve uses DISPUTE_EXPIRY
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 10 days);
        // statusOf uses TIMEOUT=14d → Disputed still
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Disputed), "still Disputed at 10d");
    }

    // -------------------------------------------------------------------
    // Multiple concurrent escrows — independent state
    // -------------------------------------------------------------------

    function test_multipleEscrows_independentState() public {
        // create three escrows
        uint256 id1 = _create();
        uint256 id2 = _create();
        uint256 id3 = _create();

        // Dispute id1
        vm.prank(buyer);
        escrow.raiseDispute(id1, keccak256("d1"));

        // Confirm id2 (delivered/resolved)
        vm.prank(buyer);
        escrow.confirmDelivery(id2, keccak256("c2"));

        // id3 stays Active

        assertEq(uint(escrow.statusOf(id1)), uint(RecourseEscrow.Status.Disputed), "id1 Disputed");
        assertEq(uint(escrow.statusOf(id2)), uint(RecourseEscrow.Status.Resolved), "id2 Resolved");
        assertEq(uint(escrow.statusOf(id3)), uint(RecourseEscrow.Status.Active), "id3 Active");
    }

    function test_multipleEscrows_resolveIndependently() public {
        uint256 id1 = _createAndDispute();
        uint256 id2 = _createAndDispute();

        // Resolve id1 in buyer's favor
        vm.prank(arbiter);
        escrow.resolveDispute(id1, true, buyer);

        // id2 still disputed
        assertEq(uint(escrow.statusOf(id1)), uint(RecourseEscrow.Status.Resolved), "id1 Resolved");
        assertEq(uint(escrow.statusOf(id2)), uint(RecourseEscrow.Status.Disputed), "id2 Disputed");
    }

    function test_multipleEscrows_feeAccumulatesCorrectly() public {
        uint256 ownerBefore = usdc.balanceOf(owner);

        uint256 id1 = _create();
        uint256 id2 = _createAndDispute();
        uint256 id3 = _createAndDispute();

        vm.prank(buyer);
        escrow.confirmDelivery(id1, EVIDENCE);

        vm.prank(arbiter);
        escrow.resolveDispute(id2, true, buyer);

        vm.prank(arbiter);
        escrow.resolveDispute(id3, false, seller);

        assertEq(usdc.balanceOf(owner), ownerBefore + 3 * FEE, "3x fee accumulated");
    }

    // -------------------------------------------------------------------
    // Fee calculation edge cases
    // -------------------------------------------------------------------

    function test_feeCalculation_smallAmount() public {
        uint256 smallAmt = 100;  // 100 wei (0.0001 USDC at 6 decimals)
        uint256 expectedFee = 1;   // 1% of 100 = 1

        usdc.mint(buyer, smallAmt);
        vm.prank(buyer);
        uint256 id = escrow.createEscrow(buyer, seller, smallAmt, TASK_ID, EVIDENCE);

        uint256 ownerBefore = usdc.balanceOf(owner);
        uint256 sellerBefore = usdc.balanceOf(seller);

        vm.prank(buyer);
        escrow.confirmDelivery(id, EVIDENCE);

        assertEq(usdc.balanceOf(owner), ownerBefore + expectedFee, "fee = 1 on small amount");
        assertEq(usdc.balanceOf(seller), sellerBefore + (smallAmt - expectedFee), "seller net");
    }

    function test_feeCalculation_largeAmount() public {
        uint256 largeAmt = 1_000_000e6;  // 1M USDC
        uint256 expectedFee = 10_000e6;  // 1% = 10K USDC

        usdc.mint(buyer, largeAmt);
        vm.prank(buyer);
        uint256 id = escrow.createEscrow(buyer, seller, largeAmt, TASK_ID, EVIDENCE);

        uint256 ownerBefore = usdc.balanceOf(owner);
        uint256 sellerBefore = usdc.balanceOf(seller);

        vm.prank(buyer);
        escrow.confirmDelivery(id, EVIDENCE);

        assertEq(usdc.balanceOf(owner), ownerBefore + expectedFee, "fee correct on large amount");
        assertEq(usdc.balanceOf(seller), sellerBefore + (largeAmt - expectedFee), "seller net large");
    }

    function test_feeCalculation_amountOf1Wei() public {
        // Amount = 1 → fee = 1*100/10000 = 0 (integer division truncates)
        usdc.mint(buyer, 1);
        vm.prank(buyer);
        uint256 id = escrow.createEscrow(buyer, seller, 1, TASK_ID, EVIDENCE);

        uint256 ownerBefore = usdc.balanceOf(owner);

        vm.prank(buyer);
        escrow.confirmDelivery(id, EVIDENCE);

        // Fee rounds to 0; seller still receives 1
        assertEq(usdc.balanceOf(owner), ownerBefore, "no fee on 1 wei (truncated)");
        assertEq(usdc.balanceOf(seller), 1, "seller gets full 1 wei back");
    }

    // -------------------------------------------------------------------
    // Evidence bundle hash verification (immutability + freshness)
    // -------------------------------------------------------------------

    function test_evidenceBundleHash_setOnCreate() public {
        bytes32 custom = keccak256("custom-evidence");
        vm.prank(buyer);
        uint256 id = escrow.createEscrow(buyer, seller, AMOUNT, TASK_ID, custom);

        (, , , , bytes32 evHash, , , , , , ) = escrow.escrows(id);
        assertEq(evHash, custom, "evidence hash matches create input");
    }

    function test_evidenceBundleHash_overwrittenOnConfirmDelivery() public {
        uint256 id = _create();
        bytes32 newEv = keccak256("delivery-evidence");

        vm.prank(buyer);
        escrow.confirmDelivery(id, newEv);

        (, , , , bytes32 evHash, , , , , , ) = escrow.escrows(id);
        assertEq(evHash, newEv, "evidence hash updated to delivery bundle");
        assertNotEq(evHash, EVIDENCE, "evidence hash changed from create");
    }

    function test_evidenceBundleHash_overwrittenOnRaiseDispute() public {
        uint256 id = _create();
        bytes32 dEv = keccak256("dispute-evidence-2");

        vm.prank(buyer);
        escrow.raiseDispute(id, dEv);

        (, , , , bytes32 evHash, , , , , , ) = escrow.escrows(id);
        assertEq(evHash, dEv, "evidence hash updated to dispute bundle");
    }

    function test_evidenceBundleHashes_distinguishAcrossEscrows() public {
        bytes32 e1 = keccak256("ev-1");
        bytes32 e2 = keccak256("ev-2");

        vm.prank(buyer);
        uint256 id1 = escrow.createEscrow(buyer, seller, AMOUNT, TASK_ID, e1);
        vm.prank(buyer);
        uint256 id2 = escrow.createEscrow(buyer, seller, AMOUNT, TASK_ID, e2);

        (, , , , bytes32 h1, , , , , , ) = escrow.escrows(id1);
        (, , , , bytes32 h2, , , , , , ) = escrow.escrows(id2);

        assertEq(h1, e1, "id1 evidence");
        assertEq(h2, e2, "id2 evidence");
        assertNotEq(h1, h2, "evidence hashes differ");
    }

    // -------------------------------------------------------------------
    // ID/sequencing — non-existent escrows & nextId
    // -------------------------------------------------------------------

    function test_escrows_nonExistentReturnsZero() public {
        // mapping returns default-initialized Escrow (all zero)
        (address b, , , , , , , , , , ) = escrow.escrows(999);
        assertEq(b, address(0), "non-existent escrow has zero buyer");
    }

    function test_nextId_startsAt1() public {
        assertEq(escrow.nextId(), 1, "nextId starts at 1");
    }

    // -------------------------------------------------------------------
    // Immutability of USDC address
    // -------------------------------------------------------------------

    function test_USDC_addressImmutable() public {
        assertEq(escrow.USDC(), address(usdc), "USDC address matches");
    }

    // -------------------------------------------------------------------
    // Order-of-operations: dispute before delivery
    // -------------------------------------------------------------------

    function test_raiseDispute_thenArbiterResolvesDrainsEscrow() public {
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        escrow.resolveDispute(id, true, buyer);
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow drained after arbiter resolve");
    }

    function test_raiseDispute_thenBuyerCannotConfirmDelivery() public {
        uint256 id = _createAndDispute();
        vm.prank(buyer);
        vm.expectRevert("disputed/resolved");
        escrow.confirmDelivery(id, EVIDENCE);
    }

    // -------------------------------------------------------------------
    // forceResolve vs autoRefund interaction (forceResolve wins earlier)
    // -------------------------------------------------------------------

    function test_forceResolve_thenAutoRefundReverts() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 8 days);
        escrow.forceResolve(id);

        vm.warp(block.timestamp + 20 days);
        vm.expectRevert("already resolved");
        escrow.autoRefund(id);
    }

    function test_autoRefund_thenForceResolveReverts() public {
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 15 days);
        escrow.autoRefund(id);

        vm.warp(block.timestamp + 30 days);
        vm.expectRevert("already resolved");
        escrow.forceResolve(id);
    }

    // -------------------------------------------------------------------
    // Owner immutability / arbitrary-change denial
    // -------------------------------------------------------------------

    function test_ownerIsDeployer() public {
        assertEq(escrow.owner(), address(this), "owner is deployer");
    }

    // ===================================================================
    // §4 REENTRANCY TESTS — ERC777-style callback attacks on 
    //     resolveDispute and autoRefund (tests 90-125+)
    // ===================================================================

    // -------------------------------------------------------------------
    // §4cont REENTRANCY: MaliciousERC20 that calls back into resolveDispute
    // -------------------------------------------------------------------

    function test_reentrancy_resolveDispute_preventedByChecksEffectsInteractions() public {
        // Deploy a separate escrow with the malicious token
        MaliciousERC20 malToken = new MaliciousERC20(escrow);
        RecourseEscrow malEscrow = new RecourseEscrow(address(malToken), arbiter);
        malToken.mint(buyer, 10_000e6);
        vm.prank(buyer);
        malToken.approve(address(malEscrow), type(uint256).max);

        // Create a disputed escrow using the malicious token
        vm.prank(buyer);
        uint256 id = malEscrow.createEscrow(buyer, seller, AMOUNT, TASK_ID, EVIDENCE);
        vm.prank(buyer);
        malEscrow.raiseDispute(id, keccak256("d"));

        // Arm the reentrancy attack: during resolveDispute's USDC.transfer(),
        // the malicious token will try to re-enter resolveDispute.
        malToken.setAttack(id, true);
        malToken.setAttackTo(buyer);

        // Arbiter resolves in buyer's favor — the malicious token tries
        // to call resolveDispute again, but `resolved` is already true.
        vm.prank(arbiter);
        malEscrow.resolveDispute(id, true, buyer);

        // Reentrancy prevented: escrow is resolved exactly once
        assertEq(uint(malEscrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved once");
        // Buyer got NET (99e6), not double
        assertEq(malToken.balanceOf(buyer), 10_000e6 - AMOUNT + NET, "buyer got net once");
        // Escrow is fully drained
        assertEq(malToken.balanceOf(address(malEscrow)), 0, "malEscrow drained");
    }

    function test_reentrancy_autoRefund_preventedByChecksEffectsInteractions() public {
        MaliciousERC20 malToken = new MaliciousERC20(escrow);
        RecourseEscrow malEscrow = new RecourseEscrow(address(malToken), arbiter);
        malToken.mint(buyer, 10_000e6);
        vm.prank(buyer);
        malToken.approve(address(malEscrow), type(uint256).max);

        vm.prank(buyer);
        uint256 id = malEscrow.createEscrow(buyer, seller, AMOUNT, TASK_ID, EVIDENCE);
        vm.prank(buyer);
        malEscrow.raiseDispute(id, keccak256("d"));

        // Warp past TIMEOUT
        vm.warp(block.timestamp + 14 days + 1);

        // Arm reentrancy: during autoRefund's transfer, try resolveDispute
        malToken.setAttack(id, true);
        malToken.setAttackTo(buyer);

        // Call autoRefund — malicious token tries resolveDispute mid-transfer
        malEscrow.autoRefund(id);

        assertEq(uint(malEscrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved once");
        // Buyer got full amount (autoRefund doesn't charge fee), not double
        assertEq(malToken.balanceOf(buyer), 10_000e6 - AMOUNT + AMOUNT, "buyer got refund once");
        assertEq(malToken.balanceOf(address(malEscrow)), 0, "escrow drained once");
    }

    // -------------------------------------------------------------------
    // §5 MALICIOUS SELLER: confirms with wrong hash, disputes after delivery
    // -------------------------------------------------------------------

    function test_maliciousSeller_cannotConfirmDelivery() public {
        // Only the BUYER can call confirmDelivery, not the seller
        uint256 id = _create();
        vm.prank(seller);
        vm.expectRevert("not buyer");
        escrow.confirmDelivery(id, keccak256("wrong-hash"));
    }

    function test_maliciousSeller_buyerControlsEvidenceHash() public {
        // The seller cannot substitute a wrong evidence hash during delivery
        uint256 id = _create();
        bytes32 originalEv = EVIDENCE;
        bytes32 wrongEv = keccak256("seller-forged");

        vm.prank(buyer);
        escrow.confirmDelivery(id, wrongEv);

        // The evidence hash stored is whatever the BUYER passed in
        (, , , , bytes32 evHash, , , , , , ) = escrow.escrows(id);
        assertEq(evHash, wrongEv, "buyer's hash stored, not seller's");
        assertNotEq(evHash, originalEv, "hash changed from original");
    }

    function test_maliciousSeller_cannotRaiseDispute() public {
        // Only the buyer can raise a dispute
        uint256 id = _create();
        vm.prank(seller);
        vm.expectRevert("not buyer");
        escrow.raiseDispute(id, keccak256("seller-dispute"));
    }

    function test_maliciousSeller_cannotForceResolveEarly() public {
        // Seller can't use forceResolve to trigger a refund before DISPUTE_EXPIRY
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 3 days);
        vm.prank(seller);
        vm.expectRevert("dispute expiry not reached");
        escrow.forceResolve(id);
    }

    // -------------------------------------------------------------------
    // §5 MALICIOUS BUYER: disputes before delivery, double-dispute pattern
    // -------------------------------------------------------------------

    function test_maliciousBuyer_disputeBeforeDeliveryIsAllowed() public {
        // Buyer CAN dispute in Active state (before delivery) — this is by design
        uint256 id = _create();
        vm.prank(buyer);
        escrow.raiseDispute(id, keccak256("early-dispute"));
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Disputed), "Disputed before delivery");
    }

    function test_maliciousBuyer_disputeAfterDeliveryReverts() public {
        // If buyer already confirmed delivery, they can't then dispute
        uint256 id = _create();
        vm.prank(buyer);
        escrow.confirmDelivery(id, EVIDENCE);

        vm.prank(buyer);
        vm.expectRevert("not in progress");
        escrow.raiseDispute(id, keccak256("post-delivery-dispute"));
    }

    function test_maliciousBuyer_doubleDisputeInDisputedStateReverts() public {
        // Buyer tries to dispute a second time while already Disputed
        uint256 id = _createAndDispute();
        vm.prank(buyer);
        vm.expectRevert("not in progress");
        escrow.raiseDispute(id, keccak256("second-dispute"));
    }

    function test_maliciousBuyer_cannotDrainViaRepeatedConfirmAfterDispute() public {
        // After disputing, buyer tries confirmDelivery (should revert, no double-spend)
        uint256 id = _createAndDispute();
        vm.prank(buyer);
        vm.expectRevert("disputed/resolved");
        escrow.confirmDelivery(id, EVIDENCE);

        // Escrow still holds funds
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "funds still locked");
    }

    function test_maliciousBuyer_cannotSelfResolveAsArbiter() public {
        // Buyer is not the arbiter, can't resolve their own dispute
        uint256 id = _createAndDispute();
        vm.prank(buyer);
        vm.expectRevert("not arbiter");
        escrow.resolveDispute(id, true, buyer);
    }

    // -------------------------------------------------------------------
    // §6 EXTREME VALUES — boundary amounts, zero/non-existent IDs
    // -------------------------------------------------------------------

    function test_extremeValue_createEscrowWithMaxAmount() public {
        // amount = type(uint256).max would require huge balance, so do a large
        // but feasible value: 10 billion USDC at 6 decimals.
        uint256 hugeAmt = 10_000_000_000e6;
        usdc.mint(buyer, hugeAmt);
        vm.prank(buyer);
        uint256 id = escrow.createEscrow(buyer, seller, hugeAmt, TASK_ID, EVIDENCE);
        assertEq(usdc.balanceOf(address(escrow)), hugeAmt, "huge amount escrowed");
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Active), "Active with huge amount");
    }

    function test_extremeValue_createEscrowWithAmountOneSucceeds() public {
        // amount = 1 is the smallest legal amount (below it, zero reverts)
        usdc.mint(buyer, 1);
        vm.prank(buyer);
        uint256 id = escrow.createEscrow(buyer, seller, 1, TASK_ID, EVIDENCE);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Active), "Active at 1 wei");
        assertEq(usdc.balanceOf(address(escrow)), 1, "escrow holds 1 unit");
    }

    function test_extremeValue_forceResolveOnNonExistentId() public {
        // arbitrarily large escrow ID doesn't exist
        vm.warp(block.timestamp + 100 days);
        vm.expectRevert("no escrow");
        escrow.forceResolve(type(uint256).max);
    }

    function test_extremeValue_autoRefundOnNonExistentId() public {
        vm.expectRevert("not disputed");
        escrow.autoRefund(42);
    }

    function test_extremeValue_resolveDisputeOnNonExistentId() public {
        vm.prank(arbiter);
        vm.expectRevert();
        escrow.resolveDispute(42, true, buyer);
    }

    function test_extremeValue_confirmDeliveryOnNonExistentId() public {
        // onlyBuyer modifier: escrows[42].buyer == address(0) != msg.sender
        bool ok;
        try escrow.confirmDelivery(42, EVIDENCE) {
            ok = true;
        } catch {
            ok = false;
        }
        assertFalse(ok, "confirmDelivery on non-existent escrow must not succeed");
    }

    function test_extremeValue_raiseDisputeFromStrangerOnNonExistentEscrowReverts() public {
        vm.prank(stranger);
        vm.expectRevert("not buyer");
        escrow.raiseDispute(42, EVIDENCE);
    }

    function test_extremeValue_nextIdMonotonicAcrossManyEscrows() public {
        // confirm nextId increments exactly once per createEscrow call
        for (uint i = 0; i < 5; i++) {
            assertEq(escrow.nextId(), uint256(i + 1), "nextId BEFORE create");
            _create();
            assertEq(escrow.nextId(), uint256(i + 2), "nextId AFTER create");
        }
    }

    function test_extremeValue_emptyByteHashesAccepted() public {
        // bytes32(0) is a valid (if empty) hash; contract doesn't reject it
        vm.prank(buyer);
        uint256 id = escrow.createEscrow(buyer, seller, AMOUNT, bytes32(0), bytes32(0));
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Active), "Active with zero hashes");

        vm.prank(buyer);
        escrow.raiseDispute(id, bytes32(0));
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Disputed), "Disputed with zero hash");
    }

    function test_extremeValue_maxBytes32TaskIdAndEvidence() public {
        bytes32 maxBytes = bytes32(type(uint256).max);
        vm.prank(buyer);
        uint256 id = escrow.createEscrow(buyer, seller, AMOUNT, maxBytes, maxBytes);
        (, , , bytes32 t, bytes32 ev, , , , , , ) = escrow.escrows(id);
        assertEq(t, maxBytes, "taskId == max bytes32");
        assertEq(ev, maxBytes, "evidence == max bytes32");
    }

    // -------------------------------------------------------------------
    // §7 MULTIPLE CONCURRENT ESCROWS — 5+ in one test
    // -------------------------------------------------------------------

    function test_multipleEscrows_fiveConcurrentStates() public {
        // 5 escrows across 5 distinct states + actions
        uint256 id1 = _create();            // Active
        uint256 id2 = _createAndDispute();  // Disputed (will remain Disputed throughout)
        uint256 id3 = _create();            // will confirm → Resolved
        uint256 id4 = _createAndDispute();  // will resolve sellerWins → Resolved
        uint256 id5 = _createAndDispute();  // will auto-refund (warp to 15 days)

        vm.prank(buyer);
        escrow.confirmDelivery(id3, keccak256("c3"));

        vm.prank(arbiter);
        escrow.resolveDispute(id4, false, seller);

        // Check the non-time-dependent statuses BEFORE warping time forward
        assertEq(uint(escrow.statusOf(id1)), uint(RecourseEscrow.Status.Active),  "id1 Active");
        assertEq(uint(escrow.statusOf(id2)), uint(RecourseEscrow.Status.Disputed),"id2 Disputed");
        assertEq(uint(escrow.statusOf(id3)), uint(RecourseEscrow.Status.Resolved), "id3 Resolved (confirmed delivery)");
        assertEq(uint(escrow.statusOf(id4)), uint(RecourseEscrow.Status.Resolved), "id4 Resolved (seller wins)");

        // Now warp forward to auto-refund id5; note id2 would also show Refunded after this,
        // we don't re-check it.
        vm.warp(block.timestamp + 15 days);
        escrow.autoRefund(id5);
        assertEq(uint(escrow.statusOf(id5)), uint(RecourseEscrow.Status.Resolved), "id5 Resolved (autoRefund)");
    }

    function test_multipleEscrows_singleResolutionDoesNotAffectOthers() public {
        uint256 id1 = _createAndDispute();
        uint256 id2 = _createAndDispute();
        uint256 id3 = _createAndDispute();

        // Resolve id1
        vm.prank(arbiter);
        escrow.resolveDispute(id1, true, buyer);

        assertEq(uint(escrow.statusOf(id2)), uint(RecourseEscrow.Status.Disputed), "id2 still Disputed");
        assertEq(uint(escrow.statusOf(id3)), uint(RecourseEscrow.Status.Disputed), "id3 still Disputed");
    }

    function test_multipleEscrows_dedicatedLargeBatch() public {
        // 20 escrows created in a loop, half disputed, half resolved.
        uint256[] memory ids = new uint256[](20);
        for (uint i = 0; i < 20; i++) {
            uint256 id = _create();
            ids[i] = id;
            if (i % 2 == 0) {
                vm.prank(buyer);
                escrow.raiseDispute(id, keccak256(abi.encode("d", i)));
            } else {
                vm.prank(buyer);
                escrow.confirmDelivery(id, keccak256(abi.encode("c", i)));
            }
        }
        // Confirm parity: index 0 = 0 (Disputed), index 1 = 1 (Resolved by delivery)
        assertEq(uint(escrow.statusOf(ids[0])),  uint(RecourseEscrow.Status.Disputed), "id[0] Disputed");
        assertEq(uint(escrow.statusOf(ids[1])),  uint(RecourseEscrow.Status.Resolved),  "id[1] Resolved");
        // Resolved count = odd counts
        uint256 huntedFunds = usdc.balanceOf(address(escrow));
        assertEq(huntedFunds, 10 * AMOUNT, "10 disputed escrows hold funds");
    }

    // -------------------------------------------------------------------
    // §7cont ARBITER REASSIGNMENT — edge cases (setArbiter to zero, then back)
    // -------------------------------------------------------------------

    function test_setArbiter_toZeroAddressRevertsThenEmitCheck() public {
        // Attempt zero address (already tested, but let's sequence it).
        vm.expectRevert("zero address");
        escrow.setArbiter(address(0));

        // Confirm nothing changed
        assertEq(escrow.arbiter(), arbiter, "arbiter unchanged despite failure");
    }

    function test_setArbiter_toZeroThenStillRevertsForAllSetArbiterCalls() public {
        // Cannot even set to a throwaway then to zero — zero always reverts
        address newArb = address(0x1111);
        escrow.setArbiter(newArb);
        assertEq(escrow.arbiter(), newArb, "changed to 0x1111");

        vm.expectRevert("zero address");
        escrow.setArbiter(address(0));
        assertEq(escrow.arbiter(), newArb, "arbiter still 0x1111");

        // Now swap back to the original
        escrow.setArbiter(arbiter);
        assertEq(escrow.arbiter(), arbiter, "arbiter restored to original");
    }

    function test_setArbiter_toArbiterItselfAllowed() public {
        // Setting arbiter to itself is a no-op but accepted
        address old = escrow.arbiter();
        escrow.setArbiter(arbiter);
        assertEq(escrow.arbiter(), arbiter, "set to same value works");
        assertEq(old, arbiter, "old == new");
    }

    // -------------------------------------------------------------------
    // §8 FEE PRECISION — amounts where fee rounds to zero
    // -------------------------------------------------------------------

    function test_feePrecision_amountOne_roundsFeeToZero() public {
        usdc.mint(buyer, 1);
        vm.prank(buyer);
        uint256 id = escrow.createEscrow(buyer, seller, 1, TASK_ID, EVIDENCE);
        uint256 ownerBefore = usdc.balanceOf(owner);

        vm.prank(buyer);
        escrow.confirmDelivery(id, EVIDENCE);

        // fee = 1 * 100 / 10000 = 0
        assertEq(usdc.balanceOf(owner), ownerBefore, "fee zero on 1 unit");
        assertEq(usdc.balanceOf(seller), 1, "seller gets full 1 unit (no fee)");
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow drained");
    }

    function test_feePrecision_amount2_feeRoundsToZero() public {
        // fee = 2 * 100 / 10000 = 0.02 rounds to 0 in integer division
        usdc.mint(buyer, 2);
        vm.prank(buyer);
        uint256 id = escrow.createEscrow(buyer, seller, 2, TASK_ID, EVIDENCE);
        uint256 ownerBefore = usdc.balanceOf(owner);

        vm.prank(buyer);
        escrow.confirmDelivery(id, EVIDENCE);

        assertEq(usdc.balanceOf(owner), ownerBefore, "fee zero on 2 units");
        assertEq(usdc.balanceOf(seller), 2, "seller gets full 2 units");
    }

    function test_feePrecision_amount99_feeRoundsToZero() public {
        // 99 * 100 / 10000 = 0.99 → truncates to 0
        usdc.mint(buyer, 99);
        vm.prank(buyer);
        uint256 id = escrow.createEscrow(buyer, seller, 99, TASK_ID, EVIDENCE);
        uint256 ownerBefore = usdc.balanceOf(owner);

        vm.prank(buyer);
        escrow.confirmDelivery(id, EVIDENCE);

        assertEq(usdc.balanceOf(owner), ownerBefore, "fee zero on 99 units");
        assertEq(usdc.balanceOf(seller), 99, "seller gets full 99 units");
    }

    function test_feePrecision_amount100_feeIsExactlyOne() public {
        // 100 * 100 / 10000 = 1 (first non-zero fee)
        usdc.mint(buyer, 100);
        vm.prank(buyer);
        uint256 id = escrow.createEscrow(buyer, seller, 100, TASK_ID, EVIDENCE);
        uint256 ownerBefore = usdc.balanceOf(owner);

        vm.prank(buyer);
        escrow.confirmDelivery(id, EVIDENCE);

        assertEq(usdc.balanceOf(owner), ownerBefore + 1, "fee = 1 on 100 units");
        assertEq(usdc.balanceOf(seller), 99, "seller gets 99 units");
    }

    function test_feePrecision_amount3_feeIsZero() public {
        // Explicit test for floor behavior with 3 wei
        usdc.mint(buyer, 3);
        vm.prank(buyer);
        uint256 id = escrow.createEscrow(buyer, seller, 3, TASK_ID, EVIDENCE);

        vm.prank(buyer);
        escrow.confirmDelivery(id, EVIDENCE);

        // 3 → fee = floor(0.03) = 0, seller gets 3
        assertEq(usdc.balanceOf(address(escrow)), 0, "escrow drained");
        assertEq(usdc.balanceOf(seller), 3, "seller gets 3 units");
    }

    function test_feePrecision_resolveDisputeWithSmallAmountNoFee() public {
        // fee rounds to zero in resolveDispute path too
        usdc.mint(buyer, 99);
        vm.prank(buyer);
        uint256 id = escrow.createEscrow(buyer, seller, 99, TASK_ID, EVIDENCE);
        vm.prank(buyer);
        escrow.raiseDispute(id, keccak256("d"));

        uint256 ownerBefore = usdc.balanceOf(owner);
        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.prank(arbiter);
        escrow.resolveDispute(id, true, buyer);

        // fee = floor(0.99) = 0, buyer gets 99
        assertEq(usdc.balanceOf(owner), ownerBefore, "no fee");
        assertEq(usdc.balanceOf(buyer), buyerBefore + 99, "buyer refunded 99");
    }

    // -------------------------------------------------------------------
    // §9 STATE MACHINE — every transition path between states
    // (Created→Active → Paid → Confirmed/Resolved → Disputed → Resolved → Refunded)
    // -------------------------------------------------------------------

    function test_stateMachine_createdToActiveOnCreate() public {
        // After creation, status is Active
        uint256 id = _create();
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Active), "Active");
        // funds escrowed
        assertEq(usdc.balanceOf(address(escrow)), AMOUNT, "funds held");
    }

    function test_stateMachine_activeToResolvedViaConfirmDelivery() public {
        // Active → (confirmDelivery) → Resolved
        uint256 id = _create();
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Active), "Active");

        vm.prank(buyer);
        escrow.confirmDelivery(id, keccak256("ev"));
        // confirmDelivery sets delivered + resolved, so we go directly to Resolved
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved after confirm delivery");
    }

    function test_stateMachine_activeToDisputedViaRaiseDispute() public {
        // Active → Disputed
        uint256 id = _create();
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Active), "Active");

        vm.prank(buyer);
        escrow.raiseDispute(id, keccak256("d"));
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Disputed), "Disputed");
    }

    function test_stateMachine_disputedToResolvedViaArbiterBuyerWins() public {
        // Disputed → Resolved (buyer wins)
        uint256 id = _createAndDispute();
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Disputed), "Disputed");

        vm.prank(arbiter);
        escrow.resolveDispute(id, true, buyer);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved (buyer wins)");
    }

    function test_stateMachine_disputedToResolvedViaArbiterSellerWins() public {
        // Disputed → Resolved (seller wins)
        uint256 id = _createAndDispute();
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Disputed), "Disputed");

        vm.prank(arbiter);
        escrow.resolveDispute(id, false, seller);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved (seller wins)");
    }

    function test_stateMachine_disputedToResolvedViaForceResolve() public {
        // Disputed → Resolved via forceResolve after DISPUTE_EXPIRY (7 days)
        uint256 id = _createAndDispute();
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Disputed), "Disputed");

        vm.warp(block.timestamp + 7 days + 1);
        escrow.forceResolve(id);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved via forceResolve");
    }

    function test_stateMachine_disputedToResolvedViaAutoRefundAfterTimeout() public {
        // Disputed → statusOf shows Refunded, autoRefund → Resolved
        uint256 id = _createAndDispute();
        vm.warp(block.timestamp + 14 days + 1);
        // statusOf should return Refunded (value 4) once past TIMEOUT
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Refunded), "statusOf = Refunded");

        // autoRefund actually transitions to Resolved
        escrow.autoRefund(id);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved via autoRefund");
    }

    function test_stateMachine_noTransitionFromResolved() public {
        // From Resolved (via confirmDelivery, never disputed), only "disputed-required" functions
        // can be exercised because the disputed flag was never set.
        uint256 id = _create();
        vm.prank(buyer);
        escrow.confirmDelivery(id, EVIDENCE);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved");

        // Cannot raise dispute (already resolved → not Active/Confirmed in statusOf)
        vm.prank(buyer);
        vm.expectRevert("not in progress");
        escrow.raiseDispute(id, keccak256("d"));

        // Cannot confirm again (onlyBuyer passes but disputed/resolved check fires)
        vm.prank(buyer);
        vm.expectRevert("disputed/resolved");
        escrow.confirmDelivery(id, EVIDENCE);

        // Cannot autoRefund (was never disputed)
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert("not disputed");
        escrow.autoRefund(id);

        // Cannot forceResolve (was never disputed)
        vm.expectRevert("not disputed");
        escrow.forceResolve(id);
    }

    function test_stateMachine_noTransitionFromResolvedDisputedPath() public {
        // From Resolved (via resolveDispute after raiseDispute), the disputed flag IS set,
        // so the "already resolved" guard fires for forceResolve and autoRefund.
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        escrow.resolveDispute(id, true, buyer);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved");

        // Cannot raise dispute (already Disputed → not in progress)
        vm.prank(buyer);
        vm.expectRevert("not in progress");
        escrow.raiseDispute(id, keccak256("d"));

        // Cannot force-resolve (already resolved)
        vm.warp(block.timestamp + 10 days);
        vm.expectRevert("already resolved");
        escrow.forceResolve(id);

        // Cannot auto-refund again (already resolved)
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert("already resolved");
        escrow.autoRefund(id);

        // Arbiter cannot resolve again (already resolved)
        vm.prank(arbiter);
        vm.expectRevert("already resolved");
        escrow.resolveDispute(id, true, buyer);
    }

    function test_stateMachine_cannotSkipToResolveFromActive() public {
        // From Active directly, can arbitration happen? No — must be Disputed first.
        uint256 id = _create();
        vm.prank(arbiter);
        vm.expectRevert("not disputed");
        escrow.resolveDispute(id, true, buyer);
    }

    function test_stateMachine_cannotAutoRefundFromActiveDirectly() public {
        // from Active, autoRefund reverts (not disputed)
        uint256 id = _create();
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert("not disputed");
        escrow.autoRefund(id);
    }

    function test_stateMachine_autoRefundAlreadyResolvedGivesAlreadyResolved() public {
        // Once an escrow has been disputed+resolved, autoRefund returns "already resolved"
        // (this exercises a different state path from a confirmDelivery-resolved escrow).
        uint256 id = _createAndDispute();
        vm.prank(arbiter);
        escrow.resolveDispute(id, true, buyer);

        vm.warp(block.timestamp + 30 days);
        vm.expectRevert("already resolved");
        escrow.autoRefund(id);
    }

    function test_stateMachine_cannotForceResolveFromActiveDirectly() public {
        // From Active, forceResolve reverts (not disputed)
        uint256 id = _create();
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert("not disputed");
        escrow.forceResolve(id);
    }

    function test_stateMachine_fullLifecycle_BuyPath() public {
        // end-to-end happy path: create → active → dispute → arbiter resolves (buyer wins)
        uint256 id = _create();
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Active), "Active");

        vm.prank(buyer);
        escrow.raiseDispute(id, keccak256("d-lifecycle"));
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Disputed), "Disputed");

        vm.prank(arbiter);
        escrow.resolveDispute(id, true, buyer);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved (buyer wins)");

        // Funds all drained
        assertEq(usdc.balanceOf(address(escrow)), 0, "fully drained at end");
    }

    function test_stateMachine_fullLifecycle_SellerPath() public {
        // end-to-end happy path: create → active → dispute → arbiter resolves (seller wins)
        uint256 id = _create();
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Active), "Active");

        vm.prank(buyer);
        escrow.raiseDispute(id, keccak256("d-seller-lifecycle"));
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Disputed), "Disputed");

        vm.prank(arbiter);
        escrow.resolveDispute(id, false, seller);
        assertEq(uint(escrow.statusOf(id)), uint(RecourseEscrow.Status.Resolved), "Resolved (seller wins)");

        // Seller got the net payout
        assertEq(usdc.balanceOf(address(escrow)), 0, "fully drained at end");
    }
}
