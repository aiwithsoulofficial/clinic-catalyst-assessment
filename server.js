const express = require('express');
const nodemailer = require('nodemailer');
const path = require('path');
const app = express();

const AIOS_BACKEND = 'https://aios-assessment.onrender.com';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jiquevvzrdavgqonvvug.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImppcXVldnZ6cmRhdmdxb252dnVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NzIxNzIsImV4cCI6MjA4NzU0ODE3Mn0.e4mYjXj8TGTC0_UCm3QCKGSv8Cl-migIl7reYIKNcW4';
const SMTP_USER = process.env.SMTP_USER || 'aiwithsoulofficial@gmail.com';
const SMTP_PASS = process.env.SMTP_PASS;
const GHL_API_KEY = process.env.GHL_API_KEY;
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID;

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Pre-call assessment submission
// They have ALREADY booked a session, so the contact exists in GHL.
// Workflow: 1. FIND them  2. add the assessment as a note on their profile
// 3. email a brief to info@cliniccatalyst.com.au. (Create only as a fallback
// so no submission is ever lost.)
app.post('/api/precall', async (req, res) => {
  const d = req.body;
  const status = { supabase: false, contact: 'none', note: false, emailed: false };

  if (!d.business) {
    return res.status(400).json({ success: false, error: 'Business name required' });
  }

  // Save to Supabase (record of every submission regardless of GHL state)
  try {
    const row = {
      name: d.business,
      business: d.business,
      source: 'precall-assessment',
      website: d.website || null,
      social_handle: d.social || null,
      ads_status: d.ads || null,
      ad_spend: d.adspend || null,
      booking_system: d.booking || null,
      crm: d.crm || null,
      ai_tools: d.ai || null,
      pain_hate: d.hate || null,
      pain_love: d.love || null
    };
    if (d.email) row.email = d.email;
    let sbRes = await fetch(SUPABASE_URL + '/rest/v1/clinic_catalyst_leads', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(row)
    });
    if (!sbRes.ok && d.email) {
      // table may not have an email column - retry with email folded into the record name
      delete row.email;
      row.name = `${d.business} <${d.email}>`;
      sbRes = await fetch(SUPABASE_URL + '/rest/v1/clinic_catalyst_leads', {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': 'Bearer ' + SUPABASE_KEY,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(row)
      });
    }
    status.supabase = sbRes.ok;
    if (!sbRes.ok) {
      const errBody = await sbRes.text().catch(() => '');
      console.error(`Supabase insert failed: HTTP ${sbRes.status} - ${errBody.slice(0, 300)}`);
    }
    console.log(`Supabase: saved precall for ${d.business} (ok=${sbRes.ok})`);
  } catch (e) {
    console.error('Supabase save error:', e);
  }

  // GHL: find the existing contact (they booked already), then note their profile
  if (GHL_API_KEY && GHL_LOCATION_ID) {
    try {
      const ghlHeaders = {
        'Authorization': `Bearer ${GHL_API_KEY}`,
        'Version': '2021-07-28',
        'Content-Type': 'application/json'
      };

      let contactId = null;

      // 1. FIND by the email they booked with
      if (d.email) {
        const q = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(d.email)}&limit=5`, { headers: ghlHeaders });
        const qData = await q.json();
        const match = (qData?.contacts || []).find(c => (c.email || '').toLowerCase() === d.email.toLowerCase()) || (qData?.contacts || [])[0];
        if (match) { contactId = match.id; status.contact = 'found'; }
      }

      // 1b. fall back to business name search
      if (!contactId) {
        const q2 = await fetch(`https://services.leadconnectorhq.com/contacts/?locationId=${GHL_LOCATION_ID}&query=${encodeURIComponent(d.business)}&limit=5`, { headers: ghlHeaders });
        const q2Data = await q2.json();
        const match2 = (q2Data?.contacts || [])[0];
        if (match2) { contactId = match2.id; status.contact = 'found'; }
      }

      // 1c. last resort: create, so the submission is never lost
      if (!contactId) {
        const contactBody = {
          locationId: GHL_LOCATION_ID,
          firstName: d.business,
          companyName: d.business,
          source: 'CC Pre-Call Assessment',
          tags: ['Clinic Catalyst', 'Pre-Call Assessment'],
        };
        if (d.email) contactBody.email = d.email;
        if (d.website) contactBody.website = d.website;
        const ghlRes = await fetch('https://services.leadconnectorhq.com/contacts/', {
          method: 'POST',
          headers: ghlHeaders,
          body: JSON.stringify(contactBody)
        });
        const ghlData = await ghlRes.json();
        if (ghlData?.contact?.id) { contactId = ghlData.contact.id; status.contact = 'created'; }
      }

      if (contactId) {
        // 2. Add assessment as note on their profile
        const noteLines = [
          `=== PRE-CALL ASSESSMENT ===`,
          `Business: ${d.business}`,
          `Email: ${d.email || 'N/A'}`,
          `Website: ${d.website || 'N/A'}`,
          `Social: ${d.social || 'N/A'}`,
          `Ads: ${d.ads || 'N/A'}`,
          `Ad Spend: ${d.adspend || 'N/A'}`,
          `Booking System: ${d.booking || 'N/A'}`,
          `CRM: ${d.crm || 'N/A'}`,
          `AI Tools: ${d.ai || 'N/A'}`,
          ``,
          `HATE (drains energy): ${d.hate || 'N/A'}`,
          `LOVE (would do all day): ${d.love || 'N/A'}`,
        ];

        const noteRes = await fetch(`https://services.leadconnectorhq.com/contacts/${contactId}/notes`, {
          method: 'POST',
          headers: ghlHeaders,
          body: JSON.stringify({ body: noteLines.join('\n') })
        });
        status.note = noteRes.ok;
        console.log(`GHL: ${status.contact} contact + note for ${d.business}`);
      }
    } catch (e) {
      console.error('GHL error:', e);
    }
  }

  // 3. Email a brief to the Clinic Catalyst inbox
  if (SMTP_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 465,
        secure: true,
        auth: { user: SMTP_USER, pass: SMTP_PASS }
      });

      const html = `
        <h2 style="color:#00D4BC;font-family:sans-serif;">New Pre-Call Assessment</h2>
        <p style="font-family:sans-serif;font-size:13px;color:#666;">Submitted ${new Date().toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
        <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;width:100%;max-width:600px;">
          <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:bold;width:140px;">Business</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${d.business || '-'}</td></tr>
          <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:bold;">Email</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${d.email || '-'}</td></tr>
          <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:bold;">Website</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${d.website || '-'}</td></tr>
          <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:bold;">Social Handle</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${d.social || '-'}</td></tr>
          <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:bold;">Running Ads?</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${d.ads || '-'}</td></tr>
          <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:bold;">Ad Spend</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${d.adspend || '-'}</td></tr>
          <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:bold;">Booking System</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${d.booking || '-'}</td></tr>
          <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:bold;">CRM</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${d.crm || '-'}</td></tr>
          <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:bold;">AI Tools</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${d.ai || '-'}</td></tr>
          <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:bold;color:#E84040;">HATE (drains them)</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${d.hate || '-'}</td></tr>
          <tr><td style="padding:10px 12px;border-bottom:1px solid #eee;font-weight:bold;color:#00D4BC;">LOVE (energises them)</td><td style="padding:10px 12px;border-bottom:1px solid #eee;">${d.love || '-'}</td></tr>
        </table>
      `;

      await transporter.sendMail({
        from: `Clinic Catalyst <${SMTP_USER}>`,
        to: 'info@cliniccatalyst.com.au',
        subject: `Pre-Call Assessment: ${d.business}`,
        html: html
      });
      status.emailed = true;
      console.log(`Pre-call brief emailed to info@cliniccatalyst.com.au for ${d.business}`);
    } catch (e) {
      console.error('Email send error:', e);
    }
  } else {
    console.log('SMTP_PASS not set, skipping email. Data:', JSON.stringify(d));
  }

  res.json({ success: true, status });
});

// Proxy /submit to AIOS backend
app.post('/submit', async (req, res) => {
  try {
    const response = await fetch(`${AIOS_BACKEND}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Proxy /submit error:', err);
    res.status(500).json({ success: false, error: 'Backend unavailable' });
  }
});

// Proxy /lookup to AIOS backend
app.post('/lookup', async (req, res) => {
  try {
    const response = await fetch(`${AIOS_BACKEND}/lookup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Proxy /lookup error:', err);
    res.status(500).json({ found: false });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Clinic Catalyst Assessment running on port ${PORT}`));
