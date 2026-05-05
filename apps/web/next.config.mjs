/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@mycortex/ui', '@mycortex/db', '@mycortex/shared-types'],
};

export default nextConfig;
