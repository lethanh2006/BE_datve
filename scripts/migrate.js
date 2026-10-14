// Chạy các file SQL trong db/migrations theo thứ tự tên, mỗi file chỉ chạy một lần.
//
// - Nếu database còn lịch sử Flyway của bản Java (flyway_schema_history), các migration
//   Flyway đã áp dụng sẽ được ghi nhận là đã chạy để không tạo lại bảng.
// - MIGRATE_CREATE_DB=true: tự tạo database nếu chưa tồn tại (dùng cho test/CI).
require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const connection = (database) => ({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USERNAME || 'datve_user',
  password: process.env.DB_PASSWORD || 'local_dev_only_12345',
  database,
});

async function createDatabaseIfMissing(name) {
  const admin = new Client(connection('postgres'));
  await admin.connect();
  try {
    const found = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (!found.rowCount) {
      if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error(`Tên database không hợp lệ: ${name}`);
      await admin.query(`CREATE DATABASE ${name}`);
      console.log('Đã tạo database', name);
    }
  } finally {
    await admin.end();
  }
}

async function migrate() {
  const dbName = process.env.DB_NAME || 'datve_db';
  if (process.env.MIGRATE_CREATE_DB === 'true') await createDatabaseIfMissing(dbName);

  const client = new Client(connection(dbName));
  await client.connect();
  try {
    await client.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );

    const flyway = await client.query("SELECT to_regclass('public.flyway_schema_history') AS t");
    if (flyway.rows[0].t) {
      const applied = await client.query(
        "SELECT script FROM flyway_schema_history WHERE success AND script LIKE '%.sql'",
      );
      for (const { script } of applied.rows) {
        const res = await client.query(
          'INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING',
          [script],
        );
        if (res.rowCount) console.log('Ghi nhận migration Flyway đã chạy:', script);
      }
    }

    const dir = path.join(__dirname, '..', 'db', 'migrations');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      const done = await client.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (done.rowCount) continue;
      console.log('Áp dụng', file);
      await client.query('BEGIN');
      try {
        await client.query(fs.readFileSync(path.join(dir, file), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      }
    }
  } finally {
    await client.end();
  }
  console.log('Migration xong');
}

module.exports = { migrate };

if (require.main === module) {
  migrate().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
