// src/app/api/tx/magma/withdraw/route.ts
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import type { Address } from 'viem';
import { serverWallet, serverPublic } from '@/lib/serverClients';
import { magmaAbi } from '@/lib/abis';
import { CONTRACTS } from '@/lib/contracts';
import { toJSONSafe } from '@/lib/json';

export async function POST(req: Request) {
  try {
    const { amount } = (await req.json()) as { amount: string };
    const amt = BigInt(Math.floor(+amount * 1e18));
    const hash = await serverWallet.writeContract({
      address: CONTRACTS.MAGMA_STAKE as Address,
      abi: magmaAbi,
      functionName: 'withdrawMon',
      args: [amt],
    });
    const receipt = await serverPublic.waitForTransactionReceipt({ hash });
    return NextResponse.json({ ok: true, hash, receipt: toJSONSafe(receipt) });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
