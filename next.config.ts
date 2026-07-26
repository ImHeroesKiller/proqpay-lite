import type { NextConfig } from 'next';

// GitHub Pages serves under /proqpay-lite
// Set GITHUB_PAGES=true in CI, or detect production build
const isGhPages = process.env.GITHUB_PAGES === 'true' || process.env.NODE_ENV === 'production';

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
