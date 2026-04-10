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

// Parse ESPN's score displayValue: "E" → 0, "-8" → -8, "+4" → 4
function parseToParString(str) {
  if (str == null) return null;
  const s = String(str).trim().toUpperCase();
  if (s === 'E' || s === 'EVEN') return 0;
  const n = parseFloat(s.replace('+', ''));
  return isNaN(n) ? null : n;
}

function parseCompetitors(data) {
  const events = data?.events;
  if (!events || !events.length) return [];

  const event = events[0];
  const competitors = event?.competitions?.[0]?.competitors || [];

  return competitors.map((c) => {
    const rawName = c.athlete?.displayName || 'Unknown';
    const name = normalizeName(rawName);

    // score.displayValue is the reliable to-par string: "-8", "E", "+4"
    // score.value may be total strokes (e.g. 136) so we avoid it
    let totalToPar = parseToParString(c.score?.displayValue);

    // linescores: .value is either stroke total (completed round, e.g. 68)
    // or already to-par (in-progress round, e.g. -3). Heuristic: >50 = strokes.
    const rounds = (c.linescores || []).map((ls) => {
      if (ls.value == null) return null;
      const v = Number(ls.value);
      return v > 50 ? v - 72 : v;
    });

    // Fallback: derive total from sum of round scores
    if (totalToPar === null && rounds.length > 0) {
      totalToPar = rounds.reduce((sum, r) => (r != null ? sum + r : sum), 0);
    }

    const thru = c.status?.thru ?? null;
    const displayValue = c.status?.displayValue || '';
    const dv = displayValue.toUpperCase();
    const isCut = dv.includes('CUT') || dv === 'WD' || dv === 'DQ';
    const position = c.status?.position?.displayName || '';

    return {
      name,
      totalToPar: totalToPar ?? 0,
      rounds,
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
