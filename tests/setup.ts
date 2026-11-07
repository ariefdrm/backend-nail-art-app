// Keeps test output quiet and provides a valid environment for code that calls getEnv().
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-test-access-secret-0123";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-test-refresh-secret-0123";
// Integration tests talk to the dedicated test database only.
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? "postgresql://unused:unused@127.0.0.1:1/unused";
