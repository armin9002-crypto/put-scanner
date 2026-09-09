import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateMoneyness } from '../src/lib/optionMetrics.ts';
import { shortPutMoneynessPresentation } from '../src/lib/moneynessPresentation.ts';
import { trendStyle } from '../src/lib/etfPulseViewModel.ts';
import { presentUnderlyingTechnicalAssessment } from '../src/lib/underlyingTechnicalPresentation.ts';
import { buildRecommendationVisualFixture } from '../src/lib/recommendations/visualFixtures.ts';

test('short-put moneyness keeps signed math and canonical favorable-risk semantics', () => {
  const otm = calculateMoneyness(100, 90);
  assert.equal(otm.pct, 10);
  assert.equal(otm.state, 'otm');
  assert.equal(otm.label, '10.0% OTM');
  assert.equal(otm.color, 'var(--green)');
  assert.equal(shortPutMoneynessPresentation(otm.state).tone, 'positive');

  const atm = calculateMoneyness(100, 100.3);
  assert.equal(atm.state, 'atm');
  assert.ok(Math.abs(atm.pct + 0.3) < 1e-12);
  assert.equal(shortPutMoneynessPresentation(atm.state).color, 'var(--yellow)');

  const itm = calculateMoneyness(100, 110);
  assert.equal(itm.pct, -10);
  assert.equal(itm.state, 'itm');
  assert.equal(itm.label, '10.0% ITM');
  assert.equal(itm.color, 'var(--red)');
  assert.equal(shortPutMoneynessPresentation(itm.state).tone, 'danger');
});

test('missing or invalid spot stays unknown and never receives favorable short-put treatment', () => {
  for (const spot of [null, undefined, 0, -1, NaN, Infinity, -Infinity]) {
    const moneyness = calculateMoneyness(spot, 90);
    assert.equal(moneyness.pct, null, `spot ${String(spot)} has no signed moneyness`);
    assert.equal(moneyness.state, 'unknown', `spot ${String(spot)} is unknown`);
    assert.equal(moneyness.label, '—');
    assert.equal(moneyness.color, 'var(--text-dim)');
    assert.equal(shortPutMoneynessPresentation(moneyness.state).backgroundColor, null);
  }
});

test('ETF Pulse and Recommendations present the same canonical technical assessment', () => {
  const run = buildRecommendationVisualFixture('actionable');
  const recommendation = run.underlyingAssessments[0];
  const pulseRow = { technicalAssessment: recommendation.technicalAssessment };
  assert.strictEqual(recommendation.technicalAssessment, pulseRow.technicalAssessment);

  const pulse = trendStyle(pulseRow);
  const presentation = presentUnderlyingTechnicalAssessment(recommendation.technicalAssessment);
  assert.equal(pulse.label, presentation.state.label);
  assert.equal(pulse.color, presentation.state.color);
  assert.equal(pulse.bg, presentation.state.backgroundColor);
  assert.equal(pulse.border, presentation.state.borderColor);
  assert.equal(presentation.state.label, recommendation.evidence.find(item => item.label === 'Technical state')?.value);
  assert.ok(['High', 'Moderate', 'Low'].includes(presentation.evidenceQuality.label));
  assert.ok(presentation.signals.structure.length > 0);
  assert.match(presentation.reasonExplanations[0], /technical evidence/i);
  assert.equal('state' in run.market.regime, false, 'Market Regime remains a separate presentation system');
});

test('live moneyness consumers delegate to the shared presentation contract', () => {
  const options = readFileSync(new URL('../src/pages/OptionsPage.tsx', import.meta.url), 'utf8');
  const screener = readFileSync(new URL('../src/pages/ScreenerPage.tsx', import.meta.url), 'utf8');
  const drawer = readFileSync(new URL('../src/components/OptionDetailDrawer.tsx', import.meta.url), 'utf8');
  assert.match(options, /shortPutMoneynessPresentation/);
  assert.doesNotMatch(options, /if \(currentPrice <= 0\) return 'otm'/);
  assert.match(screener, /row\.moneynessColor/);
  assert.match(drawer, /shortPutMoneynessPresentation/);
});
