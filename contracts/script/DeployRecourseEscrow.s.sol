// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../src/RecourseEscrow.sol";
import "forge-std/Script.sol";
import "forge-std/console.sol";

/// @title DeployRecourseEscrow
/// @notice Deploys RecourseEscrow to Sepolia with Sepolia USDC.
/// @dev Run: forge script script/DeployRecourseEscrow.s.sol:DeployRecourseEscrow \
///         --rpc-url $SEPOLIA_RPC --private-key $PRIVATE_KEY --broadcast
contract DeployRecourseEscrow is Script {
    address constant SEPOLIA_USDC = 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238;

    function run() external returns (RecourseEscrow escrow) {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        // Deployer is also the arbiter (can be changed later via setArbiter)
        escrow = new RecourseEscrow(SEPOLIA_USDC, deployer);

        vm.stopBroadcast();

        console.log("RecourseEscrow deployed at:", address(escrow));
        console.log("USDC token:", SEPOLIA_USDC);
        console.log("Arbiter:", deployer);
        console.log("Deployer:", deployer);
    }
}
