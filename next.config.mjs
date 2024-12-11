/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    outputFileTracingIncludes: {
      "/api/pages/*": ["./node_modules/mupdf/lib/*.wasm"],
    },
    missingSuspenseWithCSRBailout: false,
  },
  output: "standalone",
};

export default nextConfig;
