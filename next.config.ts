import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // libSQL bringt native Bindings mit und darf nicht gebündelt werden.
  serverExternalPackages: ["@libsql/client", "libsql"],
};

export default nextConfig;
