import { useState, useRef } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';

// ── Constants ────────────────────────────────────────────────────────────────

const FUNNEL_STAGES = [
  { key: 'homepage',  label: 'Homepage visits' },
  { key: 'product',   label: 'Product page'    },
  { key: 'addToCart', label: 'Add to cart'      },
  { key: 'checkout',  label: 'Checkout'         },
  { key: 'purchase',  label: 'Purchase'         },
];

const BLANK_MAPPING = {
  format: 'summary',          // 'summary' | 'raw' | 'columnar'
  stageColumn: '',            // column that holds stage names (summary + raw)
  valueColumn: '',            // column that holds counts (summary only)
  stageIdentifiers: {         // what value in stageColumn = each funnel stage
    homepage: '', product: '', addToCart: '', checkout: '', purchase: '',
  },
  columnMapping: {            // which column = each funnel stage (columnar only)
    homepage: '', product: '', addToCart: '', checkout: '', purchase: '',
  },
  aiNotes: '',
  aiConfidence: '',
};

// ── Groq API call ────────────────────────────────────────────────────────────

async function callGroqMapping(columns, sampleRows) {
  const apiKey = process.env.REACT_APP_GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      'API key missing. Add this to your .env.local file:\nREACT_APP_GROQ_API_KEY=your-key-here'
    );
  }

  const sampleText = sampleRows.slice(0, 5).map((row, i) => {
    const cells = columns.map(col => `${col}: ${row[col] ?? ''}`).join(' | ');
    return `Row ${i + 1}: ${cells}`;
  }).join('\n');

  const prompt = `You are mapping uploaded data columns to conversion funnel stages.

COLUMNS: ${columns.join(', ')}

SAMPLE ROWS:
${sampleText}

Respond with ONLY valid JSON (no markdown, no explanation):
{
  "format": "summary",
  "stageColumn": "column_name_or_null",
  "valueColumn": "column_name_or_null",
  "stageIdentifiers": {
    "homepage": "value_or_null",
    "product": "value_or_null",
    "addToCart": "value_or_null",
    "checkout": "value_or_null",
    "purchase": "value_or_null"
  },
  "columnMapping": {
    "homepage": "column_name_or_null",
    "product": "column_name_or_null",
    "addToCart": "column_name_or_null",
    "checkout": "column_name_or_null",
    "purchase": "column_name_or_null"
  },
  "confidence": "high|medium|low",
  "notes": "one sentence about what you detected"
}

Format guide:
- "summary": one row per funnel stage, stageColumn identifies which stage, valueColumn has the count
- "raw": one row per user event, stageColumn identifies the event, we count occurrences (valueColumn = null)
- "columnar": each funnel stage has its own dedicated column (fill columnMapping, set stageColumn/valueColumn/stageIdentifiers to null)

Use null for any field not applicable to the detected format. Use null for stages you cannot confidently map.`;

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Groq API error (${res.status})`);
  }

  const data = await res.json();
  const raw = data.choices[0].message.content.trim();
  const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  return JSON.parse(jsonStr);
}

// ── Aggregation ──────────────────────────────────────────────────────────────

function aggregateData(rows, mapping) {
  const result = {};

  if (mapping.format === 'columnar') {
    for (const { key } of FUNNEL_STAGES) {
      const col = mapping.columnMapping[key];
      if (!col) { result[key] = 0; continue; }
      result[key] = rows.reduce((sum, row) => sum + (Number(row[col]) || 0), 0);
    }

  } else if (mapping.format === 'summary') {
    for (const { key } of FUNNEL_STAGES) {
      const identifier = mapping.stageIdentifiers[key];
      if (!identifier || !mapping.stageColumn || !mapping.valueColumn) {
        result[key] = 0; continue;
      }
      const row = rows.find(
        r => String(r[mapping.stageColumn] ?? '').trim().toLowerCase()
              === identifier.trim().toLowerCase()
      );
      result[key] = row ? (Number(row[mapping.valueColumn]) || 0) : 0;
    }

  } else { // raw events — count rows per stage
    for (const { key } of FUNNEL_STAGES) {
      const identifier = mapping.stageIdentifiers[key];
      if (!identifier || !mapping.stageColumn) { result[key] = 0; continue; }
      result[key] = rows.filter(
        r => String(r[mapping.stageColumn] ?? '').trim().toLowerCase()
              === identifier.trim().toLowerCase()
      ).length;
    }
  }

  return result;
}

// ── Component ────────────────────────────────────────────────────────────────

export default function UploadWizard({ onFill }) {
  const [step, setStep]         = useState('drop');        // drop | preview | mapping
  const [fileData, setFileData] = useState(null);          // { rows, columns, filename, totalRows }
  const [mapping, setMapping]   = useState(BLANK_MAPPING);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError]       = useState(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);

  // ── File parsing ───────────────────────────────────────────────

  async function processFile(file) {
    if (!file) return;
    setError(null);
    const ext = file.name.split('.').pop().toLowerCase();

    if (!['csv', 'xlsx', 'xls'].includes(ext)) {
      setError('Unsupported file type. Please upload a .csv or .xlsx file.');
      return;
    }

    try {
      let rows;

      if (ext === 'csv') {
        rows = await new Promise((resolve, reject) => {
          Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: r => resolve(r.data),
            error: err => reject(new Error(err.message)),
          });
        });
      } else {
        const buffer = await file.arrayBuffer();
        const wb    = XLSX.read(new Uint8Array(buffer), { type: 'array' });
        const sheet = wb.Sheets[wb.SheetNames[0]];
        rows = XLSX.utils.sheet_to_json(sheet);
      }

      if (!rows || rows.length === 0) {
        setError('The file appears to be empty.');
        return;
      }

      const columns = Object.keys(rows[0]);
      setFileData({ rows, columns, filename: file.name, totalRows: rows.length });
      setStep('preview');
    } catch (err) {
      setError(`Could not parse file: ${err.message}`);
    }
  }

  // ── AI mapping ─────────────────────────────────────────────────

  async function runAiMapping() {
    setAiLoading(true);
    setError(null);
    try {
      const suggestion = await callGroqMapping(fileData.columns, fileData.rows);
      setMapping({
        format:    suggestion.format || 'summary',
        stageColumn: suggestion.stageColumn  || '',
        valueColumn: suggestion.valueColumn  || '',
        stageIdentifiers: {
          homepage:  suggestion.stageIdentifiers?.homepage  || '',
          product:   suggestion.stageIdentifiers?.product   || '',
          addToCart: suggestion.stageIdentifiers?.addToCart || '',
          checkout:  suggestion.stageIdentifiers?.checkout  || '',
          purchase:  suggestion.stageIdentifiers?.purchase  || '',
        },
        columnMapping: {
          homepage:  suggestion.columnMapping?.homepage  || '',
          product:   suggestion.columnMapping?.product   || '',
          addToCart: suggestion.columnMapping?.addToCart || '',
          checkout:  suggestion.columnMapping?.checkout  || '',
          purchase:  suggestion.columnMapping?.purchase  || '',
        },
        aiNotes:      suggestion.notes      || '',
        aiConfidence: suggestion.confidence || 'medium',
      });
      setStep('mapping');
    } catch (err) {
      setError(err.message);
    } finally {
      setAiLoading(false);
    }
  }

  // ── Confirm mapping → aggregate → fill form ────────────────────

  function handleConfirm() {
    const values = aggregateData(fileData.rows, mapping);
    onFill({
      homepage:  String(values.homepage  || ''),
      product:   String(values.product   || ''),
      addToCart: String(values.addToCart || ''),
      checkout:  String(values.checkout  || ''),
      purchase:  String(values.purchase  || ''),
    });
  }

  // ── Mapping state helpers ──────────────────────────────────────

  const setMappingField   = (k, v) => setMapping(p => ({ ...p, [k]: v }));
  const setStageId        = (k, v) => setMapping(p => ({ ...p, stageIdentifiers: { ...p.stageIdentifiers, [k]: v } }));
  const setColMap         = (k, v) => setMapping(p => ({ ...p, columnMapping:    { ...p.columnMapping,    [k]: v } }));

  // ── STEP: drop ─────────────────────────────────────────────────

  if (step === 'drop') {
    return (
      <div
        className={`drop-zone ${dragging ? 'drag-over' : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); processFile(e.dataTransfer.files[0]); }}
        onClick={() => fileRef.current?.click()}
      >
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls"
          style={{ display: 'none' }} onChange={e => processFile(e.target.files[0])} />
        <span className="dz-icon">{dragging ? '📂' : '☁'}</span>
        <p className="dz-text">{dragging ? 'Drop it here!' : 'Drag & drop your file'}</p>
        <p className="dz-hint">or click to browse · .csv or .xlsx</p>
        {error && <p className="dz-error">{error}</p>}
      </div>
    );
  }

  // ── STEP: preview ──────────────────────────────────────────────

  if (step === 'preview') {
    const previewRows = fileData.rows.slice(0, 10);

    return (
      <div className="wiz">
        {/* File info bar */}
        <div className="wiz-file-bar">
          <span className="wiz-file-icon">📄</span>
          <div className="wiz-file-info">
            <p className="wiz-filename">{fileData.filename}</p>
            <p className="wiz-meta">
              {fileData.totalRows.toLocaleString()} rows &middot; {fileData.columns.length} columns:
              <span className="wiz-cols"> {fileData.columns.join(', ')}</span>
            </p>
          </div>
          <button type="button" className="wiz-close"
            onClick={() => { setStep('drop'); setFileData(null); setError(null); }}>
            ✕
          </button>
        </div>

        {/* Scrollable preview table */}
        <div className="preview-wrap">
          <table className="preview-table">
            <thead>
              <tr>{fileData.columns.map(col => <th key={col}>{col}</th>)}</tr>
            </thead>
            <tbody>
              {previewRows.map((row, i) => (
                <tr key={i}>
                  {fileData.columns.map(col => (
                    <td key={col}>{String(row[col] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {fileData.totalRows > 10 && (
            <p className="preview-more">Showing 10 of {fileData.totalRows.toLocaleString()} rows</p>
          )}
        </div>

        {/* Action */}
        {error && <p className="wiz-error">{error}</p>}
        <div className="wiz-actions">
          <button type="button" className="btn btn-primary" onClick={runAiMapping}
            disabled={aiLoading}>
            {aiLoading
              ? <><span className="spinner" /> Analyzing columns with AI…</>
              : '✦ Map Columns with AI →'}
          </button>
        </div>
      </div>
    );
  }

  // ── STEP: mapping ──────────────────────────────────────────────

  const colOptions = ['', ...fileData.columns];
  // Unique values in the chosen stageColumn (for datalist autocomplete)
  const stageColValues = mapping.stageColumn
    ? [...new Set(fileData.rows.map(r => String(r[mapping.stageColumn] ?? '').trim()))].filter(Boolean).slice(0, 50)
    : [];

  const confidenceColor = { high: 'conf-high', medium: 'conf-med', low: 'conf-low' }[mapping.aiConfidence] || '';

  return (
    <div className="wiz">

      {/* AI result badge */}
      <div className="ai-banner">
        <span className="ai-banner-icon">✦</span>
        <span className="ai-banner-text">AI mapped your columns</span>
        {mapping.aiConfidence && (
          <span className={`ai-conf ${confidenceColor}`}>{mapping.aiConfidence} confidence</span>
        )}
      </div>
      {mapping.aiNotes && <p className="ai-notes">{mapping.aiNotes}</p>}

      {/* Format selector */}
      <div className="map-row">
        <span className="map-label">Data format</span>
        <div className="fmt-toggle">
          {[
            { val: 'summary',  label: 'Summary Rows'    },
            { val: 'raw',      label: 'Raw Events'      },
            { val: 'columnar', label: 'Column per Stage' },
          ].map(({ val, label }) => (
            <button key={val} type="button"
              className={`fmt-btn ${mapping.format === val ? 'active' : ''}`}
              onClick={() => setMappingField('format', val)}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Stage column + Value column (summary + raw) */}
      {mapping.format !== 'columnar' && (
        <div className="map-cols-row">
          <div className="map-col-field">
            <span className="map-label">Stage name column</span>
            <div className="select-wrap">
              <select className="input select"
                value={mapping.stageColumn}
                onChange={e => setMappingField('stageColumn', e.target.value)}>
                {colOptions.map(c => <option key={c} value={c}>{c || '— select —'}</option>)}
              </select>
              <span className="select-arrow">▾</span>
            </div>
          </div>
          {mapping.format === 'summary' && (
            <div className="map-col-field">
              <span className="map-label">Value column</span>
              <div className="select-wrap">
                <select className="input select"
                  value={mapping.valueColumn}
                  onChange={e => setMappingField('valueColumn', e.target.value)}>
                  {colOptions.map(c => <option key={c} value={c}>{c || '— select —'}</option>)}
                </select>
                <span className="select-arrow">▾</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Per-stage mapping */}
      <div className="stage-map-table">
        <div className="stage-map-head">
          <span>Funnel Stage</span>
          <span>{mapping.format === 'columnar' ? 'Column name' : `Value in "${mapping.stageColumn || 'stage column'}"`}</span>
        </div>

        {/* Datalist for autocomplete on stage identifiers */}
        <datalist id="stage-col-values">
          {stageColValues.map(v => <option key={v} value={v} />)}
        </datalist>

        {FUNNEL_STAGES.map(({ key, label }, idx) => (
          <div key={key} className="stage-map-row">
            <div className="stage-map-left">
              <span className="stage-num">{idx + 1}</span>
              <span className="map-label">{label}</span>
            </div>
            {mapping.format === 'columnar' ? (
              <div className="select-wrap stage-map-select">
                <select className="input select"
                  value={mapping.columnMapping[key]}
                  onChange={e => setColMap(key, e.target.value)}>
                  {colOptions.map(c => <option key={c} value={c}>{c || '— select —'}</option>)}
                </select>
                <span className="select-arrow">▾</span>
              </div>
            ) : (
              <input
                list="stage-col-values"
                className="input stage-map-input"
                value={mapping.stageIdentifiers[key]}
                onChange={e => setStageId(key, e.target.value)}
                placeholder={mapping.stageColumn ? `value in "${mapping.stageColumn}"` : 'identifier'}
              />
            )}
          </div>
        ))}
      </div>

      {error && <p className="wiz-error">{error}</p>}

      <div className="wiz-actions wiz-actions-split">
        <button type="button" className="btn btn-ghost" onClick={() => setStep('preview')}>
          ← Back
        </button>
        <button type="button" className="btn btn-primary" onClick={handleConfirm}>
          Apply &amp; Fill Funnel →
        </button>
      </div>

    </div>
  );
}
