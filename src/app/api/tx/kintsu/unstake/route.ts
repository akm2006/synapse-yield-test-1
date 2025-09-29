// src/app/api/tx/kintsu/unstake/route.ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import type { Address } from 'viem';
import { encodeAbiParameters } from 'viem';
import { serverWallet, serverPublic } from '@/lib/serverClients';
import { toJSONSafe } from '@/lib/json';

// Configure these from your app config/constants.
const UNIVERSAL_ROUTER = '0x94D220C58A23AE0c2eE29344b00A30D1c2d9F1bc' as Address; // Pancake UR on Monad testnet
const SMON = '0xe1d2439b75fb9746E7Bc6cB777Ae10AA7f7ef9c5' as Address;         // sMON (Kintsu StakedMonad)
const WMON = '0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701' as Address;        // WMON

// Universal Router ABI (execute with deadline)
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

// WMON withdraw ABI
const wmonAbi = [
  { type: 'function', name: 'withdraw', stateMutability: 'nonpayable', inputs: [{ name: 'wad', type: 'uint256' }], outputs: [] },
] as const;

// Command byte for V3 exact-in swap (flag 0 + command code 0x00)
const CMD_V3_SWAP_EXACT_IN = '0x00' as `0x${string}`;

// Helper: encode a single-hop v3 path tokenIn | fee(3 bytes) | tokenOut
function encodeV3Path(tokenIn: Address, tokenOut: Address, fee: number): `0x${string}` {
  const feeHex = fee.toString(16).padStart(6, '0');
  return (`0x${tokenIn.slice(2)}${feeHex}${tokenOut.slice(2)}`) as `0x${string}`;
}

// Helper: encode inputs for V3_SWAP_EXACT_IN
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

/**
 * POST body JSON:
 * {
 *   "amountIn": "10000000000000000",      // sMON in wei (bigint string)
 *   "minOut": "0",                        // WMON min out (set via quoter for prod)
 *   "fee": 2500,                          // v3 fee tier (e.g. 2500 = 0.25%)
 *   "recipient": "0x...",                 // receiving EOA (same as app account)
 *   "unwrap": true,                       // if true, unwrap WMON -> MON after swap
 *   "deadlineSec": 1800                   // optional seconds from now (default 1800)
 * }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const amountIn = BigInt(body.amountIn as string);
    const minOut = BigInt((body.minOut as string) ?? '0');
    const fee = Number(body.fee ?? 2500);
    const recipient = body.recipient as Address;
    const unwrap = Boolean(body.unwrap ?? true);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + Number(body.deadlineSec ?? 1800));

    // 1) Build single-hop v3 path: sMON -> WMON
    const path = encodeV3Path(SMON, WMON, fee);

    // 2) Build commands & inputs (single command: V3_SWAP_EXACT_IN with payerIsUser=true)
    const commands = CMD_V3_SWAP_EXACT_IN;
    const inputSwap = encodeV3SwapExactInInput({
      recipient,
      amountIn,
      amountOutMin: minOut,
      path,
      payerIsUser: true,
    });
    const inputs = [inputSwap] as `0x${string}`[];

    // 3) Execute Universal Router swap
    const swapHash = await serverWallet.writeContract({
      address: UNIVERSAL_ROUTER,
      abi: universalRouterAbi,
      functionName: 'execute',
      args: [commands, inputs, deadline],
      // No msg.value for ERC20→ERC20
    });
    const swapRcpt = await serverPublic.waitForTransactionReceipt({ hash: swapHash });

    // 4) Optionally unwrap WMON -> MON to recipient
    let unwrapHash: `0x${string}` | null = null;
    let unwrapRcpt: any = null;
    if (unwrap) {
      // In a minimal flow, unwrap the same amount as minOut or let the user unwrap later.
      // For production, read WMON balance and unwrap exact balance.
      // Here we unwrap minOut (if > 0), otherwise skip unwrap.
      if (minOut > 0n) {
        unwrapHash = await serverWallet.writeContract({
          address: WMON,
          abi: wmonAbi,
          functionName: 'withdraw',
          args: [minOut],
        });
        unwrapRcpt = await serverPublic.waitForTransactionReceipt({ hash: unwrapHash });
      }
    }

    return NextResponse.json({
      ok: true,
      swap: { hash: swapHash, receipt: toJSONSafe(swapRcpt) },
      unwrap: unwrapHash ? { hash: unwrapHash, receipt: toJSONSafe(unwrapRcpt) } : null,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
