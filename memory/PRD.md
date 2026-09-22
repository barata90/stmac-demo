# STMAC — Live Reconstruction Console · Luxury 3D Upgrade

## Original Problem Statement
> "Bisa kamu buatkan menjadi lebih 'mahal' dan 3D serta interaktif?"
> Repo: https://github.com/barata90/stmac-demo.git

User wants the existing single-file scientific dashboard to *feel* premium, three-dimensional, and interactive — while preserving all embedded solver logic and the real 1999 Saudi NLR data (101,805 timestamps) that ships inside the page.

## User's Confirmed Choices (from ask_human)
- Scope: **Sedang** — Three.js background 3D (particle field + gold/teal glowing rings) + tilt + aurora
- Palette: **Bebas** → chose Deep Obsidian (#07090E) + Neon Gold (#D4AF37) + Teal (#00F5D4)
- Structure: **Tetap single-file** (`/app/index.html`)
- Cursor: **Custom cursor + subtle sound FX** (Web Audio, no assets)
- SHP file: NOT needed — data is embedded as base64 (`REAL_B64`) inside the HTML

## Architecture
- **Type:** Single static HTML page, no build tools, no backend.
- **File:** `/app/index.html` (~1400 lines, HTML+CSS+JS).
- **Preview server:** `python3 -m http.server 3000 --directory /app` (background).
- **External runtime deps (CDN):** Three.js r160, Google Fonts (Outfit + IBM Plex Mono).
- **Embedded logic (preserved as-is):** sheaf-Laplacian solver, banded Cholesky factorisation, diurnal climatology, longitude time-shift restriction maps, cost model (Eq. 7), Saudi 11-station SVG map, canvas charts.

## What Was Built in This Session

### Visual — "Mahal" Luxury Layer
- Full Deep Obsidian + Neon Gold + Teal palette applied on top of the existing dashboard.
- Animated conic-gradient border ring on every panel (gold→teal rotating).
- Glassmorphism panels with `backdrop-filter: blur(14px)` and inner-highlight stroke.
- Metallic bevel treatment on badges, cards, buttons.
- Gradient text shimmer on `h1` (white → gold → teal, animated).
- Radial gold "spotlight" that follows the mouse inside each panel (`--mx/--my` CSS vars).
- Aurora blob backdrop (`#fx-aurora`) with slow drifting animation.
- SVG-filter grain overlay (`#fx-grain`) for tactile film-grain feel.
- Custom two-part cursor (gold outer ring + teal inner dot) that morphs on hover.
- Selection highlight in gold.

### 3D & Interactivity
- **Three.js WebGL background (`#fx-bg`):** 1400 additive-blended particles (white/gold/teal) drifting with camera parallax; two additive-blended tori (gold + teal) as ambient glow rings; mouse + scroll drives camera position.
- **Panel tilt:** `rotateX/rotateY` up to 3.2° on hover, 5° on `.card` — full 3D transform-style preserve-3d.
- **Hero stage parallax:** the hero sphere and orbits react to global mouse position.
- **Extra hero orbit** (`.orbit-b`) added for richer 3D feel.
- **Scroll parallax** on Three.js camera (Y offset).

### Sound
- Web Audio API subtle beeps on button/chip clicks and slider input.
- Global "sound off/on" toggle pill (`#sfx-toggle`) bottom-right.
- No external audio assets — all synthesized with oscillators.

### Accessibility & Reliability
- Full `prefers-reduced-motion: reduce` respect (disables Three.js background, shimmer, pulse).
- `pointer: coarse` disables custom cursor and tilt (mobile fallback).
- All new interactive elements carry `data-testid` (`fx-3d-background`, `sfx-toggle`) plus preserved originals.
- Solver logic and data pipeline untouched — the paper's reconstruction (784 ms for 11×20,160 cells) still runs verbatim.

## Verification
- Opened at `http://localhost:3000/` via Playwright screenshots.
- Hero (STMAC + gold sphere + orbits + shimmer h1): ✅
- Saudi 11-station map with glassmorphism panel: ✅
- Reconstruction chart (Nov 24–30, 1999 window, teal STMAC curves over amber truth): ✅
- Live error cards (Pure temporal 882 W/m², STMAC 94 W/m²): ✅
- Custom cursor tracking mouse: ✅
- SFX toggle button visible: ✅
- Sweep + Vision 2030 cost bars render: ✅
- No JS console errors (only deprecation warnings from Three.js CDN — non-blocking).

## Prioritized Backlog / Next Actions
- P1: Add a "cinematic entrance" — logo lockup + tagline fade on first paint.
- P2: Add hover audio (a very quiet 12kHz tick) alongside click SFX for premium feel.
- P2: Interactive station selector — clicking a Saudi station on the map animates the chart title + recomputes for that station (this may already work; verify).
- P3: Snapshot / share button — export current reconstruction chart as a PNG "postcard" with cost figures for social sharing.
- P3: Publish a small `README` note explaining the visual overhaul for future maintainers.

## Test Credentials
None — static site, no auth.

## Deployment
Static single-file. `index.html` can be served from any static host (GitHub Pages, Netlify drop, Cloudflare Pages). Preview locally with `python3 -m http.server 3000 --directory /app`.
