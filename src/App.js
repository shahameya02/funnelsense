import { useState } from 'react';
import UploadWizard from './UploadWizard';
import FunnelResults from './FunnelResults';
import './App.css';

const INDUSTRIES = [
  'E-commerce', 'SaaS', 'Mobile App', 'Healthcare',
  'Travel', 'Financial Services', 'Education',
  'Real Estate', 'Food & Beverage', 'Gaming',
];

const STAGES = [
  { key: 'homepage',  label: 'Homepage visits' },
  { key: 'product',   label: 'Product page'    },
  { key: 'addToCart', label: 'Add to cart'      },
  { key: 'checkout',  label: 'Checkout'         },
  { key: 'purchase',  label: 'Purchase'         },
];

// Sample data shown until the user uploads their own file
const SAMPLE = {
  homepage: 10000,
  product:  4500,
  addToCart: 1800,
  checkout: 900,
  purchase: 320,
};

const EMPTY = {
  industry: INDUSTRIES[0],
  ...Object.fromEntries(STAGES.map(s => [s.key, ''])),
};

export default function App() {
  const [form, setForm]       = useState(EMPTY);
  const [results, setResults] = useState(null); // null = input view

  function handleChange(e) {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  }

  function handleFill(stageValues) {
    setForm(prev => ({ ...prev, ...stageValues }));
  }

  function handleSubmit(e) {
    e.preventDefault();
    // Use uploaded values if present, otherwise fall back to sample data
    const stages = STAGES.reduce((acc, s) => {
      const v = Number(form[s.key]);
      acc[s.key] = v > 0 ? v : SAMPLE[s.key];
      return acc;
    }, {});
    setResults({ stages, industry: form.industry });
  }

  if (results) {
    return (
      <FunnelResults
        data={results.stages}
        industry={results.industry}
        onBack={() => setResults(null)}
      />
    );
  }

  return (
    <div className="page">
      <form className="card" onSubmit={handleSubmit}>

        <header className="card-header">
          <span className="logo-icon">◈</span>
          <div>
            <h1 className="card-title">FunnelSense</h1>
            <p className="card-subtitle">by Ameya Shah</p>
          </div>
        </header>

        <div className="hero">
          <p className="hero-tagline">
            Turn your raw funnel data into actionable insights — in seconds
          </p>
          <div className="hero-steps">
            <div className="hero-step">
              <span className="hero-step-icon">📂</span>
              <div>
                <p className="hero-step-title">Upload your data</p>
                <p className="hero-step-desc">Drop any CSV or Excel file with your funnel metrics</p>
              </div>
            </div>
            <div className="hero-step">
              <span className="hero-step-icon">🤖</span>
              <div>
                <p className="hero-step-title">AI maps it instantly</p>
                <p className="hero-step-desc">Groq LLaMA AI detects your funnel stages automatically</p>
              </div>
            </div>
            <div className="hero-step">
              <span className="hero-step-icon">📊</span>
              <div>
                <p className="hero-step-title">Get insights</p>
                <p className="hero-step-desc">See drop-off rates, benchmarks and recommendations</p>
              </div>
            </div>
          </div>
        </div>

        <section className="section">
          <h2 className="section-title">Funnel Stages</h2>
          <UploadWizard onFill={handleFill} />
        </section>

        <section className="section">
          <h2 className="section-title">Details</h2>
          <div className="field">
            <label className="label" htmlFor="industry">Industry</label>
            <div className="select-wrap">
              <select id="industry" name="industry" className="input select"
                value={form.industry} onChange={handleChange}>
                {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
              <span className="select-arrow">▾</span>
            </div>
          </div>
        </section>

        <div className="actions">
          <button type="button" className="btn btn-ghost"
            onClick={() => setForm(EMPTY)}>
            Clear
          </button>
          <button type="submit" className="btn btn-primary">
            Analyze Funnel →
          </button>
        </div>

      </form>
    </div>
  );
}
