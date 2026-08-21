import type { NextConfig } from 'next';

// Only GitHub Pages needs /proqpay-lite prefix.
// Cloudflare Pages and local production builds use the root path.
const isGhPages = process.env.GITHUB_PAGES === 'true';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  basePath: isGhPages ? '/proqpay-lite' : '',
  assetPrefix: isGhPages ? '/proqpay-lite/' : '',
};

export default nextConfig;
