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

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "insufficient");
        require(allowance[from][msg.sender] >= amount, "allowance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        allowance[from][msg.sender] -= amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }
}

// ---------------------------------------------------------------------------
// Test suite for the real RecourseEscrow (with 1% fee, forceResolve, setArbiter)
// ---------------------------------------------------------------------------
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
    // Helper
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
    // createEscrow
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
}
