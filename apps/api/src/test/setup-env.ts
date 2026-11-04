import { applyPerWorkerTestEnv } from './per-worker-db.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';
// API_TEST_PER_WORKER_DB=1 only: route this worker to its own database and storage paths
// before any test file imports lib/prisma.
applyPerWorkerTestEnv();
