require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const db = require('./db');
const { sendSms } = require('./services/sms');
const { createSourceSystem } = require('./sourceSystemRoutes');

const app = express();
const PORT = Number(process.env.SOURCE_API_PORT || 3002);
const SURVEY_BASE_URL = (process.env.SURVEY_BASE_URL || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');

app.use(express.json());

function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function getExpiry() {
  const ttl = Number(process.env.TOKEN_TTL_HOURS || 48);
  const d = new Date();
  d.setHours(d.getHours() + ttl);
  return d.toISOString();
}

function textOrEmpty(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function makeId(prefix) {
  return prefix + '-' + Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
}

async function upsertVisitGraph(payload) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      'INSERT INTO patients(id, name) VALUES($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name',
      [payload.patient.id, payload.patient.name]
    );

    await client.query(
      'INSERT INTO visits(id, patient_id) VALUES($1, $2) ON CONFLICT (id) DO UPDATE SET patient_id = EXCLUDED.patient_id',
      [payload.visit_id, payload.patient.id]
    );

    for (const doctor of payload.doctors) {
      await client.query(
        'INSERT INTO doctors(id, name) VALUES($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name',
        [doctor.id, doctor.name]
      );

      await client.query(
        'INSERT INTO visit_doctors(visit_id, doctor_id) VALUES($1, $2) ON CONFLICT (visit_id, doctor_id) DO NOTHING',
        [payload.visit_id, doctor.id]
      );
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function createTokenRecord(args) {
  const token = generateToken();
  const expiresAt = getExpiry();
  const maxUses = Number(process.env.TOKEN_MAX_USES || 1);

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      'INSERT INTO survey_tokens(token, visit_id, patient_id, phone, expires_at, max_uses, used_count) VALUES($1, $2, $3, $4, $5, $6, 0)',
      [token, args.visitId, args.patientId, args.phone || null, expiresAt, maxUses]
    );

    for (const doctorId of args.doctorIds) {
      await client.query('INSERT INTO token_doctors(token, doctor_id) VALUES($1, $2)', [token, doctorId]);
    }

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  return { token, expiresAt, maxUses };
}

async function issueSurveyFromPayload(payload, phone) {
  await upsertVisitGraph(payload);

  const tokenInfo = await createTokenRecord({
    visitId: payload.visit_id,
    patientId: payload.patient.id,
    doctorIds: payload.doctors.map((d) => d.id),
    phone
  });

  const link = SURVEY_BASE_URL + '/survey?t=' + encodeURIComponent(tokenInfo.token);

  return {
    token: tokenInfo.token,
    link,
    expires_at: tokenInfo.expiresAt,
    max_uses: tokenInfo.maxUses
  };
}

const sourceSystem = createSourceSystem({
  db,
  textOrEmpty,
  makeId,
  issueSurveyFromPayload,
  sendSms
});

sourceSystem.registerSourceRoutes(app);

app.get('/health', function (_req, res) {
  res.json({ ok: true, service: 'source-api', port: PORT, survey_base_url: SURVEY_BASE_URL });
});

async function boot() {
  await sourceSystem.ensureSourceSystemTables();
  app.listen(PORT, function () {
    console.log('Source API running on http://localhost:' + PORT + ' | survey_base_url=' + SURVEY_BASE_URL);
  });
}

boot().catch((e) => {
  console.error('Source API boot failed:', e);
  process.exit(1);
});
