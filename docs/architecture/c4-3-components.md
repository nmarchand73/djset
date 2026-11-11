# C4 level 3: components

The single page app is one HTML page whose inline script drives the player and tracklist; data and visuals come from plain scripts that set globals on `window`. `serve.py` is a single module with no components of its own.

```mermaid
C4Component
  title Horizon single page app - components
  Container_Boundary(spa, "Single page app") {
    Component(sky, "Sky background", "HTML and CSS", "Fixed decorative sky: drift glows, veil, sun layers (corona, rays, halo, core, ring), horizon line and grain, coloured by theme variables")
    Component(app, "Page script", "Inline JavaScript", "Lists sets, loads a set into the Plyr player, follows the tracklist, applies the theme and remembers the position in localStorage")
    Component(sets, "SETS", "JavaScript data", "Sets with artist, place, source and timed tracklist")
    Component(themes, "THEMES", "JavaScript data", "Per-set visual universe: colours, fonts, sky and sun values")
    Component(bios, "BIOS", "JavaScript data", "Curated artist bios shown in a popin")
    Component(analyser, "HorizonAnalyser", "JavaScript, Web Audio API", "Live audio spectrum and VU meters for local media")
  }
  Rel(app, sets, "Reads sets and tracks from")
  Rel(app, themes, "Reads the theme of the current set from")
  Rel(app, bios, "Reads the artist bio from")
  Rel(app, analyser, "Starts and stops")
  Rel(app, sky, "Colours through CSS variables")
```

| Component | Path | Responsibility |
| --- | --- | --- |
| Sky background | `index.html` (`.sky` markup and its CSS) | Decorative animated sky and sun behind the page, coloured by theme variables |
| Page script | `index.html` (inline `<script>`) | Set list, player, tracklist, theme switching, resume position |
| SETS | `sets.js` | Set data and timed tracklists |
| THEMES | `themes.js` | Per-set colours, fonts and sky/sun values |
| BIOS | `bios.js` | Artist bios |
| HorizonAnalyser | `analyser.js` | Audio spectrum and VU meters |
