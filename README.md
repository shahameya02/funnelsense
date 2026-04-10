# FunnelSense

**Turn your raw funnel data into actionable insights — in seconds.**

## About

I built FunnelSense because I kept seeing the same problem: analysts have funnel data sitting in spreadsheets, but turning those numbers into a clear story takes hours of manual work. I wanted a tool that skips the busywork — upload your data, get a diagnosis, know exactly where to focus.

FunnelSense is an AI-powered funnel analyzer. Drop in a CSV or Excel file with your conversion data, and it maps your stages automatically, benchmarks them against real 2026 industry data, and gives you a prioritized action plan — all in under 30 seconds.

## Features

- **Smart CSV/Excel upload** — drag and drop any file; AI detects column structure automatically
- **AI column mapping** — Groq LLaMA 3.3 70B identifies your funnel stages from raw data
- **2026 industry benchmarks** — verified data for E-commerce, SaaS, Mobile App, Healthcare; AI-estimated for any other industry
- **Funnel visualization** — drop-off rates and conversion metrics at every stage
- **AI analysis** — verdict, biggest leak hypotheses, stage-by-stage diagnosis, top 3 actions
- **Revenue impact calculator** — three what-if scenarios showing potential upside in dollars
- **What-If simulator** — drag sliders to model improvements at each stage in real time
- **Export report** — one-click print-ready report

## Tech Stack

- **React 19** — UI and state management
- **Groq LLaMA 3.3 70B** — AI analysis and column mapping
- **PapaParse** — CSV parsing
- **SheetJS (xlsx)** — Excel parsing
- **Recharts** — charting library (installed)
- **Vercel** — deployment

## How It Works

1. Upload a CSV or Excel file with your funnel metrics
2. AI reads the column names and sample rows, then maps them to funnel stages
3. Review and confirm the mapping, then click "Apply & Fill Funnel"
4. Click "Analyze Funnel" — the app fetches industry benchmarks and runs AI analysis
5. Review your verdict, biggest leak hypotheses, revenue scenarios, and action plan

## Getting Started

```bash
# Clone the repo
git clone https://github.com/ameyashah/funnelsense.git
cd funnelsense

# Install dependencies
npm install

# Add your Groq API key
echo "REACT_APP_GROQ_API_KEY=your_key_here" > .env.local

# Start the dev server
npm start
```

Get a free Groq API key at [console.groq.com](https://console.groq.com).

## Live Demo

[funnelsense.vercel.app](https://funnelsense.vercel.app)

---

Built by [Ameya Shah](https://github.com/ameyashah)
