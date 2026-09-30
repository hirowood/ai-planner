// route は import 時に環境変数の有無を検査して throw する。テストでは偽の値を入れる。
// 値は偽物 (fake-*) で、どこにも接続しない (外部呼び出しは差し替え済み + no-network で遮断)。
process.env.GOOGLE_API_KEY ??= "fake-google-api-key-for-tests";
process.env.GOOGLE_CLIENT_ID ??= "fake-google-client-id-for-tests";
process.env.GOOGLE_CLIENT_SECRET ??= "fake-google-client-secret-for-tests";
process.env.NEXTAUTH_SECRET ??= "fake-nextauth-secret-for-tests";
