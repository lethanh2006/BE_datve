/** Biến môi trường cho e2e test. process.env có sẵn luôn được ưu tiên hơn giá trị mặc định ở đây. */
export function applyTestEnv() {
  const dbName = process.env.TEST_DB_NAME ?? 'datve_nest_test';
  // Test sẽ TRUNCATE toàn bộ bảng nên tuyệt đối không chạy trên database thật
  if (!/test/i.test(dbName)) {
    throw new Error(`TEST_DB_NAME phải chứa "test" (đang là "${dbName}")`);
  }
  process.env.DB_NAME = dbName;
  process.env.JWT_SECRET ??= 'e2e-test-secret-e2e-test-secret-e2e-test-secret';
  process.env.THROTTLE_DISABLED = 'true';
  process.env.SCHEDULER_ENABLED = 'false';
  process.env.PAYMENT_MOCK_DELAY_MS = '0';
  process.env.PAYMENT_ALLOW_SIMULATION = 'true';
}
