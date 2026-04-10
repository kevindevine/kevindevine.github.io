const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = 3000;

const ESPN_URL = 'https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?event=401811941';

// Name normalization map: ESPN name → display name
const NAME_MAP = {
  'J.J. Spaun': 'JJ Spaun',
  'Matthew Fitzpatrick': 'Matt Fitzpatrick',
  'Ludvig Aberg': 'Ludvig Åberg',
  'Robert MacIntyre': 'Robert MacIntyre',
};

function normalizeName(name) {
  return NAME_MAP[name] || name;
}

function parseCompetitors(data) {
  const events = data?.events;
  if (!events || !events.length) return [];

  const event = events[0];
  const competitors = event?.competitions?.[0]?.competitors || [];

  return competitors.map((c) => {
    const rawName = c.athlete?.displayName || 'Unknown';
    const name = normalizeName(rawName);

    // score.value is total strokes to par (signed int). If missing, compute from linescores.
    let totalToPar = null;
    if (c.score != null && c.score.value != null) {
      totalToPar = Number(c.score.value);
    }

    // linescores: each entry has a .value (round stroke total)
    const linescores = c.linescores || [];
    const rounds = linescores.map((ls) => {
      const strokes = ls.value != null ? Number(ls.value) : null;
      // Convert strokes to score to par (par 72)
      return strokes != null ? strokes - 72 : null;
    });

    // If totalToPar is still null, sum rounds
    if (totalToPar === null && rounds.length > 0) {
      totalToPar = rounds.reduce((sum, r) => (r != null ? sum + r : sum), 0);
    }

    // thru and status
    const thru = c.status?.thru != null ? c.status.thru : null;
    const displayValue = c.status?.displayValue || '';
    const isCut = displayValue.toUpperCase().includes('CUT') || displayValue.toUpperCase() === 'WD' || displayValue.toUpperCase() === 'DQ';

    // Position
    const position = c.status?.position?.displayName || c.statistics?.find(s => s.name === 'position')?.displayValue || '';

    return {
      name,
      totalToPar: totalToPar !== null ? totalToPar : 0,
      rounds,  // array of to-par scores per round
      thru,
      displayValue,
      isCut,
      position,
    };
  });
}

app.get('/api/scores', async (req, res) => {
  try {
    const response = await fetch(ESPN_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MaddensMasters/1.0)' },
      timeout: 10000,
    });

    if (!response.ok) {
      return res.status(502).json({ error: `ESPN API returned ${response.status}` });
    }

    const data = await response.json();
    const players = parseCompetitors(data);

    res.json({ players, fetchedAt: new Date().toISOString() });
  } catch (err) {
    console.error('ESPN fetch error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`Madden's Masters running at http://localhost:${PORT}`);
});
