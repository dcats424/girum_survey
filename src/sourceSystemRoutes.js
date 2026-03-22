function createSourceSystem(deps) {
  const { db, textOrEmpty, makeId, issueSurveyFromPayload, sendSms } = deps;

  async function ensureSourceSystemTables() {
    await db.query(`
      CREATE TABLE IF NOT EXISTS source_patients (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        phone TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS source_doctors (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS source_encounters (
        id TEXT PRIMARY KEY,
        patient_id TEXT NOT NULL REFERENCES source_patients(id),
        status TEXT NOT NULL DEFAULT 'in_progress',
        visit_id TEXT NOT NULL UNIQUE,
        survey_token TEXT,
        survey_link TEXT,
        finished_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS source_encounter_doctors (
        encounter_id TEXT NOT NULL REFERENCES source_encounters(id) ON DELETE CASCADE,
        doctor_id TEXT NOT NULL REFERENCES source_doctors(id),
        PRIMARY KEY (encounter_id, doctor_id)
      )
    `);
  }

  async function getSourceEncounterDetails(encounterId) {
    const encounter = await db.query(
      `SELECT e.id, e.patient_id, e.status, e.visit_id, e.survey_token, e.survey_link, e.finished_at,
              p.name AS patient_name, p.phone AS patient_phone
       FROM source_encounters e
       JOIN source_patients p ON p.id = e.patient_id
       WHERE e.id = $1`,
      [encounterId]
    );

    if (!encounter.rowCount) return null;

    const doctors = await db.query(
      `SELECT d.id, d.name
       FROM source_encounter_doctors ed
       JOIN source_doctors d ON d.id = ed.doctor_id
       WHERE ed.encounter_id = $1
       ORDER BY d.name ASC`,
      [encounterId]
    );

    const row = encounter.rows[0];
    return {
      encounter: row,
      patient: {
        id: row.patient_id,
        name: row.patient_name,
        phone: row.patient_phone || null
      },
      doctors: doctors.rows
    };
  }

  async function getFinishedEncounterByVisitId(visitId) {
    const out = await db.query(
      `SELECT id
       FROM source_encounters
       WHERE visit_id = $1 AND status = 'finished'
       ORDER BY finished_at DESC NULLS LAST, updated_at DESC
       LIMIT 1`,
      [visitId]
    );

    if (!out.rowCount) return null;
    return getSourceEncounterDetails(out.rows[0].id);
  }

  async function processEncounterFinished(encounterId) {
    const details = await getSourceEncounterDetails(encounterId);
    if (!details) return { error: 'encounter_not_found' };

    if (details.encounter.survey_link) {
      return {
        already_generated: true,
        survey_link: details.encounter.survey_link,
        survey_token: details.encounter.survey_token,
        sms: null
      };
    }

    if (!details.doctors.length) return { error: 'encounter_has_no_doctors' };

    const payload = {
      patient: {
        id: details.patient.id,
        name: details.patient.name
      },
      doctors: details.doctors,
      visit_id: details.encounter.visit_id
    };

    const out = await issueSurveyFromPayload(payload, details.patient.phone);

    await db.query(
      `UPDATE source_encounters
       SET survey_token = $1, survey_link = $2, finished_at = COALESCE(finished_at, NOW()), updated_at = NOW()
       WHERE id = $3`,
      [out.token, out.link, encounterId]
    );

    let sms = { ok: false, skipped: true, reason: 'no_phone_provided' };
    if (details.patient.phone) {
      sms = await sendSms({ to: details.patient.phone, message: 'Please provide feedback: ' + out.link });
    }

    return { survey_token: out.token, survey_link: out.link, sms };
  }

  function registerSourceRoutes(app) {
    app.post('/source/patients', async function (req, res) {
      try {
        await ensureSourceSystemTables();
        const id = textOrEmpty(req.body.id) || makeId('SP');
        const name = textOrEmpty(req.body.name);
        const phone = textOrEmpty(req.body.phone) || null;
        if (!name) return res.status(400).json({ error: 'patient_name_required' });

        const out = await db.query(
          `INSERT INTO source_patients(id, name, phone, updated_at)
           VALUES($1, $2, $3, NOW())
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, phone = EXCLUDED.phone, updated_at = NOW()
           RETURNING id, name, phone`,
          [id, name, phone]
        );

        return res.json({ patient: out.rows[0] });
      } catch (e) {
        return res.status(500).json({ error: 'source_patient_upsert_failed', details: e.message });
      }
    });

    app.get('/source/patients', async function (_req, res) {
      try {
        await ensureSourceSystemTables();
        const out = await db.query('SELECT id, name, phone FROM source_patients ORDER BY name ASC, id ASC');
        return res.json({ count: out.rowCount, patients: out.rows });
      } catch (e) {
        return res.status(500).json({ error: 'source_patients_fetch_failed', details: e.message });
      }
    });

    app.post('/source/doctors', async function (req, res) {
      try {
        await ensureSourceSystemTables();
        const id = textOrEmpty(req.body.id) || makeId('SD');
        const name = textOrEmpty(req.body.name);
        if (!name) return res.status(400).json({ error: 'doctor_name_required' });

        const out = await db.query(
          `INSERT INTO source_doctors(id, name, updated_at)
           VALUES($1, $2, NOW())
           ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = NOW()
           RETURNING id, name`,
          [id, name]
        );

        return res.json({ doctor: out.rows[0] });
      } catch (e) {
        return res.status(500).json({ error: 'source_doctor_upsert_failed', details: e.message });
      }
    });

    app.get('/source/doctors', async function (_req, res) {
      try {
        await ensureSourceSystemTables();
        const out = await db.query('SELECT id, name FROM source_doctors ORDER BY name ASC, id ASC');
        return res.json({ count: out.rowCount, doctors: out.rows });
      } catch (e) {
        return res.status(500).json({ error: 'source_doctors_fetch_failed', details: e.message });
      }
    });

    app.post('/source/encounters', async function (req, res) {
      try {
        await ensureSourceSystemTables();
        const patientId = textOrEmpty(req.body.patient_id);
        const doctorIds = Array.isArray(req.body.doctor_ids) ? req.body.doctor_ids.map(textOrEmpty).filter(Boolean) : [];
        const status = textOrEmpty(req.body.status || 'in_progress').toLowerCase();
        const encounterId = textOrEmpty(req.body.id) || makeId('E');
        const visitId = textOrEmpty(req.body.visit_id) || ('SV-' + Date.now());

        if (!patientId) return res.status(400).json({ error: 'patient_id_required' });
        if (!doctorIds.length) return res.status(400).json({ error: 'doctor_ids_required' });
        if (!(status === 'in_progress' || status === 'finished')) return res.status(400).json({ error: 'invalid_status' });

        const patientExists = await db.query('SELECT id FROM source_patients WHERE id = $1', [patientId]);
        if (!patientExists.rowCount) return res.status(400).json({ error: 'patient_not_found' });

        const existingDoctors = await db.query('SELECT id FROM source_doctors WHERE id = ANY($1::text[])', [doctorIds]);
        if (existingDoctors.rowCount !== doctorIds.length) {
          return res.status(400).json({ error: 'one_or_more_doctors_not_found' });
        }

        const client = await db.pool.connect();
        try {
          await client.query('BEGIN');
          await client.query(
            `INSERT INTO source_encounters(id, patient_id, status, visit_id, created_at, updated_at)
             VALUES($1, $2, $3, $4, NOW(), NOW())`,
            [encounterId, patientId, status, visitId]
          );
          for (const doctorId of doctorIds) {
            await client.query('INSERT INTO source_encounter_doctors(encounter_id, doctor_id) VALUES($1, $2)', [encounterId, doctorId]);
          }
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }

        let finishResult = null;
        if (status === 'finished') {
          finishResult = await processEncounterFinished(encounterId);
          if (finishResult.error) return res.status(400).json({ error: finishResult.error });
        }

        const details = await getSourceEncounterDetails(encounterId);
        return res.json({
          encounter: details.encounter,
          patient: details.patient,
          doctors: details.doctors,
          survey_link: details.encounter.survey_link || (finishResult ? finishResult.survey_link : null),
          survey_token: details.encounter.survey_token || (finishResult ? finishResult.survey_token : null),
          sms: finishResult ? finishResult.sms : null
        });
      } catch (e) {
        return res.status(500).json({ error: 'source_encounter_create_failed', details: e.message });
      }
    });

    app.patch('/source/encounters/:id/status', async function (req, res) {
      try {
        await ensureSourceSystemTables();
        const encounterId = req.params.id;
        const status = textOrEmpty(req.body.status).toLowerCase();
        if (!(status === 'in_progress' || status === 'finished')) {
          return res.status(400).json({ error: 'invalid_status' });
        }

        const update = await db.query(
          `UPDATE source_encounters
           SET status = $1, updated_at = NOW(),
               finished_at = CASE WHEN $1 = 'finished' THEN COALESCE(finished_at, NOW()) ELSE finished_at END
           WHERE id = $2
           RETURNING id`,
          [status, encounterId]
        );
        if (!update.rowCount) return res.status(404).json({ error: 'encounter_not_found' });

        let finishResult = null;
        if (status === 'finished') {
          finishResult = await processEncounterFinished(encounterId);
          if (finishResult.error) return res.status(400).json({ error: finishResult.error });
        }

        const details = await getSourceEncounterDetails(encounterId);
        return res.json({
          encounter: details.encounter,
          patient: details.patient,
          doctors: details.doctors,
          survey_link: details.encounter.survey_link || (finishResult ? finishResult.survey_link : null),
          survey_token: details.encounter.survey_token || (finishResult ? finishResult.survey_token : null),
          sms: finishResult ? finishResult.sms : null
        });
      } catch (e) {
        return res.status(500).json({ error: 'source_encounter_status_update_failed', details: e.message });
      }
    });

    app.get('/source/encounters', async function (_req, res) {
      try {
        await ensureSourceSystemTables();
        const out = await db.query(
          `SELECT e.id, e.status, e.visit_id, e.survey_link, e.survey_token, e.finished_at, e.created_at,
                  p.id AS patient_id, p.name AS patient_name
           FROM source_encounters e
           JOIN source_patients p ON p.id = e.patient_id
           ORDER BY e.created_at DESC, e.id DESC`
        );
        return res.json({ count: out.rowCount, encounters: out.rows });
      } catch (e) {
        return res.status(500).json({ error: 'source_encounters_fetch_failed', details: e.message });
      }
    });

    app.get('/source/encounters/:id', async function (req, res) {
      try {
        await ensureSourceSystemTables();
        const details = await getSourceEncounterDetails(req.params.id);
        if (!details) return res.status(404).json({ error: 'encounter_not_found' });
        return res.json({ encounter: details.encounter, patient: details.patient, doctors: details.doctors });
      } catch (e) {
        return res.status(500).json({ error: 'source_encounter_fetch_failed', details: e.message });
      }
    });

    app.get('/source/visit/:id', async function (req, res) {
      try {
        await ensureSourceSystemTables();
        const details = await getSourceEncounterDetails(req.params.id);
        if (!details) return res.status(404).json({ error: 'encounter_not_found' });
        if (details.encounter.status !== 'finished') {
          return res.status(409).json({ error: 'encounter_not_finished' });
        }

        return res.json({
          patient: { id: details.patient.id, name: details.patient.name },
          doctors: details.doctors,
          visit_id: details.encounter.visit_id,
          survey_link: details.encounter.survey_link || null
        });
      } catch (e) {
        return res.status(500).json({ error: 'source_visit_fetch_failed', details: e.message });
      }
    });

    app.get('/source/external/visit/:encounterId', async function (req, res) {
      try {
        await ensureSourceSystemTables();
        const details = await getSourceEncounterDetails(req.params.encounterId);
        if (!details) return res.status(404).json({ error: 'encounter_not_found' });
        if (details.encounter.status !== 'finished') {
          return res.status(409).json({ error: 'encounter_not_finished' });
        }

        return res.json({
          patient: { id: details.patient.id, name: details.patient.name },
          doctors: details.doctors,
          visit_id: details.encounter.visit_id
        });
      } catch (e) {
        return res.status(500).json({ error: 'source_external_visit_failed', details: e.message });
      }
    });

    app.get('/source/external/visit-by-visit/:visitId', async function (req, res) {
      try {
        await ensureSourceSystemTables();
        const details = await getFinishedEncounterByVisitId(req.params.visitId);
        if (!details) return res.status(404).json({ error: 'visit_not_found_or_not_finished' });

        return res.json({
          patient: { id: details.patient.id, name: details.patient.name },
          doctors: details.doctors,
          visit_id: details.encounter.visit_id
        });
      } catch (e) {
        return res.status(500).json({ error: 'source_external_visit_by_visit_failed', details: e.message });
      }
    });
  }

  return {
    ensureSourceSystemTables,
    registerSourceRoutes
  };
}

module.exports = { createSourceSystem };
