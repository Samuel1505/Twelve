// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

// Phase 0 SlithIR probe: one construct per IR operation the analyzer consumes. Contains deliberate unit mixing.
interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address, uint256) external returns (bool);
}

type U6 is uint256;

contract Probe {
    IERC20 constant USDC = IERC20(0x3600000000000000000000000000000000000000);
    IERC20 public immutable usdcImm;
    address public usdcStore;
    mapping(address => uint256) public credits;

    constructor(address u) { usdcImm = IERC20(u); usdcStore = u; }

    function deposit() external payable { credits[msg.sender] += msg.value; }            // msg.value -> storage

    function withdraw() external {                                                       // 18 -> ERC-20 sink
        uint256 amt = credits[msg.sender];
        credits[msg.sender] = 0;
        USDC.transfer(msg.sender, amt);
    }

    function refund(uint256 a6) external {                                               // LowLevelCall value
        (bool ok,) = payable(msg.sender).call{value: a6}("");
        require(ok);
    }

    function legacy(address payable to, uint256 x) external {                           // Transfer / Send
        to.transfer(x);
        bool s = to.send(x);
        require(s);
    }

    function phi(bool c) external payable returns (uint256 r) {                             // Phi join
        if (c) r = msg.value; else r = USDC.balanceOf(address(this));
    }

    function convert(uint256 a18) external pure returns (uint128 n, U6 w) {              // TypeConversion + UDVT
        n = uint128(a18 / 1e12);
        w = U6.wrap(a18 / 10**12);
    }

    function bal() external view returns (uint256) { return address(this).balance + USDC.balanceOf(address(this)); }
}
