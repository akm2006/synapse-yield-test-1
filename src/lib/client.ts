// src/lib/client.ts
import { Address, createPublicClient, createWalletClient, custom, http } from 'viem';
import { mainnet } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL as Address; // cast to Address string literal
const eoaKey = process.env.NEXT_PUBLIC_EOA_PRIVATE_KEY!;
if (!rpcUrl) throw new Error('Missing NEXT_PUBLIC_RPC_URL');
if (!eoaKey) throw new Error('Missing EOA_PRIVATE_KEY');
export const walletClient = createWalletClient({
  chain: { ...mainnet, rpcUrls: { default: { http: [rpcUrl] } } },
  transport: http(),
  account: privateKeyToAccount(eoaKey as `0x${string}`),
});

export const publicClient =
  typeof window !== 'undefined' && (window as any).ethereum // see next fix
    ? createPublicClient({
        chain: { ...mainnet, rpcUrls: { default: { http: [rpcUrl] } } },
        transport: custom((window as any).ethereum),
      })
    : createPublicClient({
        chain: { ...mainnet, rpcUrls: { default: { http: [rpcUrl] } } },
        transport: http(),
      });
