const { existsSync, readFileSync } = require('fs');
const { resolve } = require('path');

// Manually load env.s3 config (if present)
const envS3Path = resolve(__dirname, 'env.s3');
if (existsSync(envS3Path)) {
  const content = readFileSync(envS3Path, 'utf-8');
  content.split('\n').forEach(line => {
    line = line.trim();
    if (line && !line.startsWith('#')) {
      const eqIndex = line.indexOf('=');
      if (eqIndex > 0) {
        const key = line.substring(0, eqIndex).trim();
        let value = line.substring(eqIndex + 1).trim();
        // Only set env vars that are not already defined
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  });
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone', // Enable standalone output mode for Docker

  // Ensure pdfjs-dist is loaded correctly on the client
  transpilePackages: ['pdfjs-dist'],

  // Security headers configuration
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()'
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com",
              "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
              "img-src 'self' data: https: blob:",
              "font-src 'self' data: https://unpkg.com https://fonts.gstatic.com https://cdn.jsdelivr.net",
              "connect-src 'self' ws://localhost:1234 wss://localhost:1234 https://openrouter.ai https://*.amazonaws.com https://unpkg.com https://github.com https://api.github.com",
              "frame-src 'self' https://embed.diagrams.net",
              "worker-src 'self' blob: https://unpkg.com",
            ].join('; ')
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload'
          },
        ],
      },
    ];
  },

  webpack: (config, { isServer }) => {
    // Fix Yjs issues in SSR
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
    };

    // Ensure pdfjs-dist ESM is resolved correctly
    config.resolve.alias = {
      ...config.resolve.alias,
      // Ensure we use the correct entry file
      'pdfjs-dist': 'pdfjs-dist/build/pdf.mjs',
    };

    // Client-only: ensure the canvas module is not bundled (PDF.js may try to import it)
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        canvas: false,
        encoding: false,
      };
    }

    return config;
  },
};

module.exports = nextConfig;
