import React, { useState } from 'react';
import 'bootstrap/dist/css/bootstrap.min.css';
import { Container, Form, Button, Spinner, Alert, Row, Col } from 'react-bootstrap';

// Frontend-only tool to calculate expected cards exiled by Tasha's Hideous Laughter
// Uses Scryfall API to fetch each card's CMC; uses AllOrigins as a CORS proxy for deck fetch (.dec parsing)

export default function App() {
  const [deckUrl, setDeckUrl] = useState('');
  const [deckText, setDeckText] = useState('');
  const [expectedExile, setExpectedExile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [missingCards, setMissingCards] = useState([]);

  // Background art URL (art crop) from Scryfall; adjust version or resolution as needed
  const bgUrl = "https://api.scryfall.com/cards/named?exact=Tasha%27s%20Hideous%20Laughter&format=image&version=art_crop";

  // Proxy helper
  const proxy = (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;

  const parseDeck = (text) => {
    const headerRegex = /^\d+\s+[A-Z][A-Z\s'-]+$/;
    const lines = text.split(/\r?\n/);
    const items = {};
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (/^sideboard/i.test(trimmed)) return;
      if (headerRegex.test(trimmed)) return;
      const parts = trimmed.split(/\s+/);
      const count = parseInt(parts[0], 10);
      if (isNaN(count)) return;
      const name = parts.slice(1).join(' ');
      items[name] = (items[name] || 0) + count;
    });
    return Object.entries(items).map(([name, count]) => ({ name, count }));
  };

  const fetchCmc = async (name) => {
    const url = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(name)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Card not found: ${name}`);
    const data = await res.json();
    return data.cmc;
  };

  const computeExpected = async (items) => {
    setLoading(true);
    setError('');
    setMissingCards([]);
    try {
      const cmcMap = {};
      const notFound = [];
      await Promise.all(
        items.map(async ({ name }) => {
          try {
            cmcMap[name] = await fetchCmc(name);
          } catch {
            notFound.push(name);
          }
        })
      );
      const validItems = items.filter(({ name }) => cmcMap[name] != null);
      if (validItems.length === 0) throw new Error('No valid cards found');
      const totalCount = validItems.reduce((sum, it) => sum + it.count, 0);
      const totalCmc = validItems.reduce(
        (sum, { name, count }) => sum + cmcMap[name] * count,
        0
      );
      const avgCmc = totalCmc / totalCount;
      if (avgCmc <= 0) throw new Error('Average CMC <= 0');
      setExpectedExile((20 / avgCmc).toFixed(2));
      if (notFound.length) setMissingCards([...new Set(notFound)]);
    } catch (e) {
      setError(e.message);
      setExpectedExile(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchDeck = async () => {
    setError('');
    setDeckText('');
    try {
      // 1. Fetch event page HTML
      const pageRes = await fetch(proxy(deckUrl));
      if (!pageRes.ok) throw new Error('Failed to fetch deck page');
      const html = await pageRes.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // 2. Locate .dec link
      const decAnchor = doc.querySelector('a[href$=".dec"], a[href*="?d="]');
      if (!decAnchor) throw new Error('.dec link not found');
      let decUrl = decAnchor.getAttribute('href');
      if (!decUrl.startsWith('http')) {
        decUrl = decUrl.startsWith('/') ? `https://mtgtop8.com${decUrl}` : `https://mtgtop8.com/${decUrl}`;
      }

      // 3. Fetch .dec raw
      const decRes = await fetch(proxy(decUrl));
      if (!decRes.ok) throw new Error('Failed to fetch .dec file');
      const decText = await decRes.text();

      // 4. Parse .dec entries: include main deck, exclude sideboard
      const allLines = decText.split(/\r?\n/);
      let inMain = true;
      const entries = [];
      allLines.forEach((raw) => {
        const line = raw.trim();
        if (!line) return;
        if (/^SB[:\s]/i.test(line) || /^sideboard/i.test(line)) {
          inMain = false;
          return;
        }
        if (!inMain) return;
        const match = line.match(/^([0-9]+)\s+(.*)$/);
        if (match) entries.push(`${match[1]} ${match[2]}`);
      });
      if (entries.length === 0) throw new Error('No deck entries in .dec');
      setDeckText(entries.join('\n'));
    } catch (e) {
      setError(`Load deck failed: ${e.message}`);
    }
  };

  const handleCalculate = () => {
    const items = parseDeck(deckText);
    computeExpected(items);
  };

  return (
    <div
      style={{
        backgroundImage: `url(${bgUrl})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        minHeight: '100vh',
      }}
    >
      <div style={{ backgroundColor: 'rgba(255,255,255,0.5)', minHeight: '100vh' }}>
        <Container className="py-4">
          <h1 className="mb-4 text-center">Tasha's Hideous Calculator</h1>

          <Form>
            <Form.Group as={Row} controlId="deckUrl">
              <Form.Label column sm={3}>Deck URL</Form.Label>
              <Col sm={7}>
                <Form.Control
                  type="text"
                  placeholder="https://mtgtop8.com/event?..."
                  value={deckUrl}
                  onChange={(e) => setDeckUrl(e.target.value)}
                />
              </Col>
              <Col sm={2}>
                <Button variant="primary" onClick={fetchDeck} disabled={!deckUrl.trim()}>
                  Load
                </Button>
              </Col>
            </Form.Group>

            <Form.Group controlId="deckText" className="mt-3">
              <Form.Label>Or Paste Decklist</Form.Label>
              <Form.Control
                as="textarea"
                rows={8}
                placeholder="4 Lightning Bolt\n2 Counterspell\n24 Island\n..."
                value={deckText}
                onChange={(e) => setDeckText(e.target.value)}
              />
            </Form.Group>

            <div className="text-center mt-4">
              <Button
                variant="success"
                size="lg"
                onClick={handleCalculate}
                disabled={loading || !deckText.trim()}>
                {loading ? <Spinner as="span" animation="border" size="sm" /> : 'Calculate Expected Exile'}
              </Button>
            </div>
          </Form>

          <div className="mt-4">
            {error && <Alert variant="danger">{error}</Alert>}
            {missingCards.length > 0 && (
              <Alert variant="warning">Ignored (not found): {missingCards.join(', ')}</Alert>
            )}
            {expectedExile !== null && !loading && (
              <Alert variant="info">
                Expected cards exiled: <strong>{expectedExile}</strong>
              </Alert>
            )}
          </div>
        </Container>
      </div>
    </div>
  );
}