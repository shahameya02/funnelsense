import { useState, useEffect } from 'react';

// ── Palette ───────────────────────────────────────────────────────────────────
const BAR_COLORS = ['#f97316', '#fb923c', '#fdba74', '#fcd34d', '#fde68a'];

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}
function pct(a, b) {
  if (!b) return '0';
  return ((a / b) * 100).toFixed(1);
}
function fmtDollar(n) {
  return '$' + Math.round(n).toLocaleString('en-US');
}

// ── Updated 2026 Benchmarks ───────────────────────────────────────────────────
// Sources: Shopify 2026, Triple Whale analysis of 30,000+ brands, IRP Commerce
const BENCHMARKS = {
  'E-commerce':  { labels: ['Homepage→Product','Product→Cart','Cart→Checkout','Checkout→Purchase'], rates: [45, 60, 50, 35] },
  'SaaS':        { labels: ['Landing→Signup','Signup→Activation','Activation→Trial','Trial→Paid'],  rates: [60, 45, 40, 25] },
  'Mobile App':  { labels: ['Install→Onboard','Onboard→Action','Action→Return','Return→Subscribe'], rates: [50, 45, 40, 30] },
  'Healthcare':  { labels: ['Awareness→Interest','Interest→Consideration','Consideration→Intent','Intent→Action'], rates: [65, 55, 45, 35] },
};
const DEFAULT_BENCHMARKS = { labels: ['Stage1→2','Stage2→3','Stage3→4','Stage4→5'], rates: [55, 45, 40, 30] };
const BENCHMARK_SOURCE   = 'Benchmarks sourced from Shopify 2026, Triple Whale analysis of 30,000+ brands, and IRP Commerce industry data';

// ── Prompt builder ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior growth analyst with 10 years of conversion optimization experience across e-commerce, SaaS, and mobile apps. You think in hypotheses, not observations. You never say what the data shows — you say what it means and what to do about it. You are briefing a PM who needs to act today. Be specific, be confident, be direct.`;

function buildPrompts(industry, chartData, overallRate, bench) {
  const benchData = bench || BENCHMARKS[industry] || DEFAULT_BENCHMARKS;

  const stageLines = chartData.map((d, i) => {
    const prev    = i > 0 ? chartData[i - 1].value : null;
    const dropPct = prev ? ((prev - d.value) / prev * 100).toFixed(1) : null;
    const fromTop = pct(d.value, chartData[0].value);
    return dropPct
      ? `Stage ${i + 1}: ${d.name} — ${d.value.toLocaleString()} users | ${dropPct}% drop-off from previous | ${fromTop}% remaining from top`
      : `Stage ${i + 1}: ${d.name} — ${d.value.toLocaleString()} users | top of funnel`;
  }).join('\n');

  const benchLines = benchData.labels.map((label, i) =>
    `  - ${label}: ${benchData.rates[i]}% retention (${100 - benchData.rates[i]}% expected drop-off)`
  ).join('\n');

  const userPrompt = `Analyze this ${industry} conversion funnel:

${stageLines}

Overall conversion rate: ${overallRate}% (top to bottom)

Industry benchmarks for ${industry}:
${benchLines}

For each stage, tell me: is this above or below benchmark? By how much?

Then give me:
1. THE VERDICT: One punchy sentence — is this funnel healthy, concerning, or broken?
2. BIGGEST LEAK: The single worst drop-off point. Give me 3 ranked hypotheses for WHY with probability scores and specific evidence I should look for.
3. REVENUE IMPACT: If we fix the biggest leak by just 10%, how many more conversions does that add? Show the math.
4. STAGE BY STAGE: For each drop-off, one sentence diagnosis — above/below benchmark and most likely cause.
5. TOP 3 ACTIONS: Specific things to do this week, ranked by expected impact. Not generic advice — specific to this industry and these numbers.

Respond ONLY in this exact JSON format, no extra text:
{
  "verdict": { "text": "punchy one sentence", "health": "healthy|concerning|broken" },
  "biggest_leak": {
    "stage": "stage name",
    "dropoff": "XX%",
    "benchmark": "XX%",
    "vs_benchmark": "X% above/below benchmark",
    "hypotheses": [
      { "rank": 1, "probability": "High", "reason": "specific reason", "evidence_to_check": "what to look for" },
      { "rank": 2, "probability": "Medium", "reason": "specific reason", "evidence_to_check": "what to look for" },
      { "rank": 3, "probability": "Low", "reason": "specific reason", "evidence_to_check": "what to look for" }
    ]
  },
  "revenue_impact": {
    "current_conversions": 0,
    "if_improved_10_percent": 0,
    "additional_conversions": 0,
    "calculation": "show the math as a string"
  },
  "stage_analysis": [
    { "stage": "name", "dropoff": "XX%", "benchmark": "XX%", "status": "above|below|on_par", "diagnosis": "one sentence" }
  ],
  "actions": [
    { "rank": 1, "priority": "High", "action": "specific action", "impact": "expected result", "timeframe": "this week" },
    { "rank": 2, "priority": "Medium", "action": "specific action", "impact": "expected result", "timeframe": "this month" },
    { "rank": 3, "priority": "Low", "action": "specific action", "impact": "expected result", "timeframe": "this month" }
  ]
}`;

  return { systemPrompt: SYSTEM_PROMPT, userPrompt };
}

// ── Groq API call ─────────────────────────────────────────────────────────────

async function callGroq(systemPrompt, userPrompt) {
  const apiKey = process.env.REACT_APP_GROQ_API_KEY;
  if (!apiKey) throw new Error('no-key');

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userPrompt   },
      ],
      temperature: 0.3,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `API error ${res.status}`);
  }

  const body    = await res.json();
  const raw     = body.choices[0].message.content.trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

// ── AI Benchmark fetch (for industries not in the hardcoded list) ─────────────

async function fetchAiBenchmarks(industry) {
  const apiKey = process.env.REACT_APP_GROQ_API_KEY;
  if (!apiKey) throw new Error('no-key');

  const prompt = `You are a market research analyst. Provide realistic conversion funnel benchmarks for the ${industry} industry based on published industry data. Return ONLY this JSON: { "source": "AI-estimated based on industry data", "benchmarks": { "stage1_to_stage2": XX, "stage2_to_stage3": XX, "stage3_to_stage4": XX, "stage4_to_stage5": XX, "overall_conversion": XX }, "context": "one sentence explaining what drives conversion in this industry" }. Use realistic numbers based on known industry patterns.`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    }),
  });

  if (!res.ok) throw new Error(`Benchmark API error ${res.status}`);
  const body    = await res.json();
  const raw     = body.choices[0].message.content.trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(cleaned);
}

// ── What-If Simulator ─────────────────────────────────────────────────────────

function WhatIfSimulator({ chartData, aovNum }) {
  const [improvements, setImprovements] = useState(Array(chartData.length).fill(0));
  // Track which values just changed for animation
  const [flashing, setFlashing] = useState(Array(chartData.length).fill(false));

  function handleSlider(idx, val) {
    const next = [...improvements];
    next[idx]  = Number(val);
    setImprovements(next);

    // Flash the changed row
    const f = Array(chartData.length).fill(false);
    f[idx]   = true;
    setFlashing(f);
    setTimeout(() => setFlashing(Array(chartData.length).fill(false)), 600);
  }

  // Simulate the funnel with improvements applied stage-by-stage
  function simulate() {
    const simValues = [chartData[0].value];
    for (let i = 1; i < chartData.length; i++) {
      const origRate = chartData[i].value / chartData[i - 1].value;  // original retention rate
      const improved = Math.min(origRate + (improvements[i] / 100), 1);
      simValues.push(Math.round(simValues[i - 1] * improved));
    }
    return simValues;
  }

  const simValues      = simulate();
  const origFinal      = chartData[chartData.length - 1].value;
  const simFinal       = simValues[simValues.length - 1];
  const totalGainConv  = simFinal - origFinal;
  const totalGainRev   = totalGainConv * aovNum;
  const hasAnyChange   = improvements.some(v => v > 0);

  return (
    <div className="wif-section no-print">
      <div className="wif-header">
        <span className="wif-icon">⚡</span>
        <h2 className="wif-title">What-If Revenue Simulator</h2>
        <span className="wif-hint">Drag sliders to model improvements at each stage</span>
      </div>

      <div className="wif-rows">
        {chartData.map((d, i) => {
          const origVal = d.value;
          const simVal  = simValues[i];
          const delta   = simVal - origVal;

          return (
            <div key={d.name} className={`wif-row ${flashing[i] ? 'wif-flash' : ''}`}>
              <div className="wif-row-left">
                <span className="wif-stage-name">{d.name}</span>
                <div className="wif-slider-wrap">
                  <input
                    type="range"
                    min="0" max="50" step="1"
                    value={improvements[i]}
                    onChange={e => handleSlider(i, e.target.value)}
                    className="wif-slider"
                  />
                  <span className="wif-slider-label">+{improvements[i]}%</span>
                </div>
              </div>
              <div className="wif-row-right">
                <span className="wif-orig">{origVal.toLocaleString()}</span>
                {delta > 0 && (
                  <span className="wif-new">
                    → {simVal.toLocaleString()}
                    <span className="wif-delta">+{delta.toLocaleString()}</span>
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className={`wif-total ${hasAnyChange ? 'wif-total-active' : ''}`}>
        <span className="wif-total-label">Total potential gain</span>
        <span className="wif-total-val">
          {hasAnyChange
            ? <>+{totalGainConv.toLocaleString()} conversions · <span className="wif-total-rev">+{fmtDollar(totalGainRev)}</span> revenue</>
            : 'Move a slider to see impact'
          }
        </span>
      </div>
    </div>
  );
}

// ── Prompt syntax highlighter ─────────────────────────────────────────────────

function HighlightedPrompt({ text }) {
  const lines = text.split('\n');
  return (
    <div className="prompt-code">
      {lines.map((line, i) => {
        if (/^──/.test(line)) return <div key={i} className="pc-section">{line}</div>;
        if (/^Stage \d+:/.test(line)) {
          const parts = line.replace(/^(Stage \d+: )([^—]+)(—.*)/, (_, prefix, name, rest) =>
            `__PREFIX__${prefix}__NAME__${name.trim()}__REST__${rest}`
          );
          if (parts.includes('__PREFIX__')) {
            const [, prefix, name, rest] = parts.split(/__(?:PREFIX|NAME|REST)__/);
            const restH = rest.replace(/(\d[\d,.]*)/g, m => `__NUM__${m}__`);
            return (
              <div key={i} className="pc-stage-line">
                <span className="pc-dim">{prefix}</span>
                <span className="pc-stage-name">{name}</span>
                {restH.split(/(__NUM__[\d,.]+__)/).map((p, j) =>
                  p.startsWith('__NUM__')
                    ? <span key={j} className="pc-num">{p.replace(/__NUM__|__/g, '')}</span>
                    : <span key={j} className="pc-dim">{p}</span>
                )}
              </div>
            );
          }
        }
        if (/\d/.test(line) && !line.startsWith('  ') && !line.startsWith('{') && !line.startsWith('"')) {
          return (
            <div key={i} className="pc-line">
              {line.split(/(\d[\d,.%]*)/).map((p, j) =>
                /^\d/.test(p) ? <span key={j} className="pc-num">{p}</span> : <span key={j} className="pc-dim">{p}</span>
              )}
            </div>
          );
        }
        if (/^[{}"[\]]/.test(line) || /^ {2}["{}[\]]/.test(line)) return <div key={i} className="pc-schema">{line}</div>;
        return <div key={i} className="pc-dim">{line || '\u00A0'}</div>;
      })}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function AiSkeleton() {
  return (
    <div className="ai-section">
      <div className="ai-section-header">
        <span className="ai-section-icon">✦</span>
        <h2 className="ai-section-title">AI Analysis</h2>
        <span className="ai-generating-label">Analyzing your funnel with AI…</span>
      </div>
      <div className="ai-skeleton-wrap">
        <div className="skel skel-verdict" />
        <div className="skel skel-alert" />
        <div className="skel-row">
          <div className="skel skel-card" />
          <div className="skel skel-card" />
        </div>
        <div className="skel skel-table" />
        <div className="skel skel-table" />
      </div>
    </div>
  );
}

function AiError({ message }) {
  return (
    <div className="ai-section">
      <div className="ai-section-header">
        <span className="ai-section-icon">✦</span>
        <h2 className="ai-section-title">AI Analysis</h2>
      </div>
      <div className="ai-error-box">
        <span className="ai-error-icon">⚠</span>
        <div>
          <p className="ai-error-title">AI analysis unavailable</p>
          <p className="ai-error-sub">
            {message === 'no-key'
              ? 'Add REACT_APP_GROQ_API_KEY to your .env.local file and restart the server.'
              : `Check your API key or try again. (${message})`}
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Revenue scenario calculators ─────────────────────────────────────────────

// Scenario 1: worst drop-off stage improves by 10pp, cascades end-to-end
function calcBiggestLeak10pct(chartData) {
  let worstIdx = -1;
  let worstDrop = -Infinity;
  for (let i = 1; i < chartData.length; i++) {
    const drop = chartData[i - 1].value - chartData[i].value;
    if (drop > worstDrop) { worstDrop = drop; worstIdx = i; }
  }
  if (worstIdx === -1) return { addConv: 0, subtitle: '', math: '' };

  const prevVal  = chartData[worstIdx - 1].value;
  const currVal  = chartData[worstIdx].value;
  const origRate = currVal / prevVal;
  const newRate  = Math.min(origRate + 0.10, 1.0);
  const prevName = chartData[worstIdx - 1].name;
  const stageName = chartData[worstIdx].name;
  const origDrop = ((1 - origRate) * 100).toFixed(0);
  const newDrop  = ((1 - newRate) * 100).toFixed(0);

  // Fix worst stage, cascade remaining stages at original rates
  const sim = chartData.map(d => d.value);
  sim[worstIdx] = Math.round(prevVal * newRate);
  for (let i = worstIdx + 1; i < chartData.length; i++) {
    const rate = chartData[i].value / chartData[i - 1].value;
    sim[i] = Math.round(sim[i - 1] * rate);
  }

  const addConv = sim[sim.length - 1] - chartData[chartData.length - 1].value;
  return {
    addConv,
    subtitle: `${prevName} → ${stageName} drop-off reduced by 10%`,
    math:     `Reducing ${prevName}→${stageName} from ${origDrop}% to ${newDrop}% drop-off adds ${addConv.toLocaleString()} purchases`,
  };
}

// Scenario 2: every stage retention rate +5%, cascades end-to-end
function calcAllStages5pct(chartData) {
  const sim = [chartData[0].value];
  for (let i = 1; i < chartData.length; i++) {
    const orig     = chartData[i].value / chartData[i - 1].value;
    const improved = Math.min(orig + 0.05, 1.0);
    sim.push(Math.round(sim[i - 1] * improved));
  }
  const addConv = sim[sim.length - 1] - chartData[chartData.length - 1].value;
  return {
    addConv,
    subtitle: `Every stage retention rate improves by 5%`,
    math:     `${chartData.length - 1} stages × +5% retention compounds to ${addConv.toLocaleString()} more purchases`,
  };
}

// Scenario 3: worst stage vs benchmark reaches benchmark retention rate, cascades forward
function calcBenchmarkScenario(chartData, bench) {
  if (!bench?.rates?.length) return null;

  let worstIdx = -1;
  let worstDeficit = -Infinity;
  for (let i = 1; i < chartData.length; i++) {
    const bIdx = i - 1;
    if (bIdx >= bench.rates.length) continue;
    const deficit = (bench.rates[bIdx] / 100) - (chartData[i].value / chartData[i - 1].value);
    if (deficit > worstDeficit) { worstDeficit = deficit; worstIdx = i; }
  }
  if (worstIdx === -1 || worstDeficit <= 0) return null;

  const bIdx           = worstIdx - 1;
  const benchRetention = bench.rates[bIdx] / 100;
  const currentDrop    = ((1 - chartData[worstIdx].value / chartData[worstIdx - 1].value) * 100).toFixed(0);
  const benchDrop      = (100 - bench.rates[bIdx]).toFixed(0);
  const prevName       = chartData[worstIdx - 1].name;
  const stageName      = chartData[worstIdx].name;

  const sim = [chartData[0].value];
  for (let i = 1; i < chartData.length; i++) {
    const rate = i === worstIdx ? benchRetention : chartData[i].value / chartData[i - 1].value;
    sim.push(Math.round(sim[i - 1] * rate));
  }

  const addConv = sim[sim.length - 1] - chartData[chartData.length - 1].value;
  return {
    addConv,
    subtitle: `${prevName} → ${stageName} reaches industry benchmark`,
    math:     `Improving ${prevName}→${stageName} from ${currentDrop}% to ${benchDrop}% drop-off adds ${addConv.toLocaleString()} purchases`,
  };
}

// ── AI Results ────────────────────────────────────────────────────────────────

const HEALTH_CLASS = { healthy: 'verdict-healthy', concerning: 'verdict-concerning', broken: 'verdict-broken' };
const HEALTH_LABEL = { healthy: 'Healthy', concerning: 'Concerning', broken: 'Broken' };
const PROB_CLASS   = { High: 'prob-high', Medium: 'prob-med', Low: 'prob-low' };
const PRI_CLASS    = { High: 'pri-high',  Medium: 'pri-med',  Low: 'pri-low'  };

function AiResults({ ai, promptText, aov, setAov, benchInfo, chartData, resolvedBench }) {
  const [expandedHyp, setExpandedHyp] = useState(null);

  const health      = ai.verdict?.health || 'concerning';
  const healthClass = HEALTH_CLASS[health] || 'verdict-concerning';

  const aovNum = Number(aov) || 50;

  // All three scenarios computed from actual funnel data end-to-end
  const s1 = chartData ? calcBiggestLeak10pct(chartData)              : null;
  const s2 = chartData ? calcAllStages5pct(chartData)                  : null;
  const s3 = chartData && resolvedBench ? calcBenchmarkScenario(chartData, resolvedBench) : null;

  return (
    <div className="ai-section">
      <div className="ai-section-header">
        <span className="ai-section-icon">✦</span>
        <h2 className="ai-section-title">AI Analysis</h2>
      </div>

      {/* 1. Verdict */}
      <div className={`ai-verdict-banner ${healthClass}`}>
        <span className={`ai-verdict-health-badge ${healthClass}`}>
          {health === 'healthy' ? '✓' : health === 'broken' ? '✗' : '!'}{' '}
          {HEALTH_LABEL[health]}
        </span>
        <p className="ai-verdict-text">{ai.verdict?.text}</p>
      </div>

      {/* 2. Biggest Leak */}
      {ai.biggest_leak && (
        <div className="ai-leak-card">
          <div className="ai-leak-header">
            <span className="ai-leak-icon">🔴</span>
            <span className="ai-leak-title">Biggest Leak</span>
            <span className="ai-leak-stage-badge">{ai.biggest_leak.stage}</span>
            <div className="ai-leak-rates">
              <span className="ai-leak-dropoff">{ai.biggest_leak.dropoff} drop-off</span>
              {ai.biggest_leak.vs_benchmark && (
                <span className="ai-leak-vs-bench">{ai.biggest_leak.vs_benchmark}</span>
              )}
            </div>
          </div>
          <div className="ai-hyp-list">
            {ai.biggest_leak.hypotheses?.map((hyp, i) => (
              <div key={i} className="ai-hyp-item">
                <button className="ai-hyp-trigger" onClick={() => setExpandedHyp(expandedHyp === i ? null : i)}>
                  <span className="ai-hyp-rank">#{hyp.rank}</span>
                  <span className={`ai-hyp-prob ${PROB_CLASS[hyp.probability] || 'prob-med'}`}>{hyp.probability}</span>
                  <span className="ai-hyp-reason">{hyp.reason}</span>
                  <span className="ai-hyp-chevron">{expandedHyp === i ? '▴' : '▾'}</span>
                </button>
                {expandedHyp === i && (
                  <div className="ai-hyp-evidence">
                    <span className="ai-hyp-ev-label">Evidence to check</span>
                    <p className="ai-hyp-ev-text">{hyp.evidence_to_check}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Revenue Impact — Three Scenarios */}
      <div className="ai-revenue-card">
        <div className="ai-revenue-card-top">
          <p className="ai-revenue-title">Revenue Impact — Three Scenarios</p>
          <div className="ai-revenue-aov">
            <label className="ai-revenue-aov-label" htmlFor="aov-input">Avg. Order Value ($)</label>
            <input
              id="aov-input" type="number" min="1"
              className="input ai-revenue-aov-input"
              value={aov}
              onChange={e => setAov(e.target.value)}
            />
          </div>
        </div>

        <div className="rev-scenarios-grid">
          {s1 && (
            <div className="rev-scenario-card">
              <p className="rev-scenario-label">Scenario 1</p>
              <p className="rev-scenario-title">Fix Biggest Leak</p>
              <p className="rev-scenario-subtitle">{s1.subtitle}</p>
              <p className="rev-scenario-gain">+{fmtDollar(s1.addConv * aovNum)}</p>
              <p className="rev-scenario-conv">+{s1.addConv.toLocaleString()} conversions</p>
              <p className="rev-scenario-math">{s1.math}</p>
            </div>
          )}

          {s2 && (
            <div className="rev-scenario-card">
              <p className="rev-scenario-label">Scenario 2</p>
              <p className="rev-scenario-title">Fix All Stages +5%</p>
              <p className="rev-scenario-subtitle">{s2.subtitle}</p>
              <p className="rev-scenario-gain">+{fmtDollar(s2.addConv * aovNum)}</p>
              <p className="rev-scenario-conv">+{s2.addConv.toLocaleString()} conversions</p>
              <p className="rev-scenario-math">{s2.math}</p>
            </div>
          )}

          {s3 && s3.addConv > 0 && (
            <div className="rev-scenario-card rev-scenario-centerpiece">
              <p className="rev-scenario-label rev-scenario-label-star">★ Best Opportunity</p>
              <p className="rev-scenario-title">Reach Industry Benchmark</p>
              <p className="rev-scenario-subtitle">{s3.subtitle}</p>
              <p className="rev-scenario-gain rev-scenario-gain-big">+{fmtDollar(s3.addConv * aovNum)}</p>
              <p className="rev-scenario-conv">+{s3.addConv.toLocaleString()} conversions</p>
              <p className="rev-scenario-math">{s3.math}</p>
            </div>
          )}
        </div>
      </div>

      {/* 4. Stage Analysis */}
      {ai.stage_analysis?.length > 0 && (
        <div className="ai-sa-wrap">
          <p className="ai-sa-title">
            Stage-by-Stage vs Benchmark
            <span className="bench-tooltip-wrap">
              <span className={`bench-badge ${benchInfo?.type === 'ai-estimated' ? 'bench-ai-estimated' : 'bench-verified'}`}>
                {benchInfo?.type === 'ai-estimated' ? '✦ AI-Estimated' : '✓ Verified'}
              </span>
              <span className="bench-info-icon">ⓘ</span>
              <span className="bench-tooltip">
                {benchInfo?.type === 'ai-estimated'
                  ? `${benchInfo.source}${benchInfo.context ? ` · ${benchInfo.context}` : ''}`
                  : BENCHMARK_SOURCE}
              </span>
            </span>
          </p>
          <div className="ai-sa-table">
            <div className="ai-sa-head">
              <span>Stage</span><span>Drop-off</span>
              <span>Benchmark</span><span>Status</span><span>Diagnosis</span>
            </div>
            {ai.stage_analysis.map((s, i) => (
              <div key={i} className={`ai-sa-row ${i % 2 === 1 ? 'ai-sa-row-alt' : ''}`}>
                <span className="ai-sa-stage">{s.stage}</span>
                <span className="ai-sa-dropoff">{s.dropoff}</span>
                <span className="ai-sa-bench">{s.benchmark}</span>
                <span className={`ai-sa-status sa-${s.status}`}>
                  {s.status === 'above' ? '↑ Above' : s.status === 'below' ? '↓ Below' : '= On par'}
                </span>
                <span className="ai-sa-diagnosis">{s.diagnosis}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Actions */}
      {ai.actions?.length > 0 && (
        <div className="ai-actions-wrap">
          <p className="ai-actions-title">Top Actions for This Week</p>
          <div className="ai-actions-grid">
            {ai.actions.map((a, i) => (
              <div key={i} className={`ai-action-card ${a.priority === 'High' ? 'ai-action-high' : ''}`}>
                <div className="ai-action-top">
                  <span className="ai-action-rank-num">#{a.rank}</span>
                  <span className={`priority-badge ${PRI_CLASS[a.priority] || 'pri-med'}`}>{a.priority}</span>
                  <span className="ai-action-timeframe-tag">{a.timeframe}</span>
                </div>
                <p className="ai-action-text">{a.action}</p>
                <p className="ai-action-impact">→ {a.impact}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Prompt toggle */}
      <details className="ai-prompt-toggle no-print">
        <summary className="ai-prompt-summary">
          <span className="ai-prompt-summary-icon">{'</>'}</span>
          Prompt Engineering — What FunnelSense sends to Groq LLaMA 3.3 70B
        </summary>
        <HighlightedPrompt text={promptText} />
      </details>
    </div>
  );
}

// ── Drop-off row ──────────────────────────────────────────────────────────────

function DropOff({ from, to }) {
  const dropped = from - to;
  const dropPct = from > 0 ? ((dropped / from) * 100).toFixed(1) : '0';
  return (
    <div className="dropoff-row">
      <span className="dropoff-arrow">↓</span>
      <span className="dropoff-pct">{dropPct}% dropped off</span>
      <span className="dropoff-abs">{fmt(dropped)} users lost</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FunnelResults({ data, industry, onBack }) {
  const stages = [
    { key: 'homepage',  name: 'Homepage'    },
    { key: 'product',   name: 'Product'     },
    { key: 'addToCart', name: 'Add to Cart' },
    { key: 'checkout',  name: 'Checkout'    },
    { key: 'purchase',  name: 'Purchase'    },
  ];

  const chartData = stages.map((s, i) => ({
    name:     s.name,
    value:    data[s.key] || 0,
    convRate: data.homepage > 0 ? pct(data[s.key] || 0, data.homepage) : '0',
    color:    BAR_COLORS[i],
  }));

  const topValue    = chartData[0].value;
  const bottomValue = chartData[chartData.length - 1].value;
  const overallRate = pct(bottomValue, topValue);

  const scaledData = chartData.map(d => ({
    ...d,
    widthPct: topValue > 0 ? (d.value / topValue) * 100 : 0,
  }));

  const [aiState,       setAiState]       = useState('loading');
  const [aiData,        setAiData]        = useState(null);
  const [aiError,       setAiError]       = useState('');
  const [promptText,    setPromptText]    = useState('');
  const [benchInfo,     setBenchInfo]     = useState(null);
  const [resolvedBench, setResolvedBench] = useState(null);
  // AOV is shared between AiResults and WhatIfSimulator
  const [aov, setAov] = useState(50);

  useEffect(() => {
    async function run() {
      let bench;
      if (BENCHMARKS[industry]) {
        bench = BENCHMARKS[industry];
        setBenchInfo({ type: 'verified', source: BENCHMARK_SOURCE });
        setResolvedBench(bench);
      } else {
        try {
          const aiBench = await fetchAiBenchmarks(industry);
          bench = {
            labels: ['Stage1→2', 'Stage2→3', 'Stage3→4', 'Stage4→5'],
            rates: [
              aiBench.benchmarks.stage1_to_stage2,
              aiBench.benchmarks.stage2_to_stage3,
              aiBench.benchmarks.stage3_to_stage4,
              aiBench.benchmarks.stage4_to_stage5,
            ],
          };
          setBenchInfo({
            type:    'ai-estimated',
            source:  aiBench.source  || 'AI-estimated based on industry data',
            context: aiBench.context || '',
          });
          setResolvedBench(bench);
        } catch {
          bench = DEFAULT_BENCHMARKS;
          setBenchInfo({ type: 'ai-estimated', source: 'AI-estimated (benchmark fetch failed — defaults used)', context: '' });
          setResolvedBench(bench);
        }
      }

      const { systemPrompt, userPrompt } = buildPrompts(industry, chartData, overallRate, bench);
      setPromptText(`── SYSTEM ──\n${systemPrompt}\n\n── USER ──\n${userPrompt}`);
      callGroq(systemPrompt, userPrompt)
        .then(result => { setAiData(result); setAiState('done'); })
        .catch(err   => { setAiError(err.message); setAiState('error'); });
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleExport() {
    const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    document.title = `FunnelSense Report — ${industry} — ${today}`;
    window.print();
  }

  return (
    <div className="page res-page">
      <div className="res-container">

        {/* Header */}
        <header className="res-header">
          <span className="logo-icon">◈</span>
          <div style={{ flex: 1 }}>
            <h1 className="card-title">FunnelSense</h1>
            <p className="card-subtitle">by Ameya Shah</p>
            <p className="res-header-meta">
              {stages.length} stages · {topValue.toLocaleString()} total visitors
            </p>
          </div>
          <div className="res-header-actions">
            <button className="btn btn-export no-print" onClick={handleExport}>
              ↗ Export Report
            </button>
            <div className="res-industry-badge">{industry}</div>
          </div>
        </header>

        {/* Stat cards */}
        <div className="res-stats-row">
          <div className="res-stat">
            <p className="res-stat-label">Total Visitors</p>
            <p className="res-stat-value">{topValue.toLocaleString()}</p>
            <p className="res-stat-sub">entered the funnel</p>
          </div>
          <div className="res-stat res-stat-accent">
            <p className="res-stat-label">Overall Conversion</p>
            <p className="res-stat-value res-stat-orange">{overallRate}%</p>
            <p className="res-stat-sub">visitor → purchase</p>
          </div>
          <div className="res-stat">
            <p className="res-stat-label">Final Conversions</p>
            <p className="res-stat-value">{bottomValue.toLocaleString()}</p>
            <p className="res-stat-sub">completed purchase</p>
          </div>
        </div>

        {/* Funnel chart */}
        <div className="res-chart-section">
          <h2 className="res-chart-title">Conversion Funnel</h2>
          <div className="res-funnel">
            {scaledData.map((d, i) => (
              <div key={d.name}>
                <div className="funnel-bar-row">
                  <span className="funnel-stage-name">{d.name}</span>
                  <div className="funnel-bar-track">
                    <div
                      className="funnel-bar-fill"
                      style={{
                        width: `${d.widthPct}%`,
                        background: `linear-gradient(90deg, ${d.color}bb, ${d.color})`,
                        boxShadow: `0 0 20px ${d.color}44`,
                      }}
                    >
                      <span className="funnel-bar-count">{d.value.toLocaleString()}</span>
                    </div>
                  </div>
                  <span className="funnel-pct">{i === 0 ? '100%' : `${d.convRate}%`}</span>
                </div>
                {i < scaledData.length - 1 && (
                  <DropOff from={d.value} to={scaledData[i + 1].value} />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Stage breakdown table */}
        <div className="res-table-section">
          <h2 className="res-chart-title">Stage Breakdown</h2>
          <div className="res-table">
            <div className="res-table-head">
              <span>Stage</span><span>Users</span>
              <span>Drop from prev.</span><span>Conv. from top</span>
            </div>
            {chartData.map((d, i) => {
              const prev    = i > 0 ? chartData[i - 1].value : null;
              const dropPct = prev ? ((prev - d.value) / prev * 100).toFixed(1) : null;
              return (
                <div key={d.name} className={`res-table-row ${i % 2 === 1 ? 'res-table-row-alt' : ''}`}>
                  <span className="res-table-stage">
                    <span className="stage-num" style={{ background: `${d.color}1a`, borderColor: `${d.color}44`, color: d.color }}>{i + 1}</span>
                    {d.name}
                  </span>
                  <span className="res-table-users">{d.value.toLocaleString()}</span>
                  <span className={`res-table-drop ${dropPct ? 'drop-bad' : ''}`}>{dropPct ? `↓ ${dropPct}%` : '—'}</span>
                  <span className="res-table-conv">{d.convRate}%</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* AI Analysis */}
        {aiState === 'loading' && <AiSkeleton />}
        {aiState === 'error'   && <AiError message={aiError} />}
        {aiState === 'done'    && aiData && (
          <AiResults ai={aiData} promptText={promptText}
            aov={aov} setAov={setAov} benchInfo={benchInfo}
            chartData={chartData} resolvedBench={resolvedBench} />
        )}

        {/* What-If Simulator */}
        <WhatIfSimulator chartData={chartData} aovNum={Number(aov) || 50} />

        {/* Back */}
        <div className="actions res-actions">
          <button className="btn btn-ghost no-print" onClick={onBack}>← Analyze another funnel</button>
        </div>

      </div>
    </div>
  );
}
