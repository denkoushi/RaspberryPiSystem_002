import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../app.js';
import { createAuthHeader, createTestUser } from './helpers.js';

process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/borrow_return';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-1234567890';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-1234567890';

describe('GET /api/signage/schedules', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return schedules without authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/signage/schedules',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('schedules');
    expect(Array.isArray(body.schedules)).toBe(true);
  });
});

describe('GET /api/signage/content', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return content without authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/signage/content',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('contentType');
    expect(body).toHaveProperty('displayMode');
  });
});

describe('GET /api/signage/emergency', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return emergency status without authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/signage/emergency',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('enabled');
  });
});

describe('POST /api/signage/schedules', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should create a schedule with authentication', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { ...createAuthHeader(adminToken), 'Content-Type': 'application/json' },
      payload: {
        name: 'Test Schedule',
        contentType: 'TOOLS',
        dayOfWeek: [1, 2, 3, 4, 5],
        startTime: '09:00',
        endTime: '18:00',
        priority: 0,
        enabled: true,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('schedule');
    expect(body.schedule.name).toBe('Test Schedule');
  });

  it('should return 401 without authentication', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/signage/schedules',
      headers: { 'Content-Type': 'application/json' },
      payload: {
        name: 'Test Schedule',
        contentType: 'TOOLS',
        dayOfWeek: [1, 2, 3, 4, 5],
        startTime: '09:00',
        endTime: '18:00',
        priority: 0,
      },
    });

    expect(response.statusCode).toBe(401);
  });
});

describe('GET /api/signage/pdfs', () => {
  let app: Awaited<ReturnType<typeof buildServer>>;
  let closeServer: (() => Promise<void>) | null = null;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildServer();
    closeServer = async () => {
      await app.close();
    };
  });

  beforeEach(async () => {
    const admin = await createTestUser('ADMIN');
    adminToken = admin.token;
  });

  afterAll(async () => {
    if (closeServer) {
      await closeServer();
    }
  });

  it('should return pdfs with authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/signage/pdfs',
      headers: createAuthHeader(adminToken),
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toHaveProperty('pdfs');
    expect(Array.isArray(body.pdfs)).toBe(true);
  });

  it('should return 401 without authentication', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/signage/pdfs',
    });

    expect(response.statusCode).toBe(401);
  });
});

