// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function approve(address, uint256) external returns (bool);
}


/// EIP-1967 proxy in front of a refund vault that pays ERC-20 deposits back natively (LeakyRefund behind a proxy).
contract RefundVaultImpl {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    mapping(address => uint256) public deposits;

    function deposit(uint256 amount) external {
        uint256 before = USDC.balanceOf(address(this));
        USDC.transferFrom(msg.sender, address(this), amount);
        deposits[msg.sender] += USDC.balanceOf(address(this)) - before;
    }

    function refund() external {
        uint256 amt = deposits[msg.sender];
        deposits[msg.sender] = 0;
        (bool ok,) = payable(msg.sender).call{value: amt}(""); // @expect TW-003 HIGH refund()
        require(ok, "send");
    }
}

/// Minimal EIP-1967 proxy.
contract SimpleProxy {
    bytes32 internal constant IMPL_SLOT = 0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc;

    constructor(address impl) {
        assembly {
            sstore(IMPL_SLOT, impl)
        }
    }

    fallback() external payable {
        assembly {
            let impl := sload(IMPL_SLOT)
            calldatacopy(0, 0, calldatasize())
            let ok := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)
            returndatacopy(0, 0, returndatasize())
            switch ok
            case 0 { revert(0, returndatasize()) }
            default { return(0, returndatasize()) }
        }
    }
}