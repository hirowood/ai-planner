import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ここから追加
  async headers() {
    return [
      {
        source: '/:path*', // 全てのページに適用
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload' // HTTPS強制
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff' // ファイル形式の偽装防止
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY' // 他のサイトに埋め込ませない（クリックジャッキング対策）
          },
          {
            key: 'Referrer-Policy',
            value: 'origin-when-cross-origin'
          }
        ]
      }
    ];
  }
  // ここまで追加
};

export default nextConfig;