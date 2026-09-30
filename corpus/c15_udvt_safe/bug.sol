// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Minimal copy of the Guard types (docs/GUARD.md §1): typed code cannot mix views.
type Usdc6 is uint256;
type Usdc18 is uint256;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}

library Usdc {
    uint256 internal constant SCALE = 1e12;
    address internal constant USDC_ERC20 = 0x3600000000000000000000000000000000000000;

    function toNative(Usdc6 a) internal pure returns (Usdc18) {
        return Usdc18.wrap(Usdc6.unwrap(a) * SCALE);
    }

    function msgValue() internal view returns (Usdc18) {
        return Usdc18.wrap(msg.value);
    }

    function erc20Balance(address a) internal view returns (Usdc6) {
        return Usdc6.wrap(IERC20(USDC_ERC20).balanceOf(a));
    }

    function sendNative(address payable to, Usdc18 amt) internal {
        (bool ok,) = to.call{value: Usdc18.unwrap(amt)}("");
        require(ok, "send");
    }

    function sendErc20(address to, Usdc6 amt) internal {
        require(IERC20(USDC_ERC20).transfer(to, Usdc6.unwrap(amt)), "transfer");
    }
}

/// Refunds ERC-20 deposits natively, fully typed.
contract TypedRefund {
    mapping(address => Usdc6) public deposits;

    function record(address user) external {
        deposits[user] = Usdc.erc20Balance(user);
    }

    function refund() external {
        Usdc6 amt = deposits[msg.sender];
        deposits[msg.sender] = Usdc6.wrap(0);
        Usdc.sendNative(payable(msg.sender), Usdc.toNative(amt));
    }

    function echo() external payable {
        Usdc.sendNative(payable(msg.sender), Usdc.msgValue());
    }
}
