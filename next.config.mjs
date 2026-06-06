/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Debug recorder posts screen-recording blobs; allow a generous body on server actions
  // (route handlers parse multipart themselves, so this is just a safety margin).
  experimental: {
    serverActions: { bodySizeLimit: "50mb" },
  },
};

export default nextConfig;
