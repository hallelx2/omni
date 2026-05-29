import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // This app lives inside the omni monorepo (which has its own bun.lock); pin
  // the Turbopack root to docs-site so Next stops inferring the parent repo.
  turbopack: {
    root: import.meta.dirname,
  },
};

export default withMDX(config);
