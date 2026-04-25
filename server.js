const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());
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
    const response = await fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        agent_id: process.env.ELEVENLABS_AGENT_ID || 'agent_6001kpa99tm7fm5sk5da7h057s3r',
        agent_phone_number_id: process.env.ELEVENLABS_PHONE_ID || 'phnum_3501kpvsp97afx0sy9d0pnzhqwnk',
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Clinic Catalyst Assessment running on port ${PORT}`));
