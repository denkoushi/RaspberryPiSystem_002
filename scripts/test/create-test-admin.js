const { PrismaPg } = require('@prisma/adapter-pg');
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const databaseUrl = new URL(process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/borrow_return');
const max = Number(databaseUrl.searchParams.get('connection_limit') ?? process.env.DATABASE_PRISMA_CONNECTION_LIMIT ?? 10);
const timeouts = [
  Number(databaseUrl.searchParams.get('pool_timeout') ?? process.env.DATABASE_PRISMA_POOL_TIMEOUT_SECONDS ?? 20),
  Number(databaseUrl.searchParams.get('connect_timeout') ?? process.env.DATABASE_PRISMA_CONNECT_TIMEOUT_SECONDS ?? 10)
].filter((value) => value > 0);
for (const key of ['connection_limit', 'pool_timeout', 'connect_timeout']) databaseUrl.searchParams.delete(key);
// Standalone JavaScript entry point: same bounded pg pool policy as src/lib/prisma-client.ts.
const prisma = new PrismaClient({ adapter: new PrismaPg({
  connectionString: databaseUrl.toString(), max,
  connectionTimeoutMillis: timeouts.length ? Math.min(...timeouts) * 1000 : 0
}) });

async function createTestAdmin() {
  try {
    const username = 'test-admin-phase3';
    const password = 'test-admin-123';
    
    // 既存のユーザーを確認
    const existing = await prisma.user.findUnique({
      where: { username }
    });
    
    if (existing) {
      console.log(JSON.stringify({ 
        username: existing.username, 
        password,
        id: existing.id,
        message: 'User already exists'
      }));
      await prisma.$disconnect();
      return;
    }
    
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash,
        role: 'ADMIN',
        status: 'ACTIVE'
      }
    });
    
    console.log(JSON.stringify({ 
      username: user.username, 
      password,
      id: user.id 
    }));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message }));
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

createTestAdmin();
