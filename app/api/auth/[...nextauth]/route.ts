import NextAuth, { AuthOptions, Account, User } from "next-auth";
import { JWT } from "next-auth/jwt";
import GoogleProvider from "next-auth/providers/google";

// 必要なスコープを定数で管理
const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

// Googleからのトークンレスポンスの型定義
interface GoogleTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  error?: string;
}

if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
  throw new Error("Google Client ID and Secret must be defined in .env.local");
}

/**
 * アクセストークンをリフレッシュする関数
 */
async function refreshAccessToken(token: JWT): Promise<JWT> {
  try {
    if (!token.refreshToken) {
      throw new Error("No refresh token available");
    }

    const url = "https://oauth2.googleapis.com/token";
    const params = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
      refresh_token: token.refreshToken,
    });

    const response = await fetch(url, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
      body: params,
    });

    // レスポンスに型を適用（any回避）
    const refreshedTokens = (await response.json()) as GoogleTokenResponse;

    if (!response.ok) {
      throw refreshedTokens;
    }

    return {
      ...token,
      accessToken: refreshedTokens.access_token,
      expiresAt: Date.now() + refreshedTokens.expires_in * 1000,
      // 新しいリフレッシュトークンがあれば更新、なければ既存のものを使用
      refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
    };
  } catch (error) {
    console.error("RefreshAccessTokenError", error);
    return {
      ...token,
      error: "RefreshAccessTokenError",
    };
  }
}

export const authOptions: AuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: GOOGLE_SCOPES.join(" "),
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, user }) {
      // 1. 初回ログイン時
      if (account && user) {
        return {
          accessToken: account.access_token,
          expiresAt: (account.expires_at ?? 0) * 1000,
          refreshToken: account.refresh_token,
          user,
        };
      }

      // 2. 有効期限内
      if (token.expiresAt && Date.now() < token.expiresAt) {
        return token;
      }

      // 3. 期限切れ（リフレッシュ実行）
      return await refreshAccessToken(token);
    },

    async session({ session, token }) {
      // 型定義拡張により、これらのプロパティは型安全にアクセス可能
      session.accessToken = token.accessToken;
      
      // session.error は型定義に追加されているため、anyキャストは不要
      if (token.error) {
        session.error = token.error;
      }
      
      return session;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };