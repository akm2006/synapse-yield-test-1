// src/lib/abis.ts
import { parseAbi } from 'viem';

export const erc20Abi = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
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
