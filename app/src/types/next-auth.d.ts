import NextAuth, { DefaultSession } from "next-auth"
import { JWT } from "next-auth/jwt"

// Sessionの型を拡張して accessToken を追加
declare module "next-auth" {
  interface Session {
    accessToken?: string
  }
}

// JWTの型を拡張して accessToken を追加
declare module "next-auth/jwt" {
  interface JWT {
    accessToken?: string
  }
}