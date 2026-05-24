require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'blood_bank',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// ============ DONORS ============
app.post('/api/donors/register', async (req, res) => {
  try {
    const { firstName, lastName, email, phone, bloodGroup, gender, dateOfBirth, address } = req.body;

    if (!email || !firstName || !lastName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existing = await pool.query('SELECT donor_id FROM "Donor" WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    // FIX: Use proper JS arrays instead of broken {value} string syntax
    const dateOfBirthParam = dateOfBirth ? [dateOfBirth] : null;
    const addressParam = address ? [address] : null;

    const insertSql = `
      INSERT INTO "Donor"
        (first_name, last_name, email, phone, blood_group, gender, date_of_birth, address, eligibility_status)
      VALUES ($1,$2,$3,$4,$5,$6,$7::date[],$8::text[],$9)
      RETURNING donor_id, first_name, last_name, email, blood_group;
    `;

    const result = await pool.query(insertSql, [
      firstName, lastName, email, phone, bloodGroup,
      gender || null, dateOfBirthParam, addressParam, 'eligible',
    ]);

    res.status(201).json({ donor: result.rows[0] });
  } catch (err) {
    console.error('Error /api/donors/register', err);
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});

app.get('/api/donors/profile', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email required' });
    const result = await pool.query(
      `SELECT * FROM "Donor" WHERE email = $1`, [email]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Donor not found' });
    res.json({ donor: result.rows[0] });
  } catch (err) {
    console.error('Error GET /api/donors/profile', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

app.post('/api/donors/login', async (req, res) => {
  try {
    const { email, donorId } = req.body;
    if (!email && !donorId) return res.status(400).json({ error: 'Email or Donor ID required' });

    let result;
    if (donorId) {
      // Login with donor_id
      result = await pool.query(
        `SELECT donor_id, first_name, last_name, email, blood_group FROM "Donor" WHERE donor_id = $1`,
        [parseInt(donorId)]
      );
    } else {
      // Login with email
      result = await pool.query(
        `SELECT donor_id, first_name, last_name, email, blood_group FROM "Donor" WHERE email = $1`,
        [email]
      );
    }

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Donor not found. Check your Donor ID or email.' });
    }

    res.json({ donor: result.rows[0] });
  } catch (err) {
    console.error('Error /api/donors/login', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/donors/info', async (req, res) => {
  try {
    const { email, first_name, last_name, blood_group, phone, gender, dateOfBirth, address } = req.body;

    if (!email || !first_name || !last_name) {
      return res.status(400).json({ error: 'Missing donor info fields' });
    }

    // FIX: Use proper JS arrays
    const dateOfBirthParam = dateOfBirth ? [dateOfBirth] : null;
    const addressParam = address ? [address] : null;

    const sql = `
      UPDATE "Donor"
      SET first_name=$1, last_name=$2, blood_group=$3, phone=$4, gender=$5,
          date_of_birth=$6::date[], address=$7::text[]
      WHERE email = $8
      RETURNING *;
    `;

    const result = await pool.query(sql, [
      first_name, last_name, blood_group, phone,
      gender || null, dateOfBirthParam, addressParam, email,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Donor not found, please login first' });
    }

    res.status(200).json({ donorInfo: result.rows[0] });
  } catch (err) {
    console.error('Error /api/donors/info', err);
    res.status(500).json({ error: 'Saving donor info failed: ' + err.message });
  }
});

// ============ BLOOD UNIT / INVENTORY ============
app.get('/api/inventory', async (req, res) => {
  try {
    // Extract only numeric part from storage_location (handles "2 units", "2", null)
    const result = await pool.query(`
      SELECT unit_id, blood_group, component_type, status,
             COALESCE(NULLIF(regexp_replace(storage_location, '[^0-9]', '', 'g'), ''), '0')::integer AS quantity,
             collection_date, expiry_date
      FROM "BloodUnit"
      WHERE status = 'Available'
      ORDER BY blood_group, component_type
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error /api/inventory', err);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

// ============ HOSPITAL ============
app.post('/api/hospitals/register', async (req, res) => {
  try {
    const { hospitalName, contactPerson, phone, email, address } = req.body;

    if (!email || !hospitalName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existing = await pool.query('SELECT hospital_id FROM "Hospital" WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const sql = `
      INSERT INTO "Hospital" (hospital_name, contact_person, phone, email, address)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING hospital_id, hospital_name, email;
    `;

    const result = await pool.query(sql, [
      hospitalName, contactPerson || null, phone || null, email, address || null,
    ]);

    res.status(201).json({ hospital: result.rows[0] });
  } catch (err) {
    console.error('Error /api/hospitals/register', err);
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});

app.post('/api/hospitals/login', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const result = await pool.query(
      `SELECT hospital_id, hospital_name, email FROM "Hospital" WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Hospital not found' });
    }

    res.json({ hospital: result.rows[0] });
  } catch (err) {
    console.error('Error /api/hospitals/login', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/blood-requests', async (req, res) => {
  try {
    const { hospitalId, bloodGroup, componentType, quantity, urgency, reasonForRequest } = req.body;

    if (!hospitalId || !bloodGroup || !quantity || !componentType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const parsedQuantity = parseInt(quantity, 10);
    if (Number.isNaN(parsedQuantity) || parsedQuantity <= 0) {
      return res.status(400).json({ error: 'Quantity must be a positive number' });
    }

    const sql = `
      INSERT INTO "BloodRequest"
        (hospital_id, blood_group, component_type, quantity_units, request_date, urgency_level, status)
      VALUES ($1,$2,$3,$4,CURRENT_DATE,$5,$6)
      RETURNING request_id, blood_group, component_type, quantity_units;
    `;

    const result = await pool.query(sql, [
      hospitalId, bloodGroup, componentType,
      parsedQuantity, urgency || 'Normal', 'Pending',
    ]);

    res.status(201).json({ request: result.rows[0] });
  } catch (err) {
    console.error('Error /api/blood-requests', err);
    res.status(500).json({ error: 'Request submission failed: ' + err.message });
  }
});

// ============ STAFF / COLLECTION CENTRE ============
app.post('/api/staff/register', async (req, res) => {
  try {
    const { centreName, licenseNo, email, password, contactPerson, phone, city, address } = req.body;

    if (!email || !centreName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existing = await pool.query('SELECT staff_id FROM "Staff" WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // NOTE: first_name stores centre name, last_name stores license number
    // If your Staff table has more columns (city, address etc), add them here
    const sql = `
      INSERT INTO "Staff" (first_name, last_name, role, phone, email, shift_timing)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING staff_id, first_name AS staff_name, email;
    `;

    const result = await pool.query(sql, [
      centreName, licenseNo || '', 'collection_centre', phone || null, email, 'Day',
    ]);

    res.status(201).json({ staff: result.rows[0] });
  } catch (err) {
    console.error('Error /api/staff/register', err);
    res.status(500).json({ error: 'Registration failed: ' + err.message });
  }
});

app.post('/api/staff/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    // FIX: Select staff by email (add password check here if your table has a password column)
    const result = await pool.query(
      `SELECT staff_id, first_name AS staff_name, email FROM "Staff" WHERE email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Staff member not found' });
    }

    res.json({ staff: result.rows[0] });
  } catch (err) {
    console.error('Error /api/staff/login', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/blood-collection', async (req, res) => {
  try {
    const { staffId, bloodGroup, componentType, quantity, collectionDate, expiryDate, donorId } = req.body;

    if (!staffId || !bloodGroup) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const units = parseInt(quantity, 10);
    if (!units || units <= 0) {
      return res.status(400).json({ error: 'Quantity must be a positive number' });
    }

    // Check if a row already exists for this blood_group + component_type
    const existing = await pool.query(
      `SELECT unit_id, storage_location FROM "BloodUnit"
       WHERE blood_group = $1 AND component_type = $2 AND status = 'Available'
       LIMIT 1`,
      [bloodGroup, componentType || 'Whole Blood']
    );

    if (existing.rows.length > 0) {
      // Row exists — add to quantity stored in storage_location
      const currentQty = parseInt((existing.rows[0].storage_location || '0').replace(/[^0-9]/g, '')) || 0;
      const newQty = currentQty + units;
      await pool.query(
        `UPDATE "BloodUnit" SET storage_location = $1, collection_date = $2, expiry_date = $3
         WHERE unit_id = $4`,
        [String(newQty), collectionDate || null, expiryDate || null, existing.rows[0].unit_id]
      );
      return res.status(200).json({
        message: `Added ${units} unit(s). Total ${bloodGroup} ${componentType}: ${newQty} units.`
      });
    } else {
      // No row — insert a new one
      await pool.query(
        `INSERT INTO "BloodUnit" (blood_group, component_type, collection_date, expiry_date, storage_location, status)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [bloodGroup, componentType || 'Whole Blood', collectionDate || null, expiryDate || null, String(units), 'Available']
      );
      return res.status(201).json({
        message: `${units} unit(s) of ${bloodGroup} ${componentType} added to inventory.`
      });
    }
  } catch (err) {
    console.error('Error /api/blood-collection', err);
    res.status(500).json({ error: 'Collection submission failed: ' + err.message });
  }
});


// ============ DONOR APPOINTMENTS ============

// Get all appointments for a donor by email
app.get('/api/appointments', async (req, res) => {
  try {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const donor = await pool.query('SELECT donor_id FROM "Donor" WHERE email = $1', [email]);
    if (donor.rows.length === 0) return res.status(404).json({ error: 'Donor not found' });

    const result = await pool.query(
      `SELECT * FROM "DonorAppointment" WHERE donor_id = $1 ORDER BY appointment_date DESC`,
      [donor.rows[0].donor_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Error GET /api/appointments', err);
    res.status(500).json({ error: 'Failed to fetch appointments: ' + err.message });
  }
});

// Book a new appointment
app.post('/api/appointments', async (req, res) => {
  try {
    const { email, appointmentDate, timeSlot, location, notes } = req.body;
    if (!email || !appointmentDate) return res.status(400).json({ error: 'Email and date are required' });

    const donor = await pool.query('SELECT donor_id FROM "Donor" WHERE email = $1', [email]);
    if (donor.rows.length === 0) return res.status(404).json({ error: 'Donor not found. Please register first.' });

    const donorId = donor.rows[0].donor_id;

    // Check for existing booked appointment on same date
    const existing = await pool.query(
      `SELECT appointment_id FROM "DonorAppointment" WHERE donor_id = $1 AND $2 = ANY(appointment_date) AND status = 'Booked'`,
      [donorId, appointmentDate]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'You already have a booked appointment on this date.' });
    }

    // Try to insert with time_slot and location columns
    // Run this SQL once in pgAdmin if columns don't exist:
    // ALTER TABLE "DonorAppointment" ADD COLUMN IF NOT EXISTS time_slot VARCHAR(20);
    // ALTER TABLE "DonorAppointment" ADD COLUMN IF NOT EXISTS location VARCHAR(100);
    // ALTER TABLE "DonorAppointment" ADD COLUMN IF NOT EXISTS notes TEXT;
    let result;
    try {
      result = await pool.query(
        `INSERT INTO "DonorAppointment" (donor_id, appointment_date, status, time_slot, location, notes)
         VALUES ($1, $2::date[], $3, $4, $5, $6)
         RETURNING *`,
        [donorId, `{${appointmentDate}}`, 'Booked', timeSlot || null, location || null, notes || null]
      );
    } catch(e) {
      // Fallback if columns don't exist yet
      result = await pool.query(
        `INSERT INTO "DonorAppointment" (donor_id, appointment_date, status)
         VALUES ($1, $2::date[], $3)
         RETURNING *`,
        [donorId, `{${appointmentDate}}`, 'Booked']
      );
    }
    // Send SMS via Twilio (free trial available at twilio.com)
    // Add to .env:
    //   TWILIO_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    //   TWILIO_TOKEN=your_auth_token
    //   TWILIO_FROM=+1XXXXXXXXXX   (your Twilio trial number)
    try {
        const donorPhone = await pool.query(
            `SELECT phone FROM "Donor" WHERE donor_id = $1`, [donorId]
        );
        const rawPhone = donorPhone.rows[0]?.phone?.replace(/[^0-9]/g, '');
        const phone = rawPhone ? `+91${rawPhone.slice(-10)}` : null;

        const sid   = process.env.TWILIO_SID?.trim();
        const token = process.env.TWILIO_TOKEN?.trim();
        const from  = process.env.TWILIO_FROM?.trim();

        console.log('SMS attempt — to:', phone, 'Twilio configured:', !!(sid && token && from));

        if (phone && sid && token && from) {
            const msg = `LifeLine Blood Bank: Appointment confirmed on ${appointmentDate} at ${timeSlot || 'scheduled time'}, ${location || 'donation centre'}. Thank you for saving lives!`;

            const encoded = Buffer.from(`${sid}:${token}`).toString('base64');
            const body = new URLSearchParams({
                To: phone,
                From: from,
                Body: msg
            });

            const smsRes = await fetch(
                `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Basic ${encoded}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    },
                    body: body.toString()
                }
            );
            const smsData = await smsRes.json();
            console.log('Twilio response:', smsData.status, smsData.error_message || '');
        }
    } catch(smsErr) {
        console.error('SMS error:', smsErr.message);
    }

    res.status(201).json({ appointment: result.rows[0] });
  } catch (err) {
    console.error('Error POST /api/appointments', err);
    res.status(500).json({ error: 'Booking failed: ' + err.message });
  }
});

// Cancel an appointment
app.post('/api/appointments/:id/cancel', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE "DonorAppointment" SET status = 'Cancelled' WHERE appointment_id = $1 AND status = 'Booked' RETURNING appointment_id`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found or already cancelled' });
    }
    res.json({ message: 'Appointment cancelled successfully.' });
  } catch (err) {
    console.error('Error POST /api/appointments/:id/cancel', err);
    res.status(500).json({ error: 'Cancellation failed: ' + err.message });
  }
});

// Admin: Get all appointments (for admin panel)
app.get('/api/appointments/all', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT da.*, d.first_name, d.last_name, d.email, d.blood_group
      FROM "DonorAppointment" da
      JOIN "Donor" d ON da.donor_id = d.donor_id
      ORDER BY da.appointment_date DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error GET /api/appointments/all', err);
    res.status(500).json({ error: 'Failed to fetch all appointments: ' + err.message });
  }
});

// Admin: Mark appointment as Completed
app.post('/api/appointments/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE "DonorAppointment" SET status = 'Completed' WHERE appointment_id = $1 AND status = 'Booked' RETURNING appointment_id`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Appointment not found or not in Booked status' });
    }
    res.json({ message: 'Appointment marked as completed.' });
  } catch (err) {
    console.error('Error POST /api/appointments/:id/complete', err);
    res.status(500).json({ error: 'Update failed: ' + err.message });
  }
});

// Port and 404 moved to end of file

// ============ BLOOD REQUEST MANAGEMENT (Admin/Staff) ============

// Get all pending blood requests
app.get('/api/blood-requests', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT br.*, h.hospital_name 
      FROM "BloodRequest" br
      JOIN "Hospital" h ON br.hospital_id = h.hospital_id
      ORDER BY 
        CASE WHEN br.urgency_level = 'Emergency' THEN 0 ELSE 1 END,
        br.request_date DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error GET /api/blood-requests', err);
    res.status(500).json({ error: 'Failed to fetch requests: ' + err.message });
  }
});

// Approve a blood request → records in BloodIssue + deletes from BloodUnit
app.post('/api/blood-requests/:requestId/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    const { requestId } = req.params;
    const { staffId } = req.body;

    await client.query('BEGIN');

    // 1. Get the request details
    const reqResult = await client.query(
      `SELECT * FROM "BloodRequest" WHERE request_id = $1 AND status = 'Pending'`,
      [requestId]
    );
    if (reqResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Request not found or already processed' });
    }
    const request = reqResult.rows[0];

    // 2. Find the blood unit row and check quantity in storage_location
    const unitsResult = await client.query(
      `SELECT unit_id, COALESCE(NULLIF(storage_location,''),'0') AS storage_location
       FROM "BloodUnit"
       WHERE blood_group = $1 AND component_type = $2 AND status = 'Available'
       LIMIT 1`,
      [request.blood_group, request.component_type]
    );

    const availableQty = unitsResult.rows.length > 0 ? parseInt(unitsResult.rows[0].storage_location) : 0;
    if (availableQty < request.quantity_units) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: `Not enough stock. Requested: ${request.quantity_units}, Available: ${availableQty}`
      });
    }

    // 3. Record in BloodIssue
    await client.query(
      `INSERT INTO "BloodIssue" (request_id, unit_id, staff_id, issue_date)
       VALUES ($1, $2, $3, CURRENT_DATE)`,
      [requestId, unitsResult.rows[0].unit_id, staffId || 1]
    );

    // 4. Subtract ordered qty from storage_location, delete row if reaches 0
    const currentQty = parseInt((unitsResult.rows[0].storage_location || '0').replace(/[^0-9]/g, '')) || 0;
    const newQty = currentQty - request.quantity_units;
    if (newQty <= 0) {
      await client.query(`DELETE FROM "BloodUnit" WHERE unit_id = $1`, [unitsResult.rows[0].unit_id]);
    } else {
      await client.query(
        `UPDATE "BloodUnit" SET storage_location = $1 WHERE unit_id = $2`,
        [String(newQty), unitsResult.rows[0].unit_id]
      );
    }

    // 5. Update request status to Approved
    await client.query(
      `UPDATE "BloodRequest" SET status = 'Approved' WHERE request_id = $1`,
      [requestId]
    );

    await client.query('COMMIT');
    res.json({ message: `Request approved. ${request.quantity_units} units of ${request.blood_group} issued and removed from inventory.` });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error approving request', err);
    res.status(500).json({ error: 'Approval failed: ' + err.message });
  } finally {
    client.release();
  }
});

// Reject a blood request
app.post('/api/blood-requests/:requestId/reject', async (req, res) => {
  try {
    const { requestId } = req.params;
    const result = await pool.query(
      `UPDATE "BloodRequest" SET status = 'Rejected' WHERE request_id = $1 RETURNING request_id`,
      [requestId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }
    res.json({ message: 'Request rejected.' });
  } catch (err) {
    console.error('Error rejecting request', err);
    res.status(500).json({ error: 'Rejection failed: ' + err.message });
  }
});

// Get all issued blood (BloodIssue history)
app.get('/api/blood-issues', async (req, res) => {
  try {
    // LEFT JOIN BloodUnit since rows are deleted after issue
    // Blood group/component stored in BloodRequest instead
    const result = await pool.query(`
      SELECT bi.*, 
             br.blood_group, br.component_type, br.quantity_units,
             h.hospital_name
      FROM "BloodIssue" bi
      LEFT JOIN "BloodUnit" bu ON bi.unit_id = bu.unit_id
      JOIN "BloodRequest" br ON bi.request_id = br.request_id
      JOIN "Hospital" h ON br.hospital_id = h.hospital_id
      ORDER BY bi.issue_date DESC
    `);
    res.json(result.rows);
  } catch (err) {
    console.error('Error GET /api/blood-issues', err);
    res.status(500).json({ error: 'Failed to fetch issues: ' + err.message });
  }
});

// Must be last — catch-all 404
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const port = Number(process.env.PORT || 4001);
app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
});