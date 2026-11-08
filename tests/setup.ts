// Keeps test output quiet and provides a valid environment for code that calls getEnv().
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-test-access-secret-0123";
// Pin the booking rules so slot and buffer expectations do not depend on the developer's .env.
process.env.SLOT_STEP_MINUTES = "30";
process.env.BOOKING_BUFFER_MINUTES = "15";
process.env.MAX_ADVANCE_DAYS = "60";
process.env.CANCEL_MIN_HOURS_BEFORE = "0";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-test-refresh-secret-0123";
// Integration tests talk to the dedicated test database only.
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? "postgresql://unused:unused@127.0.0.1:1/unused";
