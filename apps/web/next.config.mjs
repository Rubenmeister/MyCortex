/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@mycortex/ui', '@mycortex/db', '@mycortex/shared-types'],

  // Skip the Next.js-internal TypeScript validation step during `next build`.
  //
  // Why: in this monorepo Vercel's auto-detected build can run `turbo build`
  // (no filter) which compiles the api too. Next.js's post-compile tsc then
  // unexpectedly sees apps/api source files and fails on lib differences
  // (e.g. node-only Response). Real type checking is enforced separately by
  // `pnpm type-check` (10/10 workspaces) — this flag only disables the
  // duplicate, monorepo-leaky check inside next build itself.
  typescript: { ignoreBuildErrors: true },

  // Same reasoning for ESLint — runs separately via `pnpm lint`.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
