const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
require('dotenv').config({ override: true });

const app = express();
app.use(cors());
app.use(express.json());

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const frontDir = path.join(__dirname, '..', 'frontend');

const useUrl = !!process.env.DATABASE_URL;
const poolConfig = useUrl
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
    }
  : {
      host: process.env.PGHOST,
      port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : undefined,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      database: process.env.PGDATABASE,
      ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: false } : undefined,
    };
const pool = new Pool(poolConfig);

async function ensureTable(){
  await pool.query(`
    CREATE TABLE IF NOT EXISTS responses (
      id SERIAL PRIMARY KEY,
      ts TEXT NOT NULL,
      lang TEXT NOT NULL,
      gender TEXT NOT NULL,
      q1 INTEGER NOT NULL,
      q2 TEXT NOT NULL,
      q3 TEXT NOT NULL,
      q4 TEXT NOT NULL,
      q5 INTEGER NOT NULL
    )
  `);
}

(async () => {
  try {
    await ensureTable();
  } catch (err) {
    console.error(err);
  }
})();

// Health check
app.get('/api/health', async (_req, res) => {
  try{
    await pool.query('SELECT 1');
    res.json({ ok: true, db: true });
  }catch(err){
    console.error(err);
    res.status(500).json({ ok: false, db: false });
  }
});

// Submit endpoint
app.post('/api/submit', async (req, res) => {
  try{
    const { ts, lang, gender, q1, q2, q3, q4, q5 } = req.body || {};
    const missing = [];
    if (!ts) missing.push('ts');
    if (!lang) missing.push('lang');
    if (!gender) missing.push('gender');
    const q1n = Number(q1);
    const q5n = Number(q5);
    if (!Number.isFinite(q1n) || q1n < 1 || q1n > 5) missing.push('q1');
    if (!q2) missing.push('q2');
    if (!q3) missing.push('q3');
    if (!q4) missing.push('q4');
    if (!Number.isFinite(q5n) || q5n < 1 || q5n > 5) missing.push('q5');
    if (missing.length){
      return res.status(400).json({ error: 'Missing fields', fields: missing });
    }
    const insertSql = `
      INSERT INTO responses (ts, lang, gender, q1, q2, q3, q4, q5)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const values = [ts, lang, gender, q1n, q2, q3, q4, q5n];
    const result = await pool.query(insertSql, values);
    const row = result.rows[0];
    res.json({ ok: true, id: row.id, row });
  }catch(err){
    console.error(err);
    if (err && err.code === '42P01'){
      try{
        await ensureTable();
        const { ts, lang, gender, q1, q2, q3, q4, q5 } = req.body || {};
        const q1n = Number(q1); const q5n = Number(q5);
        const values = [ts, lang, gender, q1n, q2, q3, q4, q5n];
        const insertSql = `
          INSERT INTO responses (ts, lang, gender, q1, q2, q3, q4, q5)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `;
        const result = await pool.query(insertSql, values);
        const row = result.rows[0];
        return res.json({ ok: true, id: row.id, row, autoCreatedTable: true });
      }catch(retryErr){
        console.error(retryErr);
        return res.status(500).json({ error: 'TABLE_RECREATED_RETRY_FAILED' });
      }
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// List responses (used by admin.html)
app.get('/api/quiz-responses', async (_req, res) => {
  try{
    const result = await pool.query('SELECT * FROM responses ORDER BY id DESC');
    res.json(result.rows);
  }catch(err){
    console.error(err);
    if (err && err.code === '42P01'){
      try{
        await ensureTable();
        const result = await pool.query('SELECT * FROM responses ORDER BY id DESC');
        return res.json(result.rows);
      }catch(retryErr){
        console.error(retryErr);
        return res.status(500).json({ error: 'TABLE_RECREATED_RETRY_FAILED' });
      }
    }
    res.status(500).json({ error: 'Server error' });
  }
});

// Always serve the latest admin dashboard (no cache)
app.get(['/admin','/admin.html'], (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  res.set('Surrogate-Control', 'no-store');
  res.sendFile(path.join(frontDir, 'admin.html'));
});

// Serve static files (optional): allow opening index.html via http://localhost:3000/
if (fs.existsSync(frontDir)) { app.use(express.static(frontDir)); }
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('Server listening on http://localhost:'+PORT));
