import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts'
  },
  // Generation in the image build does not need a database URL.
  datasource: { url: process.env.DATABASE_URL }
});
