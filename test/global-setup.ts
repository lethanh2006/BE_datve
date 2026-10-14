import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { applyTestEnv } from './env';

export default function globalSetup() {
  applyTestEnv();
  execFileSync('node', [path.join(__dirname, '..', 'scripts', 'migrate.js')], {
    env: { ...process.env, MIGRATE_CREATE_DB: 'true' },
    stdio: 'inherit',
  });
}
