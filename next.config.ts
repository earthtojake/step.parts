import type { NextConfig } from "next";

const corsHeaders = [
  {
    key: "Access-Control-Allow-Origin",
    value: "*",
  },
  {
    key: "Access-Control-Allow-Methods",
    value: "GET, POST, OPTIONS",
  },
  {
    key: "Access-Control-Allow-Headers",
    value: "Accept, Content-Type",
  },
  {
    key: "Access-Control-Expose-Headers",
    value: "Content-Disposition, Content-Length, ETag, Last-Modified, Location",
  },
  {
    key: "Access-Control-Max-Age",
    value: "86400",
  },
];

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  outputFileTracingIncludes: {
    "/**": ["./catalog/parts.sqlite"],
  },
  async headers() {
    return [
      {
        source: "/v1/:path*",
        headers: corsHeaders,
      },
      {
        source: "/catalog/:path*",
        headers: corsHeaders,
      },
      {
        source: "/llms.txt",
        headers: corsHeaders,
      },
      {
        source: "/step/:path*",
        headers: corsHeaders,
      },
    ];
  },
};

export default nextConfig;
