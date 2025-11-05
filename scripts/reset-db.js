require('dotenv').config({ override: true });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

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

(async () => {
  try {
    // Count existing rows (ignore if table missing)
    let n = 0;
    try{
      const countRes = await pool.query('SELECT COUNT(*)::int AS n FROM responses');
      n = (countRes.rows && countRes.rows[0] && countRes.rows[0].n) || 0;
    }catch(err){ if(!(err && err.code === '42P01')) throw err; }

    // Truncate table (ignore if it doesn't exist)
    try{
      await pool.query('TRUNCATE TABLE responses RESTART IDENTITY');
    }catch(err){ if(!(err && err.code === '42P01')) throw err; }

    // Clear backend/data directory files if any
    try{
      const dataDir = path.join(__dirname, '..', 'backend', 'data');
      if(fs.existsSync(dataDir)){
        for(const f of fs.readdirSync(dataDir)){
          try{ fs.unlinkSync(path.join(dataDir, f)); }catch(_){ }
        }
      }
    }catch(_){ }

    console.log(`OK deleted=${n}`);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    try{ await pool.end(); }catch(_){ }
  }
})();
