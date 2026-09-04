import { Hono } from 'hono';
import { cors } from 'hono/cors';

const app = new Hono<{
  Bindings: { DB: D1Database };
  Variables: { userId: string };
}>();

// CORS for PWA
app.use('/*', cors({
  origin: (origin) => origin || '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

// Auth middleware
const AUTH_HEADER = 'Authorization';

app.use('*', async (c, next) => {
  const url = new URL(c.req.url);
  if (url.pathname.startsWith('/api/')) {
    const token = c.req.header(AUTH_HEADER) || '';
    if (!token && url.pathname !== '/api/auth/login') {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    if (token) {
      const result = await c.env.DB.prepare(
        'SELECT id FROM users WHERE api_key_hash = ?'
      ).bind(token).first();
      if (!result) {
        return c.json({ error: 'Invalid token' }, 401);
      }
      c.set('userId', result.id as string);
    }
  }
  await next();
});

// ---- Auth ----

app.post('/api/auth/login', async (c) => {
  const { userId, apiKey } = await c.req.json();
  if (!userId || !apiKey) {
    return c.json({ error: 'Missing userId or apiKey' }, 400);
  }
  const user = await c.env.DB.prepare(
    'SELECT id, name, api_key_hash FROM users WHERE id = ?'
  ).bind(userId).first();

  if (!user || user.api_key_hash !== apiKey) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  return c.json({ userId: user.id, userName: user.name, token: user.api_key_hash });
});

// ---- Settings ----

app.get('/api/settings', async (c) => {
  const settings = await c.env.DB.prepare(
    'SELECT target_budget, currency FROM settings WHERE id = 1'
  ).first();

  return c.json(settings || { target_budget: 250000, currency: 'EUR' });
});

app.put('/api/settings', async (c) => {
  const { target_budget, currency } = await c.req.json();

  const existing = await c.env.DB.prepare(
    'SELECT id FROM settings WHERE id = 1'
  ).first();

  if (existing) {
    await c.env.DB.prepare(`
      UPDATE settings SET target_budget = COALESCE(?, target_budget), currency = COALESCE(?, currency) WHERE id = 1
    `).bind(target_budget, currency).run();
  } else {
    await c.env.DB.prepare(`
      INSERT INTO settings (id, target_budget, currency) VALUES (1, ?, ?)
    `).bind(target_budget || 250000, currency || 'EUR').run();
  }

  const updated = await c.env.DB.prepare(
    'SELECT target_budget, currency FROM settings WHERE id = 1'
  ).first();

  return c.json(updated);
});

// ---- Expenses ----

app.get('/api/expenses', async (c) => {
  const url = new URL(c.req.url);
  const month = url.searchParams.get('month'); // YYYY-MM format
  const userId = c.get('userId');

  let query = 'SELECT * FROM expenses WHERE user_id = ?';
  const params: any[] = [userId];

  if (month) {
    query += ' AND strftime(\'%Y-%m\', date) = ?';
    params.push(month);
  }

  query += ' ORDER BY date DESC, created_at DESC';

  const expenses = await c.env.DB.prepare(query).bind(...params).all();
  const list = (expenses as any).results.map((row: Record<string, string | number | boolean>) => ({
    id: row.id,
    user_id: row.user_id,
    amount: Number(row.amount),
    currency: row.currency,
    purpose: row.purpose,
    date: row.date,
    is_regular: Boolean(row.is_regular),
    regular_monthly_id: row.regular_monthly_id || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  return c.json(list);
});

app.get('/api/expenses/total', async (c) => {
  const url = new URL(c.req.url);
  const month = url.searchParams.get('month');
  const userId = c.get('userId');

  let query = 'SELECT COALESCE(SUM(amount), 0) as total FROM expenses WHERE user_id = ?';
  const params: any[] = [userId];

  if (month) {
    query += ' AND strftime(\'%Y-%m\', date) = ?';
    params.push(month);
  }

  const result = await c.env.DB.prepare(query).bind(...params).first();
  return c.json({ total: Number((result as any).total) });
});

app.post('/api/expenses', async (c) => {
  const userId = c.get('userId');
  const { amount, currency, purpose, date, is_regular } = await c.req.json();

  if (!amount || !purpose || !date) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString().replace('Z', 'UTC');

  // For regular expenses, create a recurring monthly ID
  let regular_monthly_id = null;
  if (is_regular) {
    const monthKey = date.substring(0, 7); // YYYY-MM
    regular_monthly_id = `regular-${userId.substring(0, 8)}-${monthKey}`;
    // Reuse the same ID each month for the same purpose
    const existingRegular = await c.env.DB.prepare(
      'SELECT id FROM expenses WHERE regular_monthly_id LIKE ? AND purpose = ? LIMIT 1'
    ).bind(`${userId.substring(0, 8)}-${monthKey}-%`, purpose).first();

    if (existingRegular) {
      // Already have a regular expense this month with same purpose - don't create duplicate
      return c.json({ error: 'Regular expense for this month already exists', id: (existingRegular as any).id }, 409);
    }

    regular_monthly_id = `regular-${userId.substring(0, 8)}-${monthKey}-${purpose.substring(0, 4).replace(/[^a-zA-Z0-9]/g, '')}`;
  }

  await c.env.DB.prepare(`
    INSERT INTO expenses (id, user_id, amount, currency, purpose, date, is_regular, regular_monthly_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, userId, amount, currency || 'EUR', purpose, date, is_regular ? 1 : 0, regular_monthly_id, now, now
  ).run();

  return c.json({ id, user_id: userId, amount, currency: currency || 'EUR', purpose, date, is_regular: is_regular || false, created_at: now }, 201);
});

app.put('/api/expenses/:id', async (c) => {
  const id = c.req.param('id');
  const { amount, currency, purpose, date, is_regular } = await c.req.json();

  if (!amount || !purpose || !date) {
    return c.json({ error: 'Missing required fields' }, 400);
  }

  const existing = await c.env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
  if (!existing) {
    return c.json({ error: 'Expense not found' }, 404);
  }

  const now = new Date().toISOString().replace('Z', 'UTC');

  await c.env.DB.prepare(`
    UPDATE expenses SET amount = ?, currency = ?, purpose = ?, date = ?, is_regular = ?, updated_at = ?
    WHERE id = ?
  `).bind(amount, currency || 'EUR', purpose, date, is_regular ? 1 : 0, now, id).run();

  const updated = await c.env.DB.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first();
  return c.json({
    id: updated.id,
    amount: Number(updated.amount),
    currency: updated.currency,
    purpose: updated.purpose,
    date: updated.date,
    is_regular: Boolean(updated.is_regular),
    updated_at: updated.updated_at,
  });
});

app.delete('/api/expenses/:id', async (c) => {
  const id = c.req.param('id');

  await c.env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(id).run();
  return c.json({ deleted: true, id });
});

// ---- Sync ----

app.post('/api/sync/push', async (c) => {
  const userId = c.get('userId');
  const { expenses, lastSyncTimestamp } = await c.req.json();

  if (!expenses || !Array.isArray(expenses)) {
    return c.json({ error: 'No expenses to push' }, 400);
  }

  const inserted: string[] = [];
  const skipped: string[] = [];

  for (const expense of expenses) {
    // Check if already exists on server with same or newer timestamp
    const existing = await c.env.DB.prepare(
      'SELECT id, updated_at FROM expenses WHERE id = ?'
    ).bind(expense.id).first();

    if (existing) {
      const existingDate = new Date(existing.updated_at as string);
      const incomingDate = new Date(expense.updated_at);
      if (incomingDate <= existingDate) {
        skipped.push(expense.id);
        continue;
      }
    }

    // Insert or update — server accepts the pusher's version (merge by unique ID)
    const now = new Date().toISOString().replace('Z', 'UTC');

    if (existing) {
      await c.env.DB.prepare(`
        UPDATE expenses SET amount = ?, currency = ?, purpose = ?, date = ?, is_regular = ?, regular_monthly_id = ?, updated_at = ?
        WHERE id = ?
      `).bind(
        expense.amount, expense.currency || 'EUR', expense.purpose, expense.date,
        expense.is_regular ? 1 : 0, expense.regular_monthly_id || null, now, expense.id
      ).run();
    } else {
      await c.env.DB.prepare(`
        INSERT INTO expenses (id, user_id, amount, currency, purpose, date, is_regular, regular_monthly_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        expense.id, userId, expense.amount, expense.currency || 'EUR', expense.purpose, expense.date,
        expense.is_regular ? 1 : 0, expense.regular_monthly_id || null, now, now
      ).run();
    }

    inserted.push(expense.id);
  }

  // Update last sync timestamp in the settings table
  await c.env.DB.prepare(`
    UPDATE settings SET user_id = user_id WHERE user_id = ?
  `).bind(userId).run();

  return c.json({ inserted, skipped });
});

app.post('/api/sync/pull', async (c) => {
  const userId = c.get('userId');
  const { lastSyncTimestamp } = await c.req.json();

  // Get all expenses from OTHER users that are newer than lastSyncTimestamp
  let query = `
    SELECT * FROM expenses 
    WHERE user_id != ? 
    AND (updated_at > ? OR created_at > ?)
    ORDER BY updated_at DESC
  `;

  const params: any[] = [userId, lastSyncTimestamp || '1970-01-01', lastSyncTimestamp || '1970-01-01'];
  const expenses = await c.env.DB.prepare(query).bind(...params).all();

  const list = (expenses as any[]).map((row: Record<string, any>) => ({
    id: row.id,
    user_id: row.user_id,
    amount: Number(row.amount),
    currency: row.currency,
    purpose: row.purpose,
    date: row.date,
    is_regular: Boolean(row.is_regular),
    regular_monthly_id: row.regular_monthly_id,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }));

  return c.json({ expenses: list });
});

export default app;
