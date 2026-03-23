require('dotenv').config();
const crypto = require('crypto');
const express = require('express');
const path = require('path');
const db = require('./db');
const { sendSms } = require('./services/sms');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const BASE_URL = (process.env.BASE_URL || ('http://localhost:' + PORT)).replace(/\/$/, '');
const FRONTEND_DIST = path.join(__dirname, '../public/app');

const QUESTION_TYPES = new Set(['text', 'stars', 'single_choice', 'multi_choice', 'number', 'yes_no', 'scale_1_5']);

app.use(express.json());
app.use(express.static(FRONTEND_DIST));
app.use(express.static(path.join(__dirname, '../public')));

function requireAdmin(req, res, next) {
  const allowInsecure = String(process.env.ALLOW_INSECURE_ADMIN || 'true').toLowerCase() === 'true';
  if (allowInsecure) return next();

  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return next();

  const key = req.header('x-admin-key');
  if (key !== expected) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  next();
}

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

function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

function normalizeRegistrationBody(body) {
  if (!body || typeof body !== 'object') return { error: 'invalid_body' };

  const patientInput = body.patient || {};
  const patientName = textOrEmpty(patientInput.name);
  if (!patientName) return { error: 'patient_name_required' };

  const patientId = textOrEmpty(patientInput.id) || makeId('P');
  const visitId = textOrEmpty(body.visit_id) || makeId('V');
  const phone = textOrEmpty(body.phone || patientInput.phone) || null;

  const doctorsInput = Array.isArray(body.doctors) ? body.doctors : [];
  if (!doctorsInput.length) return { error: 'at_least_one_doctor_required' };

  const doctorMap = new Map();
  for (let i = 0; i < doctorsInput.length; i += 1) {
    const raw = doctorsInput[i] || {};
    const name = textOrEmpty(raw.name);
    if (!name) return { error: 'doctor_name_required_at_index_' + i };

    const id = textOrEmpty(raw.id) || makeId('D');
    if (!doctorMap.has(id)) doctorMap.set(id, { id, name });
  }

  const doctors = Array.from(doctorMap.values());
  if (!doctors.length) return { error: 'at_least_one_doctor_required' };

  return {
    payload: {
      patient: { id: patientId, name: patientName },
      doctors,
      visit_id: visitId
    },
    phone
  };
}

function normalizeQuestionType(type) {
  const t = textOrEmpty(type).toLowerCase();
  if (t === 'scale_1_5') return 'stars';
  return t;
}

function normalizeQuestionInput(body) {
  const label = textOrEmpty(body.label);
  const type = normalizeQuestionType(body.type);
  const required = Boolean(body.required);
  const min = Number.isFinite(Number(body.min)) ? Number(body.min) : null;
  const max = Number.isFinite(Number(body.max)) ? Number(body.max) : null;
  const options = Array.isArray(body.options)
    ? body.options.map(textOrEmpty).filter(Boolean)
    : typeof body.options_csv === 'string'
      ? body.options_csv.split(',').map(textOrEmpty).filter(Boolean)
      : [];
  const category = body.category === 'doctor' ? 'doctor' : 'general';

  if (!label) return { error: 'question_label_required' };
  if (!QUESTION_TYPES.has(type)) return { error: 'invalid_question_type' };
  if ((type === 'single_choice' || type === 'multi_choice') && options.length === 0) {
    return { error: 'options_required_for_choice_type' };
  }

  const key = textOrEmpty(body.key) || slugify(label) || ('question_' + Date.now());

  return {
    question: {
      key,
      label,
      type,
      required,
      options,
      min_value: min,
      max_value: max,
      is_active: body.is_active === undefined ? true : Boolean(body.is_active),
      category
    }
  };
}

function validateQuestionAnswers(questionAnswers, questions, doctors) {
  if (!questionAnswers || typeof questionAnswers !== 'object' || Array.isArray(questionAnswers)) {
    return { ok: false, error: 'invalid_question_answers' };
  }

  const doctorQuestionKeys = new Set(questions.filter(q => q.category === 'doctor').map(q => q.key));
  const generalQuestionKeys = new Set(questions.filter(q => q.category === 'general').map(q => q.key));

  for (const q of questions) {
    const qType = normalizeQuestionType(q.type);
    
    let hasAnswer = false;
    let value = null;
    
    if (q.category === 'doctor' && doctors && doctors.length > 0) {
      for (const d of doctors) {
        const prefixedKey = 'doctor_' + d.id + '_' + q.key;
        if (Object.prototype.hasOwnProperty.call(questionAnswers, prefixedKey)) {
          hasAnswer = true;
          value = questionAnswers[prefixedKey];
          break;
        }
      }
    } else {
      hasAnswer = Object.prototype.hasOwnProperty.call(questionAnswers, q.key);
      value = questionAnswers[q.key];
    }

    if (q.required && !hasAnswer) return { ok: false, error: 'missing_answer_' + q.key };
    if (!hasAnswer) continue;

    if (qType === 'text') {
      if (typeof value !== 'string' || (q.required && !textOrEmpty(value))) {
        return { ok: false, error: 'invalid_answer_' + q.key };
      }
    }

    if (qType === 'stars') {
      const min = Number.isFinite(Number(q.min_value)) ? Number(q.min_value) : 1;
      const max = Number.isFinite(Number(q.max_value)) ? Number(q.max_value) : 5;
      if (!Number.isInteger(value) || value < min || value > max) {
        return { ok: false, error: 'invalid_answer_' + q.key };
      }
    }

    if (qType === 'single_choice') {
      const opts = Array.isArray(q.options) ? q.options : [];
      if (typeof value !== 'string' || opts.indexOf(value) === -1) {
        return { ok: false, error: 'invalid_answer_' + q.key };
      }
    }

    if (qType === 'multi_choice') {
      const opts = Array.isArray(q.options) ? q.options : [];
      if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || opts.indexOf(v) === -1)) {
        return { ok: false, error: 'invalid_answer_' + q.key };
      }
      if (q.required && value.length === 0) return { ok: false, error: 'invalid_answer_' + q.key };
    }

    if (qType === 'number') {
      const num = Number(value);
      if (!Number.isFinite(num)) return { ok: false, error: 'invalid_answer_' + q.key };
      if (q.min_value !== null && q.min_value !== undefined && num < Number(q.min_value)) {
        return { ok: false, error: 'invalid_answer_' + q.key };
      }
      if (q.max_value !== null && q.max_value !== undefined && num > Number(q.max_value)) {
        return { ok: false, error: 'invalid_answer_' + q.key };
      }
    }

    if (qType === 'yes_no') {
      const normalized = typeof value === 'string' ? value.toLowerCase() : value;
      if (!(normalized === 'yes' || normalized === 'no' || normalized === true || normalized === false)) {
        return { ok: false, error: 'invalid_answer_' + q.key };
      }
    }
  }

  return { ok: true };
}

async function ensureQuestionsTableAndDefaults() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS survey_questions (
      id BIGSERIAL PRIMARY KEY,
      question_key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      type TEXT NOT NULL,
      required BOOLEAN NOT NULL DEFAULT TRUE,
      options JSONB NOT NULL DEFAULT '[]'::jsonb,
      min_value NUMERIC,
      max_value NUMERIC,
      order_no INT NOT NULL DEFAULT 0,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      category TEXT NOT NULL DEFAULT 'general',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  
  await db.query(`
    ALTER TABLE survey_questions 
    ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'general'
  `);
}

async function fetchQuestions(args) {
  const includeInactive = args && args.includeInactive;
  const categoryFilter = args && args.category;
  
  let whereClause = 'is_deleted = FALSE';
  if (!includeInactive) {
    whereClause += ' AND is_active = TRUE';
  }
  if (categoryFilter) {
    whereClause += ` AND category = '${categoryFilter}'`;
  }
  
  const rows = await db.query(
    `SELECT id, question_key, label, type, required, options, min_value, max_value, order_no, is_active, page_number, category
     FROM survey_questions
     WHERE ${whereClause}
     ORDER BY page_number ASC, order_no ASC, id ASC`
  );

  return rows.rows.map((r) => ({
    id: Number(r.id),
    key: r.question_key,
    label: r.label,
    type: normalizeQuestionType(r.type),
    required: Boolean(r.required),
    options: Array.isArray(r.options) ? r.options : [],
    min_value: r.min_value === null ? null : Number(r.min_value),
    max_value: r.max_value === null ? null : Number(r.max_value),
    order_no: Number(r.order_no),
    is_active: Boolean(r.is_active),
    page_number: Number(r.page_number) || 1,
    category: r.category || 'general'
  }));
}

async function upsertVisitGraph(payload) {
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      'INSERT INTO patients(id, patient_name) VALUES($1, $2) ON CONFLICT (id) DO UPDATE SET patient_name = EXCLUDED.patient_name',
      [payload.patient.id, payload.patient.patient_name]
    );

    await client.query(
      'INSERT INTO visits(id, patient_id) VALUES($1, $2) ON CONFLICT (id) DO UPDATE SET patient_id = EXCLUDED.patient_id',
      [payload.visit_id, payload.patient.id]
    );

    for (const doctor of payload.doctors) {
      await client.query(
        'INSERT INTO doctors(id, doctor_name) VALUES($1, $2) ON CONFLICT (id) DO UPDATE SET doctor_name = EXCLUDED.doctor_name',
        [doctor.id, doctor.doctor_name]
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

const SOURCE_API_URL = (process.env.SOURCE_API_URL || 'http://localhost:3002').replace(/\/$/, '');

async function validateTokenFromSourceAPI(token) {
  try {
    const url = SOURCE_API_URL + '/survey/token/' + encodeURIComponent(token);
    const response = await fetch(url);
    
    const data = await response.json();
    
    if (!response.ok || data.error) {
      if (response.status === 404 || data.error === 'token_not_found') {
        return { error: 'invalid_token' };
      }
      if (data.error === 'used_token') {
        return { error: 'used_token' };
      }
      if (data.error === 'expired_token') {
        return { error: 'expired_token' };
      }
      return { error: data.error || 'source_api_error' };
    }

    return {
      token: data.token,
      patient_name: data.patient_name,
      patient_id: data.patient_id,
      doctors: data.doctors,
      visit_id: data.visit_id
    };
  } catch (e) {
    return { error: 'source_api_unavailable', details: e.message };
  }
}

async function recordFeedbackUse(token) {
  try {
    const url = SOURCE_API_URL + '/survey/token/' + encodeURIComponent(token) + '/use';
    await fetch(url, { method: 'POST' });
  } catch (e) {
    console.error('Failed to record token use in source API:', e.message);
  }
}

async function issueSurveyFromPayload(payload, phone) {
  await upsertVisitGraph(payload);

  const tokenInfo = await createTokenRecord({
    visitId: payload.visit_id,
    patientId: payload.patient.id,
    doctorIds: payload.doctors.map(function (d) { return d.id; }),
    phone
  });

  const link = BASE_URL + '/survey?t=' + encodeURIComponent(tokenInfo.token);

  return {
    token: tokenInfo.token,
    link,
    expires_at: tokenInfo.expiresAt,
    max_uses: tokenInfo.maxUses
  };
}

app.get('/health', function (_req, res) {
  res.json({ ok: true });
});

app.post('/api/patients/upsert', async function (req, res) {
  try {
    const id = textOrEmpty(req.body.id) || makeId('P');
    const name = textOrEmpty(req.body.name);
    if (!name) return res.status(400).json({ error: 'patient_name_required' });

    const row = await db.query(
      'INSERT INTO patients(id, name) VALUES($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name RETURNING id, name',
      [id, name]
    );

    return res.json({ patient: row.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'patient_upsert_failed', details: e.message });
  }
});

app.post('/api/doctors/upsert', async function (req, res) {
  try {
    const id = textOrEmpty(req.body.id) || makeId('D');
    const name = textOrEmpty(req.body.name);
    if (!name) return res.status(400).json({ error: 'doctor_name_required' });

    const row = await db.query(
      'INSERT INTO doctors(id, name) VALUES($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name RETURNING id, name',
      [id, name]
    );

    return res.json({ doctor: row.rows[0] });
  } catch (e) {
    return res.status(500).json({ error: 'doctor_upsert_failed', details: e.message });
  }
});

app.get('/api/patients', async function (req, res) {
  try {
    const q = '%' + textOrEmpty(req.query.q || '') + '%';
    const rows = await db.query(
      'SELECT id, patient_name FROM patients WHERE ($1 = \'%%\' OR patient_name ILIKE $1 OR id ILIKE $1) ORDER BY patient_name ASC LIMIT 200',
      [q]
    );
    return res.json({ count: rows.rowCount, patients: rows.rows });
  } catch (e) {
    return res.status(500).json({ error: 'patients_list_failed', details: e.message });
  }
});

app.get('/api/doctors', async function (req, res) {
  try {
    const q = '%' + textOrEmpty(req.query.q || '') + '%';
    const rows = await db.query(
      'SELECT id, doctor_name FROM doctors WHERE ($1 = \'%%\' OR doctor_name ILIKE $1 OR id ILIKE $1) ORDER BY doctor_name ASC LIMIT 200',
      [q]
    );
    return res.json({ count: rows.rowCount, doctors: rows.rows });
  } catch (e) {
    return res.status(500).json({ error: 'doctors_list_failed', details: e.message });
  }
});

app.get('/api/visits/:visitId', async function (req, res) {
  try {
    const visitId = req.params.visitId;

    const visit = await db.query(
      'SELECT v.id AS visit_id, v.created_at, p.id AS patient_id, p.patient_name FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.id = $1',
      [visitId]
    );

    if (!visit.rowCount) return res.status(404).json({ error: 'visit_not_found' });

    const doctors = await db.query(
      'SELECT d.id, d.doctor_name FROM visit_doctors vd JOIN doctors d ON d.id = vd.doctor_id WHERE vd.visit_id = $1 ORDER BY d.doctor_name ASC',
      [visitId]
    );

    return res.json({ visit: visit.rows[0], doctors: doctors.rows });
  } catch (e) {
    return res.status(500).json({ error: 'visit_fetch_failed', details: e.message });
  }
});

app.post('/api/register/visit', async function (req, res) {
  try {
    const normalized = normalizeRegistrationBody(req.body);
    if (normalized.error) return res.status(400).json({ error: normalized.error });

    const payload = normalized.payload;
    const out = await issueSurveyFromPayload(payload, normalized.phone);

    let sms = { ok: false, skipped: true, reason: 'no_phone_provided' };
    if (normalized.phone) {
      sms = await sendSms({ to: normalized.phone, message: 'Please provide feedback: ' + out.link });
    }

    return res.json({
      ...out,
      visit: {
        visit_id: payload.visit_id,
        patient: payload.patient,
        doctors: payload.doctors
      },
      sms
    });
  } catch (e) {
    return res.status(500).json({ error: 'register_visit_failed', details: e.message });
  }
});

app.get('/api/external/test', async function (req, res) {
  try {
    const visitId = textOrEmpty(req.query.visit_id);
    if (!visitId) return res.status(400).json({ error: 'visit_id_required' });

    const extBase = (process.env.EXTERNAL_API_URL || 'http://localhost:3002/source/external/visit-by-visit').replace(/\/$/, '');
    const url = extBase + '/' + encodeURIComponent(visitId);

    const extRes = await fetch(url);
    const bodyText = await extRes.text();

    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch (_e) {
      parsed = bodyText;
    }

    return res.status(extRes.ok ? 200 : 502).json({
      connected: extRes.ok,
      status: extRes.status,
      request_url: url,
      data: parsed
    });
  } catch (e) {
    return res.status(500).json({ error: 'external_test_failed', details: e.message });
  }
});

app.post('/api/visits/sync', async function (req, res) {
  try {
    const visitId = textOrEmpty(req.body.visit_id);
    const phone = textOrEmpty(req.body.phone) || null;

    if (!visitId) return res.status(400).json({ error: 'visit_id_required' });

    const extBase = (process.env.EXTERNAL_API_URL || 'http://localhost:3002/source/external/visit-by-visit').replace(/\/$/, '');
    const extRes = await fetch(extBase + '/' + encodeURIComponent(visitId));

    if (!extRes.ok) {
      const body = await extRes.text();
      return res.status(502).json({ error: 'external_api_failed', details: body });
    }

    const payload = await extRes.json();
    if (!payload.patient || !Array.isArray(payload.doctors) || !payload.visit_id) {
      return res.status(502).json({ error: 'invalid_external_payload' });
    }

    const out = await issueSurveyFromPayload(payload, phone);
    const smsResult = phone
      ? await sendSms({ to: phone, message: 'Please provide feedback: ' + out.link })
      : { ok: false, skipped: true, reason: 'no_phone_provided' };

    return res.json({ ...out, sms: smsResult });
  } catch (e) {
    return res.status(500).json({ error: 'sync_failed', details: e.message });
  }
});

app.get('/api/questions', requireAdmin, async function (req, res) {
  try {
    await ensureQuestionsTableAndDefaults();
    const includeInactive = String(req.query.all || '').toLowerCase() === 'true';
    const questions = await fetchQuestions({ includeInactive });
    return res.json({ count: questions.length, questions });
  } catch (e) {
    return res.status(500).json({ error: 'questions_fetch_failed', details: e.message });
  }
});

app.post('/api/questions', requireAdmin, async function (req, res) {
  try {
    await ensureQuestionsTableAndDefaults();
    const normalized = normalizeQuestionInput(req.body);
    if (normalized.error) return res.status(400).json({ error: normalized.error });

    const q = normalized.question;
    const orderNo = Number.isInteger(req.body.order_no)
      ? req.body.order_no
      : (await db.query('SELECT COALESCE(MAX(order_no), 0) + 1 AS next_order FROM survey_questions WHERE is_deleted = FALSE')).rows[0].next_order;

    const pageNum = Number.isInteger(req.body.page_number) && req.body.page_number >= 1 ? req.body.page_number : 1;
    const inserted = await db.query(
      'INSERT INTO survey_questions(question_key, label, type, required, options, min_value, max_value, order_no, is_active, is_deleted, page_number, category) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,FALSE,$10,$11) RETURNING id, question_key, label, type, required, options, min_value, max_value, order_no, is_active, page_number, category',
      [q.key, q.label, q.type, q.required, JSON.stringify(q.options), q.min_value, q.max_value, orderNo, q.is_active, pageNum, q.category]
    );

    return res.json({ question: inserted.rows[0] });
  } catch (e) {
    if (String(e.message || '').toLowerCase().includes('unique')) {
      return res.status(400).json({ error: 'question_key_already_exists' });
    }
    return res.status(500).json({ error: 'question_create_failed', details: e.message });
  }
});

app.patch('/api/questions/:id', requireAdmin, async function (req, res) {
  try {
    await ensureQuestionsTableAndDefaults();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid_question_id' });

    const current = await db.query('SELECT * FROM survey_questions WHERE id = $1 AND is_deleted = FALSE', [id]);
    if (!current.rowCount) return res.status(404).json({ error: 'question_not_found' });

    const source = current.rows[0];
    const merged = {
      key: textOrEmpty(req.body.key) || source.question_key,
      label: textOrEmpty(req.body.label) || source.label,
      type: normalizeQuestionType(req.body.type || source.type),
      required: req.body.required === undefined ? source.required : Boolean(req.body.required),
      options: Array.isArray(req.body.options)
        ? req.body.options.map(textOrEmpty).filter(Boolean)
        : source.options,
      min_value: req.body.min === undefined ? source.min_value : Number(req.body.min),
      max_value: req.body.max === undefined ? source.max_value : Number(req.body.max),
      order_no: req.body.order_no === undefined ? source.order_no : Number(req.body.order_no),
      is_active: req.body.is_active === undefined ? source.is_active : Boolean(req.body.is_active),
      page_number: req.body.page_number === undefined ? Number(source.page_number) || 1 : Number(req.body.page_number),
      category: req.body.category === 'doctor' ? 'doctor' : (req.body.category === 'general' ? 'general' : (source.category || 'general'))
    };

    if (!QUESTION_TYPES.has(merged.type)) return res.status(400).json({ error: 'invalid_question_type' });
    if ((merged.type === 'single_choice' || merged.type === 'multi_choice') && (!Array.isArray(merged.options) || merged.options.length === 0)) {
      return res.status(400).json({ error: 'options_required_for_choice_type' });
    }

    const updated = await db.query(
      'UPDATE survey_questions SET question_key=$1,label=$2,type=$3,required=$4,options=$5::jsonb,min_value=$6,max_value=$7,order_no=$8,is_active=$9,page_number=$10,category=$11,updated_at=NOW() WHERE id=$12 RETURNING id, question_key, label, type, required, options, min_value, max_value, order_no, is_active, page_number, category',
      [merged.key, merged.label, merged.type, merged.required, JSON.stringify(merged.options || []), merged.min_value, merged.max_value, merged.order_no, merged.is_active, merged.page_number, merged.category, id]
    );

    return res.json({ question: updated.rows[0] });
  } catch (e) {
    if (String(e.message || '').toLowerCase().includes('unique')) {
      return res.status(400).json({ error: 'question_key_already_exists' });
    }
    return res.status(500).json({ error: 'question_update_failed', details: e.message });
  }
});

app.delete('/api/questions/:id', requireAdmin, async function (req, res) {
  try {
    await ensureQuestionsTableAndDefaults();
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid_question_id' });

    const out = await db.query(
      'DELETE FROM survey_questions WHERE id = $1 RETURNING id',
      [id]
    );

    if (!out.rowCount) return res.status(404).json({ error: 'question_not_found' });
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'question_delete_failed', details: e.message });
  }
});

app.post('/api/questions/reorder', requireAdmin, async function (req, res) {
  try {
    await ensureQuestionsTableAndDefaults();
    const ids = Array.isArray(req.body.ids) ? req.body.ids.map((x) => Number(x)).filter((x) => Number.isInteger(x) && x > 0) : [];
    if (!ids.length) return res.status(400).json({ error: 'ids_required' });

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      for (let i = 0; i < ids.length; i += 1) {
        await client.query('UPDATE survey_questions SET order_no=$1, updated_at=NOW() WHERE id=$2 AND is_deleted=FALSE', [i + 1, ids[i]]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'questions_reorder_failed', details: e.message });
  }
});

app.get('/api/survey', async function (req, res) {
  const token = req.query.token || req.query.t;
  if (!token) return res.status(400).json({ error: 'token_required' });

  const survey = await validateTokenFromSourceAPI(token);
  if (survey.error) return res.status(400).json({ error: survey.error });

  await ensureQuestionsTableAndDefaults();
  
  const doctorQuestions = await fetchQuestions({ includeInactive: false, category: 'doctor' });
  const generalQuestions = await fetchQuestions({ includeInactive: false, category: 'general' });

  return res.json({
    patient_name: survey.patient_name,
    doctors: survey.doctors,
    doctor_questions: doctorQuestions.map((q) => ({
      id: q.key,
      type: q.type,
      label: q.label,
      required: q.required,
      options: q.options,
      min: q.min_value,
      max: q.max_value,
      page_number: q.page_number
    })),
    general_questions: generalQuestions.map((q) => ({
      id: q.key,
      type: q.type,
      label: q.label,
      required: q.required,
      options: q.options,
      min: q.min_value,
      max: q.max_value,
      page_number: q.page_number
    }))
  });
});

app.post('/api/feedback', async function (req, res) {
  try {
    const token = req.body.token;
    const questionAnswers = req.body.question_answers || {};

    if (!token) return res.status(400).json({ error: 'token_required' });

    const survey = await validateTokenFromSourceAPI(token);
    if (survey.error) return res.status(400).json({ error: survey.error });

    const doctorNames = survey.doctors ? survey.doctors.map(d => d.doctor_name).join(', ') : '';

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const sub = await client.query(
        'INSERT INTO feedback_submissions(token, visit_id, patient_id, patient_name, doctor_names, question_answers) VALUES($1, $2, $3, $4, $5, $6::jsonb) RETURNING id',
        [token, survey.visit_id, survey.patient_id || null, survey.patient_name, doctorNames, JSON.stringify(questionAnswers)]
      );

      const submissionId = sub.rows[0].id;

      await client.query('COMMIT');
      
      recordFeedbackUse(token);
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }

    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'feedback_failed', details: e.message });
  }
});

app.get('/api/responses', requireAdmin, async function (req, res) {
  const grouped = String(req.query.grouped || '').toLowerCase() === 'true';
  const search = String(req.query.search || '').trim();
  const doctorId = String(req.query.doctor_id || '').trim();
  const dateFrom = String(req.query.date_from || '').trim();
  const dateTo = String(req.query.date_to || '').trim();
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));

  const conditions = [];
  const params = [];
  let paramIdx = 1;

  if (search) {
    conditions.push(`(
      fs.patient_name ILIKE $${paramIdx} OR
      fs.visit_id ILIKE $${paramIdx} OR
      fs.doctor_names ILIKE $${paramIdx}
    )`);
    params.push('%' + search + '%');
    paramIdx++;
  }

  if (doctorId) {
    conditions.push(`fs.doctor_names ILIKE $${paramIdx}`);
    params.push('%' + doctorId + '%');
    paramIdx++;
  }

  if (dateFrom) {
    conditions.push(`fs.submitted_at >= $${paramIdx}`);
    params.push(dateFrom);
    paramIdx++;
  }

  if (dateTo) {
    conditions.push(`fs.submitted_at <= $${paramIdx}`);
    params.push(dateTo + 'T23:59:59.999');
    paramIdx++;
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  if (!grouped) {
    let sql = `SELECT fs.id AS submission_id, fs.submitted_at, fs.visit_id, fs.patient_name,
               fs.comment, fs.question_answers
               FROM feedback_submissions fs
               ${whereClause}
               ORDER BY fs.submitted_at DESC, fs.id DESC`;
    const rows = await db.query(sql, params);
    return res.json({ count: rows.rowCount, responses: rows.rows });
  }

  const countSql = `SELECT COUNT(DISTINCT fs.id) AS total FROM feedback_submissions fs ${whereClause}`;
  const countResult = await db.query(countSql, params);
  const totalCount = parseInt(countResult.rows[0]?.total || 0);
  const totalPages = Math.ceil(totalCount / limit);
  const offset = (page - 1) * limit;

  let sql = `SELECT fs.id AS submission_id, fs.submitted_at, fs.visit_id, fs.patient_name,
             fs.doctor_names, fs.comment, fs.question_answers
             FROM feedback_submissions fs
             ${whereClause}
             ORDER BY fs.submitted_at DESC, fs.id DESC
             LIMIT ${limit} OFFSET ${offset}`;
  const rows = await db.query(sql, params);

  const responses = rows.rows.map((row) => ({
    submission_id: row.submission_id,
    submitted_at: row.submitted_at,
    visit_id: row.visit_id,
    patient_name: row.patient_name,
    doctor_names: row.doctor_names,
    comment: row.comment,
    question_answers: row.question_answers || {}
  }));

  return res.json({
    count: responses.length,
    total: totalCount,
    page,
    limit,
    total_pages: totalPages,
    responses: responses
  });
});

app.delete('/api/responses', requireAdmin, async function (req, res) {
  const ids = req.body.ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'ids_required' });
  }

  const safeIds = ids.map((id) => String(id).trim()).filter(Boolean);
  if (safeIds.length === 0) {
    return res.status(400).json({ error: 'ids_required' });
  }

  const placeholders = safeIds.map((_, i) => '$' + (i + 1)).join(', ');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`DELETE FROM feedback_ratings WHERE submission_id IN (${placeholders})`, safeIds);
    await client.query(`DELETE FROM feedback_submissions WHERE id IN (${placeholders})`, safeIds);
    await client.query('COMMIT');
    return res.json({ ok: true, deleted: safeIds.length });
  } catch (e) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'delete_failed', details: e.message });
  } finally {
    client.release();
  }
});

app.get('/api/doctors/list', requireAdmin, async function (_req, res) {
  try {
    const rows = await db.query(`
      SELECT DISTINCT fr.doctor_id, fr.doctor_name 
      FROM feedback_ratings fr 
      WHERE fr.doctor_id IS NOT NULL AND fr.doctor_name IS NOT NULL 
      ORDER BY fr.doctor_name ASC
    `);
    return res.json({ doctors: rows.rows });
  } catch (e) {
    return res.status(500).json({ error: 'fetch_failed', details: e.message });
  }
});

app.get('/api/analytics', requireAdmin, async function (_req, res) {
  const totals = await db.query('SELECT COUNT(*)::int AS total_submissions FROM feedback_submissions');

  const submissions = await db.query(
    'SELECT fs.question_answers, fs.doctor_names FROM feedback_submissions fs'
  );

  const doctorStats = {};
  
  for (const row of submissions.rows) {
    const qa = row.question_answers || {};
    const doctorNamesList = row.doctor_names ? row.doctor_names.split(', ') : [];
    
    const idToNameMap = {};
    let doctorIndex = 0;
    
    for (const key of Object.keys(qa)) {
      const match = key.match(/^doctor_(D\d+)_/);
      if (match) {
        const doctorId = match[1];
        if (!idToNameMap[doctorId]) {
          idToNameMap[doctorId] = doctorNamesList[doctorIndex] || doctorId;
          doctorIndex++;
        }
      }
    }
    
    for (const key of Object.keys(qa)) {
      const match = key.match(/^doctor_(D\d+)_(.+)$/);
      if (match) {
        const doctorId = match[1];
        const questionKey = match[2];
        const doctorName = idToNameMap[doctorId] || doctorId;
        const value = qa[key];
        
        if (!doctorStats[doctorName]) {
          doctorStats[doctorName] = {
            doctor_id: doctorId,
            doctor_name: doctorName,
            question_ratings: {}
          };
        }
        
        if (typeof value === 'number' && value >= 1 && value <= 5) {
          if (!doctorStats[doctorName].question_ratings[questionKey]) {
            doctorStats[doctorName].question_ratings[questionKey] = [];
          }
          doctorStats[doctorName].question_ratings[questionKey].push(value);
        }
      }
    }
  }

  const doctorAverages = Object.values(doctorStats).map(d => {
    const allRatings = [];
    const questionRatings = {};
    for (const [qKey, ratings] of Object.entries(d.question_ratings)) {
      const avg = ratings.reduce((a, b) => a + b, 0) / ratings.length;
      questionRatings[qKey] = Math.round(avg * 100) / 100;
      allRatings.push(...ratings);
    }
    const avg = allRatings.length > 0 
      ? allRatings.reduce((a, b) => a + b, 0) / allRatings.length 
      : 0;
    return {
      doctor_id: d.doctor_id,
      doctor_name: d.doctor_name,
      avg_rating: allRatings.length > 0 ? Math.round(avg * 100) / 100 : null,
      rating_count: allRatings.length,
      question_ratings: questionRatings
    };
  }).sort((a, b) => (b.avg_rating || 0) - (a.avg_rating || 0));

  return res.json({
    total_submissions: totals.rows[0] ? totals.rows[0].total_submissions : 0,
    doctor_averages: doctorAverages
  });
});

app.get('/survey', function (_req, res) {
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
});

app.get('/admin', function (_req, res) {
  res.sendFile(path.join(FRONTEND_DIST, 'index.html'));
});

async function boot() {
  await ensureQuestionsTableAndDefaults();
  app.listen(PORT, function () {
    console.log('Server running at ' + BASE_URL);
  });
}

boot().catch((e) => {
  console.error('Boot failed:', e);
  process.exit(1);
});
