import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  reactCompiler: true,
  serverExternalPackages: [
    "imapflow",
    "nodemailer",
    "mailparser",
    "@modelcontextprotocol/server",
  ],
};

export default nextConfig;
