// src/lib/serverClients.ts (server-only)
import { createWalletClient, createPublicClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { monadTestnet } from './chain';

const rpc = process.env.NEXT_PUBLIC_RPC_URL!;
const pk = process.env.NEXT_PUBLIC_EOA_PRIVATE_KEY!;
export const serverWallet = createWalletClient({
  chain: monadTestnet,
  transport: http(rpc),
  account: privateKeyToAccount(pk as `0x${string}`),
});
export const serverPublic = createPublicClient({
  chain: monadTestnet,
  transport: http(rpc),
});
