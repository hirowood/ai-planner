// next-auth の差し替え。テストは `authState.session` にセッションを入れて getServerSession の戻り値を決める。
import { vi } from "vitest";

export type FakeSession = { user?: { name?: string }; accessToken?: string } | null;

export const authState: { session: FakeSession } = { session: null };

export const nextAuthMock = {
  getServerSession: vi.fn(async () => authState.session),
};

// route が import する authOptions は中身を使わない (getServerSession が差し替わっているため)
export const authRouteMock = { authOptions: {} };

export function signedIn(accessToken = "fake-access-token-for-tests"): FakeSession {
  return { user: { name: "test user" }, accessToken };
}
