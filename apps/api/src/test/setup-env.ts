process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

// 世代トークンの raw mail キャッシュはテスト間で共有されるため既定で無効化（キャッシュ自体は専用テストで検証）。
process.env.LEADERBOARD_MAIL_REVISION_CACHE_TTL_MS ??= '0';
