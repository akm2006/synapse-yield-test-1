import { parseAbi } from 'viem';

export const erc20Abi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
]);

export const kintsuAbi = parseAbi([
  'function deposit(uint96 assets, address receiver) payable returns (uint96 shares)',
  'function requestUnlock(uint96 shares)',
  'function redeem(uint256 unlockIndex, address receiver) returns (uint96 assets)',
  'function balanceOf(address owner) view returns (uint256)',
]);

export const magmaAbi = parseAbi([
  'function depositMon() payable',
  'function depositMon(uint256 referralId) payable',
  'function withdrawMon(uint256 amount)',
]);

export const permit2Abi = parseAbi([
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
]);
