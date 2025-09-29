// src/app/api/tx/kintsu/redeem/route.ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import type { Address } from 'viem';
import { serverWallet, serverPublic } from '@/lib/serverClients';
import { kintsuAbi } from '@/lib/abis';
import { CONTRACTS } from '@/lib/contracts';
import { toJSONSafe } from '@/lib/json';

export async function POST(req: Request) {
  try {
    const { unlockIndex, receiver } = (await req.json()) as { unlockIndex: string; receiver: Address };
    const idx = BigInt(unlockIndex);
    const hash = await serverWallet.writeContract({
      address: CONTRACTS.KINTSU as Address,
      abi: kintsuAbi,
      functionName: 'redeem',
      args: [idx, receiver],
    });
    const receipt = await serverPublic.waitForTransactionReceipt({ hash });
    return NextResponse.json({ ok: true, hash, receipt: toJSONSafe(receipt) });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
