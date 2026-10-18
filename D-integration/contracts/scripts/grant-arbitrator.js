// Grants ARBITRATOR_ROLE to a wallet on an already-deployed network (e.g. Sepolia).
//
// Why this exists: contracts/scripts/deploy.js seeds roles using Hardhat's built-in
// accounts (ethers.getSigners()), which only works on a local chain. On Sepolia there is
// a single deployer wallet, and RoleManager only lets the ADMIN grant ARBITRATOR_ROLE
// (clients/freelancers self-register through the frontend "Register" buttons). The
// frontend has no UI for granting arbitrator, so this script covers that gap.
//
// Usage (from the contracts folder):
//   $env:SEPOLIA_RPC_URL='https://sepolia.g.alchemy.com/v2/<your-key>'
//   $env:PRIVATE_KEY='0x<deployer/admin private key>'      # never commit this
//   $env:ARBITRATOR_ADDRESS='0x<wallet to make arbitrator>'
//   npx hardhat run scripts/grant-arbitrator.js --network sepolia
//
// Idempotent: if the wallet already holds the role it reports that and exits successfully.
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");

async function main() {
  const arbitrator = process.env.ARBITRATOR_ADDRESS;
  if (!arbitrator || !ethers.isAddress(arbitrator)) {
    throw new Error("ARBITRATOR_ADDRESS must be a valid 0x Ethereum address.");
  }

  const [admin] = await ethers.getSigners();
  if (!admin) {
    throw new Error("No signer available. Set PRIVATE_KEY for this network.");
  }

  const deploymentFile = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(deploymentFile)) {
    throw new Error(`${deploymentFile} not found. Run scripts/deploy.js on this network first.`);
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
  const roleManagerAddress = deployment.contracts?.RoleManager?.address;
  if (!roleManagerAddress) {
    throw new Error("RoleManager address missing from the deployment record.");
  }

  const roles = await ethers.getContractAt("RoleManager", roleManagerAddress);
  const roleHash = await roles.ARBITRATOR_ROLE();

  if (await roles.hasRole(roleHash, arbitrator)) {
    console.log(`Already an arbitrator: ${arbitrator}`);
    return;
  }

  console.log(`Admin      : ${admin.address}`);
  console.log(`RoleManager: ${roleManagerAddress}`);
  console.log(`Granting ARBITRATOR_ROLE to ${arbitrator} ...`);
  const tx = await roles.grantRole(roleHash, arbitrator);
  const receipt = await tx.wait();
  console.log(`Granted. tx=${receipt.hash} gas=${receipt.gasUsed.toString()}`);

  const [isAdmin, isClient, isFreelancer, isArbitrator] = await roles.rolesOf(arbitrator);
  console.log(`rolesOf -> admin=${isAdmin} client=${isClient} freelancer=${isFreelancer} arbitrator=${isArbitrator}`);
  if (!isArbitrator) throw new Error("Grant transaction confirmed but rolesOf still reports false.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
