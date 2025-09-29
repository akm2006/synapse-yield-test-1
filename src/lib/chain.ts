// src/lib/chain.ts
import type { Chain } from 'viem';

export const monadTestnet: Chain = {
  id: 10143, // Chain ID
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [process.env.NEXT_PUBLIC_RPC_URL!] } },
};
