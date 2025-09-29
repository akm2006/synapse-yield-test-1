import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
};
module.exports = {
  reactStrictMode: true,
  env: {
    RPC_URL: process.env.NEXT_PUBLIC_RPC_URL,
    EOA_KEY: process.env.EOA_PRIVATE_KEY,
  },
};
export default nextConfig;
