const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://anandhu:andhu@localhost:5432/BloodBank'
});

(async () => {
  try {
    const q = `SELECT staff_id, (first_name || ' ' || last_name) as staff_name, email FROM "Staff" LIMIT 1`;
    const result = await pool.query(q);
    console.log('Query successful:');
    console.log(JSON.stringify(result.rows, null, 2));
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
})();
