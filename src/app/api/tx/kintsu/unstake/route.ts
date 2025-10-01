export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import type { Address } from 'viem';
import { encodeAbiParameters } from 'viem';
import { serverWallet, serverPublic } from '@/lib/serverClients';
import { erc20Abi } from '@/lib/abis';
import { CONTRACTS } from '@/lib/contracts';
import { toJSONSafe } from '@/lib/json';
import { ensureTokenAllowances } from '@/lib/ensureAllowances';
import { emitLog, endLog } from '@/lib/logBus';

const UNIVERSAL_ROUTER = CONTRACTS.PANCAKESWAP;
const SMON = CONTRACTS.KINTSU;
const WMON = CONTRACTS.WMON;

const universalRouterAbi = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'payable',
    inputs: [
      { name: 'commands', type: 'bytes' },
      { name: 'inputs', type: 'bytes[]' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

const wmonAbi = [
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [{ name: 'wad', type: 'uint256' }], outputs: [] },
] as const;

const CMD_V3_SWAP_EXACT_IN = '0x00' as `0x${string}`;

function encodeV3Path(tokenIn: Address, tokenOut: Address, fee: number): `0x${string}` {
  const feeHex = fee.toString(16).padStart(6, '0');
  return (`0x${tokenIn.slice(2)}${feeHex}${tokenOut.slice(2)}`) as `0x${string}`;
}

function encodeV3SwapExactInInput(params: {
  recipient: Address;
  amountIn: bigint;
  amountOutMin: bigint;
  path: `0x${string}`;
  payerIsUser: boolean;
}): `0x${string}` {
  return encodeAbiParameters(
    [
      { name: 'recipient', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'bytes' },
      { name: 'payerIsUser', type: 'bool' },
    ],
    [params.recipient, params.amountIn, params.amountOutMin, params.path, params.payerIsUser]
  ) as `0x${string}`;
}

export async function POST(req: Request) {
  let opId: string | undefined;
  try {
    const body = await req.json();
    const amountIn = BigInt(body.amountIn as string);
    const minOut = BigInt((body.minOut as string) ?? '0');
    const fee = Number(body.fee ?? 2500);
    const recipient = body.recipient as Address;
    const unwrap = Boolean(body.unwrap ?? true);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(body.deadlineSec ?? 1800));
    opId = body.opId as string | undefined;

    const log = (m: string) => {
      if (opId) emitLog(opId, m);
      else console.log(m);
    };

    log(`Unstake started: amountIn=${amountIn.toString()} recipient=${recipient}`);

    // STEP 1: Ensure allowances for sMON with streaming logs
    const approvals = await ensureTokenAllowances(SMON, amountIn, { opId });

    // STEP 2: Build swap
    const path = encodeV3Path(SMON, WMON, fee);
    const commands = CMD_V3_SWAP_EXACT_IN;
    const inputSwap = encodeV3SwapExactInInput({
      recipient,
      amountIn,
      amountOutMin: minOut,
      path,
      payerIsUser: true,
    });
    const inputs = [inputSwap] as `0x${string}`[];

    // STEP 3: Execute swap
    log('Submitting Universal Router swap...');
    const swapHash = await serverWallet.writeContract({
      address: UNIVERSAL_ROUTER,
      abi: universalRouterAbi,
      functionName: 'execute',
      args: [commands, inputs, deadline],
    });
    log(`Swap submitted tx=${swapHash}`);
    const swapRcpt = await serverPublic.waitForTransactionReceipt({ hash: swapHash });
    log(`Swap confirmed at block=${swapRcpt.blockNumber}`);

    // STEP 4: Optionally unwrap WMON
    let unwrapHash: `0x${string}` | null = null;
    let unwrapRcpt: any = null;
    if (unwrap) {
      log('Checking WMON balance for unwrap...');
      const wmonBal = (await serverPublic.readContract({
        address: WMON,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [serverWallet.account.address],
      })) as bigint;

      if (wmonBal > 0n) {
        log(`Unwrapping WMON amount=${wmonBal.toString()}...`);
        unwrapHash = await serverWallet.writeContract({
          address: WMON,
          abi: wmonAbi,
          functionName: 'withdraw',
          args: [wmonBal],
        });
        log(`Unwrap submitted tx=${unwrapHash}`);
        unwrapRcpt = await serverPublic.waitForTransactionReceipt({ hash: unwrapHash });
        log(`Unwrap confirmed at block=${unwrapRcpt.blockNumber}`);
      } else {
        log('No WMON balance to unwrap, skipping');
      }
    }

    log('Unstake flow complete');
    if (opId) endLog(opId);

    return NextResponse.json({
      ok: true,
      approvals: {
        smon: {
          erc20: approvals.erc20,
          permit2: approvals.permit2,
        },
      },
      swap: { hash: swapHash, receipt: toJSONSafe(swapRcpt) },
      unwrap: unwrapHash ? { hash: unwrapHash, receipt: toJSONSafe(unwrapRcpt) } : null,
    });
  } catch (e: any) {
    if (opId) {
      emitLog(opId, `Error: ${e?.message ?? String(e)}`);
      endLog(opId);
    }
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
