import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  // Base path for GitHub Pages (repo name)
  basePath: process.env.NODE_ENV === 'production' ? '/proqpay-lite' : '',
  assetPrefix: process.env.NODE_ENV === 'production' ? '/proqpay-lite/' : '',
};

export default nextConfig;