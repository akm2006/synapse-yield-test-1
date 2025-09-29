// src/app/page.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { publicClient, walletClient } from '@/lib/client';
import { CONTRACTS } from '@/lib/contracts';
import { erc20Abi } from '@/lib/abis';
import type { Address } from 'viem';
import { formatUnits } from 'viem';

export default function Home() {
  const [balances, setBalances] = useState({ native: '0', kintsu: '0', magma: '0' });
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const unwatchRef = useRef<null | (() => void)>(null);
  const pollRef = useRef<null | number>(null);

  function log(msg: string) {
    setLogs((prev) => [...prev, msg]);
    console.log(msg);
  }

  // Force fresh API calls (no Next.js cache)
  async function postJSON(path: string, body: any) {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      cache: 'no-store',
      next: { revalidate: 0 },
      body: JSON.stringify(body),
    });
    return res.json();
  }

  // Fetch MON, sMON (Kintsu), gMON (Magma) balances
  async function fetchBalances() {
    setLoading(true);
    try {
      const address: Address = walletClient.account.address;
      log(`[INFO] Fetching balances for account ${address}`);

      // 1) Batch ERC-20 reads via multicall (sMON & gMON)
      // If multicall is not available on the chain, we fallback to two readContract calls.
      let sMonRaw = 0n;
      let gMonRaw = 0n;
      try {
        const tokenReads = await publicClient.multicall({
          contracts: [
            {
              address: CONTRACTS.KINTSU as Address, // sMON token (StakedMonad)
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [address],
            },
            {
              address: CONTRACTS.GMON as Address, // gMON token
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [address],
            },
          ],
        });
        sMonRaw = tokenReads[0]?.status === 'success' ? (tokenReads[0].result as bigint) : 0n;
        gMonRaw = tokenReads[1]?.status === 'success' ? (tokenReads[1].result as bigint) : 0n;
      } catch (e) {
        log('[WARN] multicall failed; falling back to single reads');
        sMonRaw = (await publicClient.readContract({
          address: CONTRACTS.KINTSU as Address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        })) as bigint;
        gMonRaw = (await publicClient.readContract({
          address: CONTRACTS.GMON as Address,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        })) as bigint;
      }

      // 2) Native MON is not ERC-20; use getBalance
      const nativeRaw = await publicClient.getBalance({ address });

      setBalances({
        native: formatUnits(nativeRaw, 18),
        kintsu: formatUnits(sMonRaw, 18),
        magma: formatUnits(gMonRaw, 18),
      });

      log(
        `[INFO] Balances: MON=${formatUnits(nativeRaw, 18)} sMON=${formatUnits(
          sMonRaw,
          18
        )} gMON=${formatUnits(gMonRaw, 18)}`
      );
    } catch (err: any) {
      log(`[ERROR] fetchBalances error: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  }

  // Actions (server-routed writes)
  async function stakeMagma(amount: string) {
    log(`[ACTION] Stake Magma (server): ${amount}`);
    const json = await postJSON('/api/tx/magma/stake', { amount });
    if (!json.ok) return log(`[ERROR] stakeMagma: ${json.error}`);
    log(`[TX] stakeMagma hash: ${json.hash}`);
    log(`[TX] stakeMagma confirmed at block: ${json.receipt.blockNumber}`);
    await fetchBalances();
  }

  async function unstakeMagma(amount: string) {
    log(`[ACTION] Unstake Magma (server): ${amount}`);
    const json = await postJSON('/api/tx/magma/withdraw', { amount });
    if (!json.ok) return log(`[ERROR] unstakeMagma: ${json.error}`);
    log(`[TX] unstakeMagma hash: ${json.hash}`);
    log(`[TX] unstakeMagma confirmed at block: ${json.receipt.blockNumber}`);
    await fetchBalances();
  }

  async function stakeKintsu(amount: string) {
    const receiver = walletClient.account.address;
    log(`[ACTION] Stake Kintsu (server): ${amount}`);
    const json = await postJSON('/api/tx/kintsu/deposit', { amount, receiver });
    if (!json.ok) return log(`[ERROR] stakeKintsu: ${json.error}`);
    log(`[TX] stakeKintsu hash: ${json.hash}`);
    log(`[TX] stakeKintsu confirmed at block: ${json.receipt.blockNumber}`);
    await fetchBalances();
  }

  async function unstakeKintsu(amount: string) {
    try {
      const amountInWei = BigInt(Math.floor(+amount * 1e18)).toString();
      const minOutWei = (BigInt(amountInWei) * 99n) / 100n + ''; // 1% slippage buffer for prototype
      const fee = 2500;
      const recipient = walletClient.account.address;

      log(`[ACTION] Kintsu Instant Unstake via Pancake (server): ${amount}`);
      const json = await postJSON('/api/tx/kintsu/unstake', {
        amountIn: amountInWei,
        minOut: minOutWei,
        fee,
        recipient,
        unwrap: true,
        deadlineSec: 1800,
      });
      if (!json.ok) return log(`[ERROR] Unstake Kintsu: ${json.error}`);
      log(`[TX] UR swap hash: ${json.swap.hash}`);
      log(
        `[TX] UR swap confirmed at block: ${json.swap.receipt.blockNumber}`
      );
      if (json.unwrap) {
        log(`[TX] WMON unwrap hash: ${json.unwrap.hash}`);
        log(
          `[TX] WMON unwrap confirmed at block: ${json.unwrap.receipt.blockNumber}`
        );
      }
      await fetchBalances();
    } catch (err: any) {
      log(`[ERROR] Unstake Kintsu flow: ${err.message || err}`);
    }
  }

  async function rebalance() {
    setLoading(true);
    log('[ACTION] Starting rebalance');
    try {
      if (parseFloat(balances.kintsu) > 0.0001) {
        log('[INFO] Rebalancing from Kintsu → Magma');
        await unstakeKintsu(balances.kintsu);
        await stakeMagma(balances.kintsu);
      } else if (parseFloat(balances.magma) > 0.0001) {
        log('[INFO] Rebalancing from Magma → Kintsu');
        await unstakeMagma(balances.magma);
        await stakeKintsu(balances.magma);
      } else {
        log('[INFO] No funds to rebalance');
      }
    } catch (err: any) {
      log(`[ERROR] Rebalance error: ${err.message || err}`);
    } finally {
      await fetchBalances();
      setLoading(false);
    }
  }

  // Initial fetch + live updates (polling block number for HTTP transports)
  useEffect(() => {
    fetchBalances();

    // Prefer explicit block-number polling to ensure freshness on HTTP RPCs.
    try {
      const unwatch = publicClient.watchBlockNumber({
        poll: true,
        pollingInterval: 1500,
        onBlockNumber: async () => {
          // small debounce via loading gate
          if (!loading) await fetchBalances();
        },
        onError: (e) => log(`[WARN] watchBlockNumber error: ${e?.message || e}`),
      });
      unwatchRef.current = unwatch;
    } catch (e: any) {
      log('[WARN] watchBlockNumber unsupported, enabling polling fallback');
      pollRef.current = window.setInterval(fetchBalances, 4000);
    }

    // Listen to provider events (account/chain changes) for immediate refresh.
    const eth = (window as any).ethereum;
    const onAccounts = () => fetchBalances();
    const onChain = () => fetchBalances();
    if (eth?.on) {
      eth.on('accountsChanged', onAccounts);
      eth.on('chainChanged', onChain);
    }

    return () => {
      if (unwatchRef.current) unwatchRef.current();
      if (pollRef.current) window.clearInterval(pollRef.current);
      if (eth?.removeListener) {
        eth.removeListener('accountsChanged', onAccounts);
        eth.removeListener('chainChanged', onChain);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="p-8 max-w-xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Phase 1: EOA Balance Dashboard</h1>

      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-2">Account:</h2>
        <p className="break-all font-mono">{walletClient.account.address}</p>
      </section>

      <section className="mb-3">
        <button
          className="px-3 py-2 bg-gray-700 text-white rounded"
          onClick={() => fetchBalances()}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh balances'}
        </button>
      </section>

      <section className="mb-6">
        <h2 className="text-xl font-semibold mb-3">Balances:</h2>
        {loading ? (
          <p>Loading balances…</p>
        ) : (
          <ul className="space-y-1 text-lg">
            <li>MON: <b>{balances.native}</b></li>
            <li>sMON: <b>{balances.kintsu}</b></li>
            <li>gMON: <b>{balances.magma}</b></li>
          </ul>
        )}
      </section>

      <section className="mb-6 space-y-2">
        <h2 className="text-xl font-semibold mb-2">Actions:</h2>
        <button
          className="w-full px-4 py-3 bg-blue-600 text-white rounded shadow"
          onClick={() => stakeMagma('0.01')}
          disabled={loading}
        >
          Stake 0.01 MON → gMON
        </button>
        <button
          className="w-full px-4 py-3 bg-blue-600 text-white rounded shadow"
          onClick={() => unstakeMagma('0.01')}
          disabled={loading}
        >
          Unstake 0.01 gMON → MON
        </button>
        <button
          className="w-full px-4 py-3 bg-green-600 text-white rounded shadow"
          onClick={() => stakeKintsu('0.02')}
          disabled={loading}
        >
          Stake 0.02 MON → sMON
        </button>
        <button
          className="w-full px-4 py-3 bg-green-600 text-white rounded shadow"
          onClick={() => unstakeKintsu('0.01')}
          disabled={loading}
        >
          Instant Unstake 0.01 sMON → MON
        </button>
      </section>

      <section className="mb-6">
        <button
          className="w-full px-6 py-4 bg-purple-700 text-white rounded-lg font-semibold text-lg"
          onClick={rebalance}
          disabled={loading}
        >
          {loading ? 'Rebalancing…' : 'Rebalance All Funds'}
        </button>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-2">Logs:</h2>
        <div className="bg-gray-600 p-3 rounded h-72 overflow-y-auto font-mono text-sm">
          {logs.length === 0 ? (
            <p className="italic text-gray-300">No logs yet. Actions will be logged here.</p>
          ) : (
            logs.map((log, idx) => <div key={idx}>{log}</div>)
          )}
        </div>
      </section>
    </main>
  );
}
