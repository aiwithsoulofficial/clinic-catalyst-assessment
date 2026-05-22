const express = require('express');
const path = require('path');
const app = express();

const AIOS_BACKEND = 'https://aios-assessment.onrender.com';

app.use(express.json());
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

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
app.listen(PORT, () => console.log(`AIOS Assessment (proxy) running on port ${PORT}`));
