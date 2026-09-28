import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // NTLM-client niet bundelen (gebruikt Node-modules en keep-alive sockets).
  serverExternalPackages: ["httpntlm"],
  experimental: {
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
