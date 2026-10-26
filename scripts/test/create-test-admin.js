const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

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
