// src/lib/ensureAllowances.ts
import type { Address } from 'viem';
import { maxUint256 } from 'viem';
import { erc20Abi, permit2Abi } from './abis';
import { serverWallet, serverPublic } from './serverClients';
import { CONTRACTS } from './contracts';
import { emitLog } from './logBus';

export type ApprovalDetail = {
  token: Address;
  spender: Address;
  type: 'erc20' | 'permit2';
  exists: boolean;
  current: string;
  needed: string;
  expiration?: number;
  isExpired?: boolean;
  tookAction: boolean;
  txHash?: `0x${string}`;
  message: string;
};

export type EnsureAllowancesResult = {
  erc20: ApprovalDetail;
  permit2: ApprovalDetail;
};

// uint160 max for Permit2 amount
const MAX_UINT160 = (1n << 160n) - 1n; // type(uint160).max [web:25]

export async function ensureTokenAllowances(
  token: Address,
  amountNeeded: bigint,
  opts?: { opId?: string }
): Promise<EnsureAllowancesResult> {
  const owner = serverWallet.account.address;
  const { PANCAKESWAP: UNIVERSAL_ROUTER, PERMIT2 } = CONTRACTS;
  const now = Math.floor(Date.now() / 1000);
  const opId = opts?.opId;
  const log = (m: string) => (opId ? emitLog(opId, m) : console.log(m));

  log(`Starting allowance checks token=${token} needed=${amountNeeded.toString()}`); // [web:29]

  // 1) ERC20 allowance (owner -> PERMIT2), not router
  const currentErc20 = (await serverPublic.readContract({
    address: token,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [owner, PERMIT2],
  })) as bigint; // [web:30]

  log(`ERC20 allowance (spender=Permit2) current=${currentErc20.toString()}`); // [web:30]

  // 2) Permit2 internal allowance (owner, token, spender=Universal Router)
  let pAmount = 0n;
  let pExpire = 0;
  try {
    const res = (await serverPublic.readContract({
      address: PERMIT2,
      abi: permit2Abi,
      functionName: 'allowance',
      args: [owner, token, UNIVERSAL_ROUTER],
    })) as [bigint, number, number]; // amount(uint160), expiration(uint48), nonce(uint48) [web:25]
    pAmount = res[0];
    pExpire = res[1];
    log(`Permit2 allowance current=${pAmount.toString()} exp=${pExpire}`); // [web:25]
  } catch {
    log('Permit2 allowance read failed; assuming zero'); // [web:25]
  }

  const erc20Exists = currentErc20 >= amountNeeded; // [web:30]
  const permit2Expired = pExpire > 0 && pExpire <= now; // [web:25]
  const permit2Exists = pAmount >= amountNeeded && !permit2Expired; // [web:25]

  const erc20: ApprovalDetail = {
    token,
    spender: PERMIT2,
    type: 'erc20',
    exists: erc20Exists,
    current: currentErc20.toString(),
    needed: amountNeeded.toString(),
    tookAction: false,
    message: erc20Exists
      ? 'ERC20 approval to Permit2 exists and is sufficient.'
      : 'ERC20 approval to Permit2 missing or insufficient; will approve max.',
  }; // [web:30]

  const permit2: ApprovalDetail = {
    token,
    spender: UNIVERSAL_ROUTER,
    type: 'permit2',
    exists: permit2Exists,
    current: pAmount.toString(),
    needed: amountNeeded.toString(),
    expiration: pExpire || undefined,
    isExpired: permit2Expired || undefined,
    tookAction: false,
    message: permit2Exists
      ? 'Permit2 allowance to Universal Router exists and is valid.'
      : permit2Expired
      ? 'Permit2 allowance expired; will re-approve.'
      : 'Permit2 allowance missing or insufficient; will approve.',
  }; // [web:25][web:29]

  // 3) If ERC20 allowance to Permit2 is insufficient, approve max uint256
  if (!erc20Exists) {
    log('Submitting ERC20 approve(token -> Permit2, maxUint256)...'); // [web:30]
    const tx = await serverWallet.writeContract({
      address: token,
      abi: erc20Abi,
      functionName: 'approve',
      args: [PERMIT2, maxUint256],
    });
    log(`ERC20 approval submitted tx=${tx}`); // [web:30]
    await serverPublic.waitForTransactionReceipt({ hash: tx });
    log('ERC20 approval confirmed'); // [web:30]
    erc20.tookAction = true;
    erc20.txHash = tx;
    erc20.message = 'ERC20 approval to Permit2 submitted and confirmed.';
  } else {
    log('ERC20 approval already sufficient; skipping.'); // [web:30]
  }

  // 4) If Permit2 allowance is insufficient/expired, approve with uint160 max and uint48 expiration (as BigInt)
  if (!permit2Exists || permit2Expired) {
    const expiration :number = (now + 365 * 24 * 60 * 60); // 1 year, fits uint48 [web:25]
    log(`Submitting Permit2.approve(token, router, MAX_UINT160, expiration=${expiration.toString()})...`); // [web:25][web:29]
    const tx = await serverWallet.writeContract({
      address: PERMIT2,
      abi: permit2Abi,
      functionName: 'approve',
      args: [token, UNIVERSAL_ROUTER, MAX_UINT160, expiration],
    });
    log(`Permit2 approval submitted tx=${tx}`); // [web:25][web:29]
    await serverPublic.waitForTransactionReceipt({ hash: tx });
    log('Permit2 approval confirmed'); // [web:25][web:29]
    permit2.tookAction = true;
    permit2.txHash = tx;
    permit2.expiration = Number(expiration);
    permit2.isExpired = false;
    permit2.message = 'Permit2 allowance to Universal Router submitted and confirmed.';
  } else {
    log('Permit2 allowance already valid; skipping.'); // [web:25][web:29]
  }

  return { erc20, permit2 };
}
