const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// Outbound call trigger - proxies to ElevenLabs
app.post('/api/trigger-call', async (req, res) => {
  const { phone, name } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Phone number required' });
  }

  // Normalise AU number - add +61 if missing
  let toNumber = phone.trim().replace(/\s+/g, '');
  if (toNumber.startsWith('0')) {
    toNumber = '+61' + toNumber.slice(1);
  } else if (!toNumber.startsWith('+')) {
    toNumber = '+' + toNumber;
  }

  try {
    const response = await fetch('https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call', {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agent_id: process.env.ELEVENLABS_AGENT_ID || 'agent_6001kpa99tm7fm5sk5da7h057s3r',
        agent_phone_number_id: process.env.ELEVENLABS_PHONE_ID,
        to_number: toNumber,
        conversation_initiation_client_data: {
          dynamic_variables: {
            customer_name: name || 'there'
          }
        }
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('ElevenLabs error:', data);
      return res.status(response.status).json({ error: 'Call trigger failed', detail: data });
    }

    console.log(`Outbound call triggered to ${toNumber} (${name}) - conversation: ${data.conversation_id}`);
    res.json({ success: true, conversation_id: data.conversation_id });
  } catch (err) {
    console.error('Outbound call error:', err);
    res.status(500).json({ error: 'Internal error triggering call' });
  }
});

// Pre-call assessment submission
app.post('/api/precall', async (req, res) => {
  const d = req.body;

  // Save to Supabase
  const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jiquevvzrdavgqonvvug.supabase.co';
  const SUPABASE_KEY = process.env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImppcXVldnZ6cmRhdmdxb252dnVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE5NzIxNzIsImV4cCI6MjA4NzU0ODE3Mn0.e4mYjXj8TGTC0_UCm3QCKGSv8Cl-migIl7reYIKNcW4';

  try {
    await fetch(SUPABASE_URL + '/rest/v1/clinic_catalyst_leads', {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        name: d.business || 'Unknown',
        email: null,
        phone: null,
        business: d.business || null,
        source: 'precall-assessment',
        score_lead_response: 0,
        score_followup: 0,
        score_booking: 0,
        score_dropoff: 0,
        score_tracking: 0,
        score_retention: 0,
        total_score: 0
      })
    });
  } catch (e) {
    console.error('Supabase save error:', e);
  }

  // Email to Kelly
  const nodemailer = require('nodemailer');
  const SMTP_USER = process.env.SMTP_USER || 'aiwithsoulofficial@gmail.com';
  const SMTP_PASS = process.env.SMTP_PASS;

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
        <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse;width:100%;max-width:600px;">
          <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Business</td><td style="padding:8px;border-bottom:1px solid #eee;">${d.business || '-'}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Website</td><td style="padding:8px;border-bottom:1px solid #eee;">${d.website || '-'}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Social Handle</td><td style="padding:8px;border-bottom:1px solid #eee;">${d.social || '-'}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Running Ads?</td><td style="padding:8px;border-bottom:1px solid #eee;">${d.ads || '-'}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Ad Spend</td><td style="padding:8px;border-bottom:1px solid #eee;">${d.adspend || '-'}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">Booking System</td><td style="padding:8px;border-bottom:1px solid #eee;">${d.booking || '-'}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">CRM</td><td style="padding:8px;border-bottom:1px solid #eee;">${d.crm || '-'}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;">AI Tools</td><td style="padding:8px;border-bottom:1px solid #eee;">${d.ai || '-'}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;color:#E84040;">HATE</td><td style="padding:8px;border-bottom:1px solid #eee;">${d.hate || '-'}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee;font-weight:bold;color:#00D4BC;">LOVE</td><td style="padding:8px;border-bottom:1px solid #eee;">${d.love || '-'}</td></tr>
        </table>
      `;

      await transporter.sendMail({
        from: `Clinic Catalyst <${SMTP_USER}>`,
        to: SMTP_USER,
        subject: `Pre-Call Assessment: ${d.business || 'Unknown Business'}`,
        html: html
      });
      console.log(`Pre-call email sent for ${d.business}`);
    } catch (e) {
      console.error('Email send error:', e);
    }
  } else {
    console.log('SMTP_PASS not set, skipping email. Data:', JSON.stringify(d));
  }

  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Clinic Catalyst Assessment running on port ${PORT}`));
