const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://anandhu:andhu@localhost:5432/BloodBank'
});

(async () => {
  try {
    console.log('=== Staff Table Data ===');
    const r = await pool.query('SELECT * FROM "Staff" LIMIT 3');
    console.log('Records found:', r.rows.length);
    if (r.rows.length > 0) {
      console.log(JSON.stringify(r.rows, null, 2));
    }
    
    console.log('\n=== Staff Table Columns ===');
    const t = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='Staff'`);
    console.log('Columns:', t.rows.map(x => x.column_name).join(', '));
    
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
