// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Usdc, Usdc6, Usdc18, SCALE, USDC_ERC20} from "../src/guard/Usdc.sol";
import {TwelvePayout} from "../src/guard/TwelvePayout.sol";
import {FixedRefund} from "../src/demo/FixedRefund.sol";
import {LeakyRefund} from "../src/demo/LeakyRefund.sol";
import {OverpayVault} from "../src/demo/OverpayVault.sol";

/// @dev LOCAL, MOCKED (I8): a 6-decimal ERC-20 etched at 0x3600… stands in for Arc's USDC interface, and native value
///      is the plain EVM balance. On Arc the two are one ledger; here they are not. Arc semantics live in test-arc/.
contract MockUsdc {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function approve(address s, uint256 a) external returns (bool) {
        allowance[msg.sender][s] = a;
        return true;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        return true;
    }

    function transferFrom(address f, address to, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a;
        balanceOf[f] -= a;
        balanceOf[to] += a;
        return true;
    }
}

/// @dev External wrappers so reverts inside internal library calls can be asserted.
contract UsdcHarness {
    function toNative(uint256 a) external pure returns (uint256) {
        return Usdc18.unwrap(Usdc.toNative(Usdc6.wrap(a)));
    }

    function toErc20Exact(uint256 a) external pure returns (uint256) {
        return Usdc6.unwrap(Usdc.toErc20Exact(Usdc18.wrap(a)));
    }

    function mulDiv6(uint256 a, uint256 n, uint256 d) external pure returns (uint256) {
        return Usdc6.unwrap(Usdc.mulDiv6(Usdc6.wrap(a), n, d));
    }
}

contract Payer is TwelvePayout {
    constructor(uint256 cap6, uint256 window) TwelvePayout(cap6, window) {}

    function pay(address payable to, uint256 intended6, uint256 native18) external {
        _payNativeChecked(to, intended6, native18);
    }

    receive() external payable {}
}

contract UsdcTest is Test {
    uint256 constant FIVE6 = 5_000_000; // 5 USDC in the ERC-20 view
    UsdcHarness h;

    function setUp() public {
        h = new UsdcHarness();
    }

    // ---- conversions

    function testFuzz_roundTripIsExact(uint256 a) public pure {
        a = bound(a, 0, type(uint256).max / SCALE);
        (Usdc6 back, Usdc18 dust) = Usdc.toErc20(Usdc.toNative(Usdc6.wrap(a)));
        assertEq(Usdc6.unwrap(back), a);
        assertEq(Usdc18.unwrap(dust), 0);
    }

    function testFuzz_toErc20KeepsEveryUnit(uint256 raw18) public pure {
        (Usdc6 amt, Usdc18 dust) = Usdc.toErc20(Usdc18.wrap(raw18));
        assertLt(Usdc18.unwrap(dust), SCALE);
        // nothing is lost: amount in the native view plus dust is the input
        assertEq(Usdc18.unwrap(Usdc.toNative(amt)) + Usdc18.unwrap(dust), raw18);
    }

    function test_toNativeOverflowReverts() public {
        uint256 max = type(uint256).max / SCALE;
        assertEq(h.toNative(max), max * SCALE);
        vm.expectRevert(); // checked multiply: Panic(0x11)
        h.toNative(max + 1);
    }

    function test_toErc20ExactRejectsDust() public {
        uint256 five18 = Usdc18.unwrap(Usdc.toNative(Usdc6.wrap(FIVE6)));
        assertEq(h.toErc20Exact(five18), FIVE6);
        vm.expectRevert(abi.encodeWithSelector(Usdc.DustRemainder.selector, Usdc18.wrap(1)));
        h.toErc20Exact(five18 + 1);
    }

    // ---- operators mirror raw uint256 semantics

    function testFuzz_operators6(uint128 a, uint128 b) public pure {
        Usdc6 x = Usdc6.wrap(a);
        Usdc6 y = Usdc6.wrap(b);
        assertEq(Usdc6.unwrap(x + y), uint256(a) + b);
        if (a >= b) assertEq(Usdc6.unwrap(x - y), uint256(a) - b);
        assertEq(x < y, a < b);
        assertEq(x <= y, a <= b);
        assertEq(x > y, a > b);
        assertEq(x >= y, a >= b);
        assertEq(x == y, a == b);
        assertEq(x != y, a != b);
    }

    function testFuzz_operators18(uint128 a, uint128 b) public pure {
        Usdc18 x = Usdc18.wrap(a);
        Usdc18 y = Usdc18.wrap(b);
        assertEq(Usdc18.unwrap(x + y), uint256(a) + b);
        if (a >= b) assertEq(Usdc18.unwrap(x - y), uint256(a) - b);
        assertEq(x < y, a < b);
        assertEq(x <= y, a <= b);
        assertEq(x > y, a > b);
        assertEq(x >= y, a >= b);
        assertEq(x == y, a == b);
        assertEq(x != y, a != b);
    }

    // ---- mulDiv: floor, full precision

    function testFuzz_mulDivMatchesNaiveWhenNoOverflow(uint128 a, uint64 n, uint64 d) public view {
        vm.assume(d > 0);
        assertEq(h.mulDiv6(a, n, d), (uint256(a) * n) / d);
    }

    function test_mulDivFullPrecision() public view {
        uint256 big = type(uint256).max / 3;
        assertEq(h.mulDiv6(big, 6, 3), big * 2); // big * 6 overflows 256 bits; the result fits
    }

    function test_mulDivRevertsOnZeroDivisorAndOverflow() public {
        vm.expectRevert(Usdc.MulDivOverflow.selector);
        h.mulDiv6(1, 1, 0);
        vm.expectRevert(Usdc.MulDivOverflow.selector);
        h.mulDiv6(type(uint256).max, 2, 1);
    }

    // ---- TwelvePayout

    function test_payoutPaysOnlyMatchingAmounts() public {
        Payer p = new Payer(FIVE6 * 2, 1 days);
        uint256 five18 = Usdc18.unwrap(Usdc.toNative(Usdc6.wrap(FIVE6)));
        vm.deal(address(p), five18 * 3);
        address payable to = payable(makeAddr("to"));

        p.pay(to, FIVE6, five18);
        assertEq(to.balance, five18);

        // the 10^12 bug: legacy code passes the 6-dec number as the native amount
        vm.expectRevert(abi.encodeWithSelector(TwelvePayout.UnitMismatch.selector, FIVE6, FIVE6));
        p.pay(to, FIVE6, FIVE6);
    }

    function test_payoutWindowCap() public {
        Payer p = new Payer(FIVE6, 1 days);
        uint256 five18 = Usdc18.unwrap(Usdc.toNative(Usdc6.wrap(FIVE6)));
        vm.deal(address(p), five18 * 3);
        address payable to = payable(makeAddr("to"));

        p.pay(to, FIVE6, five18);
        assertEq(p.remainingInWindow6(), 0);
        vm.expectRevert(abi.encodeWithSelector(TwelvePayout.WindowCapExceeded.selector, FIVE6, 0));
        p.pay(to, FIVE6, five18);

        vm.warp(block.timestamp + 1 days);
        assertEq(p.remainingInWindow6(), FIVE6);
        p.pay(to, FIVE6, five18);
        assertEq(to.balance, five18 * 2);
    }

    // ---- demo contracts (mocked ledger, see header)

    function _usdc() internal returns (MockUsdc u) {
        vm.etch(USDC_ERC20, address(new MockUsdc()).code);
        u = MockUsdc(USDC_ERC20);
    }

    function test_fixedRefundReturnsTheSameValue() public {
        MockUsdc u = _usdc();
        FixedRefund shop = new FixedRefund(0); // sold out: every buy is refunded
        uint256 five18 = Usdc18.unwrap(Usdc.toNative(Usdc6.wrap(FIVE6)));
        vm.deal(address(shop), five18);
        address buyer = makeAddr("buyer");
        u.mint(buyer, FIVE6);
        vm.startPrank(buyer);
        u.approve(address(shop), FIVE6);
        shop.buy(Usdc6.wrap(FIVE6));
        vm.stopPrank();
        assertEq(buyer.balance, five18, "refund equals payment, native view");
    }

    function test_leakyRefundReturnsDust() public {
        MockUsdc u = _usdc();
        LeakyRefund shop = new LeakyRefund(0);
        vm.deal(address(shop), Usdc18.unwrap(Usdc.toNative(Usdc6.wrap(FIVE6))));
        address buyer = makeAddr("buyer");
        u.mint(buyer, FIVE6);
        vm.startPrank(buyer);
        u.approve(address(shop), FIVE6);
        shop.buy(FIVE6);
        vm.stopPrank();
        assertEq(buyer.balance, FIVE6, "raw 5_000_000 in the native view = 5 * 10^-12 USDC");
    }

    function test_overpayVaultGuardedPathRevertsWithReason() public {
        _usdc();
        OverpayVault v = new OverpayVault(FIVE6, 1 days);
        address user = makeAddr("user");
        uint256 dep = Usdc18.unwrap(Usdc.toNative(Usdc6.wrap(FIVE6)));
        vm.deal(user, dep);
        vm.startPrank(user);
        v.deposit{value: dep}();
        vm.expectRevert(abi.encodeWithSelector(TwelvePayout.UnitMismatch.selector, dep, dep));
        v.withdrawGuarded();
        // the unguarded path asks the ERC-20 view for the 18-dec number: 10^12 times too much
        vm.expectRevert(); // mock has no balance for it (on Arc: insufficient balance at 10^12 scale)
        v.withdraw();
        vm.stopPrank();
    }
}
