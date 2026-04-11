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

// Prefer each round's displayValue (to par). During R3/R4, score.displayValue can lag at 36 holes.
function roundToParFromLinescore(ls) {
  if (!ls) return null;
  const dv = ls.displayValue;
  if (dv != null && dv !== '' && dv !== '-' && dv !== '—') {
    const fromDv = parseToParString(dv);
    if (fromDv != null) return fromDv;
  }
  if (ls.value == null) return null;
  const v = Number(ls.value);
  if (v === 0) return null;
  return v > 50 ? v - 72 : v;
}

function computeTotalToPar(c) {
  const lines = c.linescores || [];
  let sum = 0;
  let any = false;
  for (const ls of lines) {
    const p = roundToParFromLinescore(ls);
    if (p != null) {
      sum += p;
      any = true;
    }
  }
  if (any) return sum;

  let total = parseToParString(c.score?.displayValue);
  const roundsFallback = lines.map((ls) => {
    if (ls.value == null) return null;
    const v = Number(ls.value);
    return v > 50 ? v - 72 : v;
  });
  if (total === null && roundsFallback.length > 0) {
    total = roundsFallback.reduce((s, r) => (r != null ? s + r : s), 0);
  }
  return total;
}

function parseCompetitors(data) {
  const events = data?.events;
  if (!events || !events.length) return [];

  const event = events[0];
  const competitors = event?.competitions?.[0]?.competitors || [];

  return competitors.map((c) => {
    const rawName = c.athlete?.displayName || 'Unknown';
    const name = normalizeName(rawName);

    const totalToPar = computeTotalToPar(c);
    const rounds = (c.linescores || []).map((ls) => roundToParFromLinescore(ls));

    const thru = c.status?.thru ?? null;
    const displayValue = c.status?.displayValue || '';
    const dv = displayValue.toUpperCase();
    const isCut = dv.includes('CUT') || dv === 'WD' || dv === 'DQ';
    const position = c.status?.position?.displayName || '';

    return {
      name,
      totalToPar: totalToPar == null ? 0 : totalToPar,
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
