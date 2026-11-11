/* DJ music spectrum: log 20 Hz–16 kHz, stereo split, musical energy bands. */
(function () {
  const root = document.getElementById("scope");
  if (!root) return;

  const canvasL = root.querySelector("[data-viz-l]");
  const canvasR = root.querySelector("[data-viz-r]");
  const vuCanvasL = root.querySelector("[data-vu-l]");
  const vuCanvasR = root.querySelector("[data-vu-r]");
  const detectL = root.querySelector("[data-detect-l]");
  const detectR = root.querySelector("[data-detect-r]");
  const detectBeat = root.querySelector("[data-detect-beat]");
  const peakLabelL = root.querySelector("[data-peak-l]");
  const peakLabelR = root.querySelector("[data-peak-r]");
  const analysisStatus = root.querySelector("[data-analysis-status]");
  const bandPctEls = {};
  const bandFillEls = {};
  const bandHoldEls = {};
  const bandMeters = root.querySelectorAll("[data-band]");
  bandMeters.forEach(function (el) {
    const id = el.dataset.band;
    bandPctEls[id] = el.querySelector("[data-band-pct]");
    bandFillEls[id] = el.querySelector("[data-band-fill]");
    bandHoldEls[id] = el.querySelector("[data-band-hold]");
  });

  // Club isolator + ISO spectrum: 20 Hz–16 kHz
  // Energy meters = 4-band DJ isolator (Xone / Pioneer V10 family).
  // Spectrum bars = ~1/3-octave log bands with pink-noise-flat power sum.
  const F_LOW = 20;
  const F_HIGH = 16000;
  // Classic RTA grid: 31 bands × 20 LEDs, ISO-ish decade marks under the matrix.
  const AXIS_TICKS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const SPEC_BARS = 31;
  const LED_SEGS_MAIN = 20;
  // Peak marker = loudest bin right now (full club band)
  const PEAK_LO = 20;
  const PEAK_HI = 16000;
  const PEAK_SMOOTH = 0.55;
  const BAND_ATK = 0.62;   // snappy rise with the groove
  const BAND_REL = 0.16;   // still a bit of mass on the way down
  let bandRollMax = 1e-6;
  // Peak: short hold then 20 dB/s fall. Columns: Fast release ~40 dB/s.
  const PEAK_HOLD_MS = 320;
  const PEAK_FALL_DB_PER_S = 20;
  const BAR_FALL_DB_PER_S = 40;
  const BAND_DEFS = [
    { id: "low", lo: 20, hi: 100, alpha: 0.05 },
    { id: "lowmid", lo: 100, hi: 400, alpha: 0.05 },
    { id: "himid", lo: 400, hi: 2500, alpha: 0.05 },
    { id: "high", lo: 2500, hi: 16000, alpha: 0.04 },
  ];

  let palette = null;

  const clampByte = function (n) {
    return Math.max(0, Math.min(255, Math.round(n)));
  };

  const hexToRgb = function (hex) {
    const raw = String(hex || "#f2c14e").replace("#", "").trim();
    const full = raw.length === 3
      ? raw.split("").map(function (c) { return c + c; }).join("")
      : raw;
    const n = parseInt(full.slice(0, 6), 16);
    if (!isFinite(n)) return { r: 242, g: 193, b: 78 };
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  };

  const rgba = function (rgb, a) {
    return "rgba(" + rgb.r + ", " + rgb.g + ", " + rgb.b + ", " + a + ")";
  };

  const mix = function (a, b, t) {
    return {
      r: clampByte(a.r + (b.r - a.r) * t),
      g: clampByte(a.g + (b.g - a.g) * t),
      b: clampByte(a.b + (b.b - a.b) * t),
    };
  };

  const buildPalette = function (hex) {
    const accent = hexToRgb(hex);
    const soft = mix(accent, { r: 255, g: 255, b: 255 }, 0.28);
    const hold = mix(accent, { r: 255, g: 236, b: 186 }, 0.45);
    const ink = mix(accent, { r: 20, g: 10, b: 12 }, 0.82);
    const muted = mix(accent, { r: 40, g: 24, b: 20 }, 0.35);
    return {
      hex: hex,
      accent: accent,
      soft: soft,
      hold: hold,
      ink: ink,
      muted: muted,
      text: rgba(soft, 0.95),
      textMuted: rgba(soft, 0.62),
      border: rgba(accent, 0.34),
      accentHex: "#" + [accent.r, accent.g, accent.b].map(function (v) {
        return v.toString(16).padStart(2, "0");
      }).join(""),
      glow: rgba(accent, 0.38),
      amber: rgba(hold, 0.95),
      amberGlow: rgba(hold, 0.42),
      barBase: rgba(accent, 0.92),
      barGlow: rgba(accent, 0.22),
      axis: rgba(soft, 0.22),
      grid: rgba(soft, 0.12),
      label: rgba(soft, 0.55),
      detectInk: rgba(hold, 0.95),
      detectLabel: rgba(mix(hold, { r: 255, g: 255, b: 255 }, 0.25), 0.98),
      bg: "#" + [ink.r, ink.g, ink.b].map(function (v) {
        return v.toString(16).padStart(2, "0");
      }).join(""),
      canvasBg: "#" + [Math.max(0, ink.r - 4), Math.max(0, ink.g - 2), Math.max(0, ink.b)].map(function (v) {
        return v.toString(16).padStart(2, "0");
      }).join(""),
      bandFills: BAND_DEFS.map(function (band) {
        return rgba(accent, band.alpha);
      }),
      fillLow: rgba(accent, 0.35),
      trackBg: rgba(ink, 0.65),
      trackLine: rgba(soft, 0.06),
      trackBorder: rgba(accent, 0.18),
    };
  };

  const applyPalette = function (hex, redraw) {
    palette = buildPalette(hex || "#f2c14e");
    root.style.setProperty("--accent", palette.accentHex);
    root.style.setProperty("--text", palette.text);
    root.style.setProperty("--text-muted", palette.textMuted);
    root.style.setProperty("--border", palette.border);
    root.style.setProperty("--amber", palette.amber);
    root.style.setProperty("--amber-glow", palette.amberGlow);
    root.style.setProperty("--scope-bg", palette.bg);
    root.style.setProperty("--scope-glow", palette.glow);
    root.style.setProperty("--scope-fill-low", palette.fillLow);
    root.style.setProperty("--scope-track-bg", palette.trackBg);
    root.style.setProperty("--scope-track-line", palette.trackLine);
    root.style.setProperty("--scope-track-border", palette.trackBorder);
    root.style.setProperty("--scope-canvas-bg", palette.canvasBg);
    if (redraw && !vizActive) {
      drawSpectrum(canvasL, null, null, "l");
      drawSpectrum(canvasR, null, null, "r");
      drawVuMeter(vuCanvasL, 0, 0, "l");
      drawVuMeter(vuCanvasR, 0, 0, "r");
    }
  };

  palette = buildPalette("#869BE4");
  const logF = function (hz) { return Math.log10(hz); };
  const logSpan = logF(F_HIGH) - logF(F_LOW);
  const hzToX = function (hz, w, pad) {
    const t = (logF(Math.max(F_LOW, Math.min(F_HIGH, hz))) - logF(F_LOW)) / logSpan;
    return pad + t * (w - pad * 2);
  };
  const hzAtT = function (t) { return 10 ** (logF(F_LOW) + t * logSpan); };
  const fmtTick = function (hz) {
    if (hz >= 1000) return (hz / 1000) + "k";
    if (hz === 31.5) return "31";
    return String(hz);
  };
  const fmtPeak = function (hz) {
    if (hz == null || !isFinite(hz)) return "—";
    if (hz < 100) return hz.toFixed(1) + " Hz";
    return Math.round(hz) + " Hz";
  };
  const smoothVal = function (prev, next) {
    return prev == null ? next : PEAK_SMOOTH * prev + (1 - PEAK_SMOOTH) * next;
  };
  const peakHoldStep = function (prev, until, next, now, dt) {
    // Strict rise only — equality must not refresh the hold timer every frame.
    if (next > prev + 1e-5) return { v: next, until: now + PEAK_HOLD_MS };
    if (now < until) return { v: prev, until: until };
    const decay = Math.pow(10, (-PEAK_FALL_DB_PER_S * Math.max(0.001, dt)) / 20);
    return { v: Math.max(next, prev * decay), until: until };
  };

  let media = null;
  let boundMedia = null;
  let tapSource = null; // MediaStreamSource (preferred) or MediaElementSource (fallback)
  let audioTapMode = null; // "stream" | "element"
  let capturedStream = null;
  let ac = null;
  let splitter = null;
  let analyserL = null;
  let analyserR = null;
  let silentFrames = 0;
  const SILENT_WARN_FRAMES = 50;
  let dataL = null;
  let dataR = null;
  let floatL = null;
  let floatR = null;
  let uniqueL = null;
  let uniqueR = null;
  let timeL = null;
  let timeR = null;
  let startBin = 0;
  let endBin = 0;
  let binHz = 1.346;
  let raf = 0;
  let vizActive = false;
  let smoothPeakL = null;
  let smoothPeakR = null;
  let smoothBeat = null;
  let smoothBandPct = { low: 0.25, lowmid: 0.25, himid: 0.25, high: 0.25 };
  let bandHoldPct = { low: 0, lowmid: 0, himid: 0, high: 0 };
  let bandHoldUntil = { low: 0, lowmid: 0, himid: 0, high: 0 };
  let specHoldL = null;
  let specHoldR = null;
  let specHoldUntilL = null;
  let specHoldUntilR = null;
  let specEnvL = null;
  let specEnvR = null;
  let specRollPeak = 0.2;
  let holdClock = 0;
  let stereoLikely = true;
  let stereoFrames = 0;
  let vuLevelL = 0;
  let vuLevelR = 0;
  let coasting = false;
  let vuPeakL = 0;
  let vuPeakR = 0;
  let vuPeakUntilL = 0;
  let vuPeakUntilR = 0;

  // Instantaneous loudest bin in range (parabolic interpolate)
  const findPeakHz = function (floatData, lo, hi, floorDb) {
    if (floorDb == null) floorDb = -78;
    if (!floatData) return null;
    const b0 = Math.max(startBin + 1, Math.floor(lo / binHz));
    const b1 = Math.min(endBin - 1, Math.ceil(hi / binHz));
    if (b0 >= b1) return null;
    let bestBin = b0;
    let bestVal = -Infinity;
    for (let k = b0; k <= b1; k += 1) {
      if (floatData[k] > bestVal) {
        bestVal = floatData[k];
        bestBin = k;
      }
    }
    if (bestVal < floorDb) return null;
    const y0 = floatData[bestBin - 1];
    const y1 = floatData[bestBin];
    const y2 = floatData[bestBin + 1];
    const denom = y0 - 2 * y1 + y2;
    const delta = denom !== 0 ? 0.5 * (y0 - y2) / denom : 0;
    return Math.max(lo, Math.min(hi, (bestBin + delta) * binHz));
  };

  const fillUniqueSpectrum = function (mineDb, otherDb, outDb) {
    for (let k = 0; k < mineDb.length; k += 1) {
      const a = 10 ** (mineDb[k] / 20);
      const b = 10 ** (otherDb[k] / 20);
      const u = Math.max(0, a - b);
      outDb[k] = u > 1e-12 ? 20 * Math.log10(u) : -120;
    }
  };

  const sampleStereoLikelihood = function () {
    if (!analyserL || !analyserR || !timeL || !timeR) return;
    analyserL.getFloatTimeDomainData(timeL);
    analyserR.getFloatTimeDomainData(timeR);
    let sumDiff = 0;
    let sumPow = 0;
    for (let i = 0; i < timeL.length; i += 1) {
      const d = timeL[i] - timeR[i];
      sumDiff += d * d;
      sumPow += timeL[i] * timeL[i] + timeR[i] * timeR[i];
    }
    const sideRatio = Math.sqrt(sumDiff) / (Math.sqrt(sumPow) + 1e-12);
    stereoLikely = sideRatio > 0.02;
  };

  const detectPeaks = function () {
    if (!floatL || !floatR) {
      return { peakL: null, peakR: null, beat: null };
    }
    const rawL = findPeakHz(floatL, PEAK_LO, PEAK_HI, -78);
    const rawR = findPeakHz(floatR, PEAK_LO, PEAK_HI, -78);
    if (rawL != null) smoothPeakL = smoothVal(smoothPeakL, rawL);
    if (rawR != null) smoothPeakR = smoothVal(smoothPeakR, rawR);
    if (smoothPeakL != null && smoothPeakR != null) {
      smoothBeat = (smoothPeakL + smoothPeakR) * 0.5;
    } else {
      smoothBeat = smoothPeakL != null ? smoothPeakL : smoothPeakR;
    }
    return { peakL: smoothPeakL, peakR: smoothPeakR, beat: smoothBeat };
  };

  // Absolute band energy (0–1), AGC'd to a rolling peak so meters ride the music
  // instead of only showing a sticky relative share.
  const measureBandLevels = function () {
    if (!floatL || !floatR) return null;
    const raw = BAND_DEFS.map(function (band) {
      const b0 = Math.max(startBin, Math.floor(band.lo / binHz));
      const b1 = Math.min(endBin, Math.ceil(band.hi / binHz));
      if (b0 >= b1) return 0;
      let sum = 0;
      for (let k = b0; k < b1; k += 1) {
        const l = 10 ** (floatL[k] / 20);
        const r = 10 ** (floatR[k] / 20);
        sum += (l + r) * 0.5;
      }
      // Mild emphasis so lows/highs read similarly energetic on club material.
      return Math.pow(sum / (b1 - b0), 0.85);
    });
    const frameMax = Math.max.apply(null, raw.concat([1e-9]));
    bandRollMax = Math.max(frameMax, bandRollMax * 0.978);
    const norm = bandRollMax > 1e-9 ? bandRollMax : 1;
    return raw.map(function (v) {
      const t = Math.max(0, Math.min(1, v / norm));
      // Keep mid dynamics; avoid expanding quiet bands into the ceiling.
      return Math.pow(t, 1.05);
    });
  };

  // LED traffic bands — short green base, wide amber, red tip (~6 / 7 / 7 of 20).
  const LED_GREEN_END = 0.30;
  const LED_AMBER_END = 0.65;
  const ledRgbAt = function (t) {
    if (t < LED_GREEN_END) return { r: 36, g: 220, b: 96 };
    if (t < LED_AMBER_END) return { r: 242, g: 196, b: 40 };
    return { r: 255, g: 64, b: 52 };
  };

  const fillRoundRect = function (ctx, x, y, bw, bh, r) {
    const rr = Math.max(0, Math.min(r, bw / 2, bh / 2));
    ctx.beginPath();
    if (rr < 0.4) {
      ctx.rect(x, y, bw, bh);
    } else {
      ctx.moveTo(x + rr, y);
      ctx.lineTo(x + bw - rr, y);
      ctx.quadraticCurveTo(x + bw, y, x + bw, y + rr);
      ctx.lineTo(x + bw, y + bh - rr);
      ctx.quadraticCurveTo(x + bw, y + bh, x + bw - rr, y + bh);
      ctx.lineTo(x + rr, y + bh);
      ctx.quadraticCurveTo(x, y + bh, x, y + bh - rr);
      ctx.lineTo(x, y + rr);
      ctx.quadraticCurveTo(x, y, x + rr, y);
      ctx.closePath();
    }
    ctx.fill();
  };

  const drawLedColumn = function (ctx, x, barW, bottom, usableH, level, holdLevel, segs) {
    const n = Math.max(6, segs || LED_SEGS_MAIN);
    // Fit exactly in usableH so the green (bottom) rows are never clipped.
    const gap = Math.max(1, Math.min(2, usableH / (n * 6)));
    const segH = Math.max(1.5, (usableH - gap * (n - 1)) / n);
    const lvl = Math.max(0, Math.min(1, level || 0));
    // floor: a partial segment stays dark — peak can occupy the cell above the tip.
    const lit = Math.max(0, Math.min(n, Math.floor(lvl * n + 1e-6)));
    const corner = Math.min(1.2, barW * 0.18, segH * 0.28);
    const drive = Math.pow(lvl, 0.7);

    // Thin side spill — tint follows the hottest lit LED.
    if (lit > 0) {
      const topY = bottom - lit * segH - (lit - 1) * gap;
      const stackH = Math.max(1, bottom - topY);
      const spillC = ledRgbAt(Math.min(0.92, (lit - 0.35) / n));
      const spillW = 1.8 + drive * 2.8;
      const left = ctx.createLinearGradient(x - spillW, 0, x, 0);
      left.addColorStop(0, rgba(spillC, 0));
      left.addColorStop(1, rgba(spillC, 0.08 + drive * 0.16));
      ctx.fillStyle = left;
      ctx.fillRect(x - spillW, topY, spillW, stackH);
      const right = ctx.createLinearGradient(x + barW, 0, x + barW + spillW, 0);
      right.addColorStop(0, rgba(spillC, 0.08 + drive * 0.16));
      right.addColorStop(1, rgba(spillC, 0));
      ctx.fillStyle = right;
      ctx.fillRect(x + barW, topY, spillW, stackH);
    }

    for (let s = 0; s < n; s += 1) {
      const t = (s + 0.5) / n;
      const y = bottom - (s + 1) * segH - s * gap;
      const on = s < lit;
      const base = ledRgbAt(t);
      if (!on) {
        // Idle matrix stays quiet — green especially must not dominate the glass.
        ctx.fillStyle = rgba(base, t < LED_GREEN_END ? 0.1 : 0.12);
        fillRoundRect(ctx, x, y, barW, segH, corner);
        continue;
      }

      const nearTip = lit <= 1 ? 1 : s / (lit - 1);
      const wash = t < LED_GREEN_END ? 0.02 : (0.06 + drive * 0.1 * nearTip);
      const body = mix(base, { r: 255, g: 248, b: 230 }, wash);
      ctx.fillStyle = rgba(body, 0.88 + drive * 0.1);
      fillRoundRect(ctx, x, y, barW, segH, corner);
      // Soft top glint on amber/red only.
      if (t >= LED_GREEN_END) {
        const filH = Math.max(1, segH * 0.28);
        ctx.fillStyle = rgba({ r: 255, g: 255, b: 245 }, 0.14 + drive * 0.22 * nearTip);
        fillRoundRect(ctx, x + 1, y + 0.5, barW - 2, filH, Math.min(corner, 1));
      }
    }

    // Tip diode: whiter core when the column is driven hard.
    if (lit > 0) {
      const tip = lit - 1;
      const tipY = bottom - (tip + 1) * segH - tip * gap;
      const tipC = mix(ledRgbAt((tip + 0.5) / n), { r: 255, g: 250, b: 235 }, 0.25 + drive * 0.35);
      ctx.fillStyle = rgba(tipC, 0.55 + drive * 0.35);
      fillRoundRect(ctx, x + 1.2, tipY + segH * 0.2, barW - 2.4, Math.max(1.2, segH * 0.45), corner);
    }

    // Peak hold — always in the first dark cell above the tip (never on/under the bar).
    if (holdLevel != null && holdLevel > 0.03 && lit < n) {
      let holdSeg = Math.floor(holdLevel * n + 1e-6);
      // Cell index above tip is `lit` (tip LEDs are 0..lit-1). Never go below that.
      if (holdSeg < lit) holdSeg = lit;
      if (holdSeg > n - 1) holdSeg = n - 1;
      const segY = bottom - (holdSeg + 1) * segH - holdSeg * gap;
      const tickH = Math.max(1.0, segH * 0.28);
      // Sit on the lower edge of that cell = visually right on top of the stack.
      const tickY = segY + segH - tickH;
      const inset = Math.max(0.7, barW * 0.1);
      const tickX = x + inset;
      const tickW = Math.max(1.5, barW - inset * 2);
      const peak = { r: 210, g: 198, b: 168 };
      ctx.fillStyle = rgba(peak, 0.55);
      fillRoundRect(ctx, tickX, tickY, tickW, tickH, Math.min(corner, tickH * 0.4));
      ctx.fillStyle = rgba({ r: 230, g: 222, b: 200 }, 0.28);
      fillRoundRect(ctx, tickX + 0.5, tickY + 0.15, tickW - 1, Math.max(0.5, tickH * 0.35), 0.35);
    }
  };

  const paintBandMeters = function (now, dt, live) {
    let dominant = "low";
    let maxPct = 0;
    let energy = 0;
    BAND_DEFS.forEach(function (band) {
      const id = band.id;
      const pct = Math.max(0, Math.min(100, smoothBandPct[id] * 100));
      energy += pct;
      if (bandPctEls[id]) {
        bandPctEls[id].textContent = pct < 0.8 ? "—" : Math.round(pct) + "%";
      }
      if (bandFillEls[id]) {
        bandFillEls[id].style.height = pct < 0.6 ? "0%" : Math.max(2, pct) + "%";
        bandFillEls[id].style.setProperty("--led-drive", (Math.max(0, Math.min(1, pct / 100))).toFixed(3));
      }
      if (live) {
        const stepped = peakHoldStep(bandHoldPct[id], bandHoldUntil[id], pct, now, dt);
        bandHoldPct[id] = stepped.v;
        bandHoldUntil[id] = stepped.until;
      } else {
        bandHoldPct[id] *= Math.pow(0.06, dt);
        if (bandHoldPct[id] < 0.4) bandHoldPct[id] = 0;
      }
      if (bandHoldEls[id]) {
        bandHoldEls[id].style.bottom = Math.max(0, Math.min(100, bandHoldPct[id])) + "%";
        bandHoldEls[id].style.opacity = bandHoldPct[id] > 1 ? "1" : "0";
      }
      if (pct > maxPct) {
        maxPct = pct;
        dominant = id;
      }
    });
    bandMeters.forEach(function (el) {
      el.classList.toggle("is-dominant", live && el.dataset.band === dominant && maxPct > 18);
    });
    return energy;
  };

  const clearBandMeters = function () {
    BAND_DEFS.forEach(function (band) {
      const key = band.id;
      smoothBandPct[key] = 0;
      if (bandPctEls[key]) bandPctEls[key].textContent = "—";
      if (bandFillEls[key]) {
        bandFillEls[key].style.height = "0%";
        bandFillEls[key].style.setProperty("--led-drive", "0");
      }
      if (bandHoldEls[key]) {
        bandHoldEls[key].style.bottom = "0%";
        bandHoldEls[key].style.opacity = "0";
      }
      bandHoldPct[key] = 0;
      bandHoldUntil[key] = 0;
    });
    bandMeters.forEach(function (el) { el.classList.remove("is-dominant"); });
  };

  const updateBandDistribution = function (playing) {
    if (!playing) {
      clearBandMeters();
      return;
    }
    const levels = measureBandLevels();
    if (!levels) return;
    const now = performance.now();
    const dt = holdClock ? Math.min(0.05, (now - holdClock) / 1000) : 1 / 60;
    BAND_DEFS.forEach(function (band, i) {
      const id = band.id;
      const prev = smoothBandPct[id] || 0;
      const target = levels[i] || 0;
      const coeff = target >= prev ? BAND_ATK : BAND_REL;
      smoothBandPct[id] = prev + (target - prev) * coeff;
    });
    paintBandMeters(now, dt, true);
  };

  const decayByteBuffer = function (buf, dt) {
    if (!buf) return 0;
    const factor = Math.pow(0.04, dt);
    let energy = 0;
    for (let i = 0; i < buf.length; i += 1) {
      const next = buf[i] * factor;
      buf[i] = next < 0.8 ? 0 : next;
      energy += buf[i];
    }
    return energy;
  };

  const decayAmp = function (v, dbPerS, dt) {
    return v * Math.pow(10, (-dbPerS * Math.max(0.001, dt)) / 20);
  };

  const spectrumMotionEnergy = function () {
    const sum = function (arr) {
      if (!arr) return 0;
      let e = 0;
      for (let i = 0; i < arr.length; i += 1) e += arr[i];
      return e;
    };
    return sum(specHoldL) + sum(specHoldR) + sum(specEnvL) + sum(specEnvR);
  };

  const updateDetectUI = function (peaks) {
    const playing = media && !media.paused && !media.ended;
    const lText = playing ? fmtPeak(peaks.peakL) : "—";
    const rText = playing ? fmtPeak(peaks.peakR) : "—";
    const bText = playing && peaks.beat != null && peaks.beat >= 20 ? fmtPeak(peaks.beat) : "—";
    if (detectL) detectL.textContent = lText;
    if (detectR) detectR.textContent = rText;
    if (detectBeat) detectBeat.textContent = bText;
    if (peakLabelL) peakLabelL.textContent = lText;
    if (peakLabelR) peakLabelR.textContent = rText;
    updateBandDistribution(playing);
  };

  const drawVLine = function (ctx, x, top, bottom, color, width, dash) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width || 1;
    ctx.setLineDash(dash || []);
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x, bottom);
    ctx.stroke();
    ctx.restore();
  };

  // Short window for VU (~70–90 ms) so the needle follows kicks/hats;
  // full fftSize (~0.7 s) was averaging the music into a sticky level.
  const VU_RMS_SAMPLES = 3072;

  // 0 VU ≈ -10 dBFS for club masters; mild mid-expand so the dial breathes.
  const rmsToVu = function (rms) {
    const dbFS = 20 * Math.log10(Math.max(1e-8, rms));
    const t = Math.max(0, Math.min(1, (dbFS + 10 + 20) / 23));
    return Math.pow(t, 0.78);
  };

  const readChannelRms = function (timeData) {
    if (!timeData || !timeData.length) return 0;
    const n = Math.min(VU_RMS_SAMPLES, timeData.length);
    const start = timeData.length - n;
    let sum = 0;
    for (let i = start; i < timeData.length; i += 1) {
      const s = timeData[i];
      sum += s * s;
    }
    return Math.sqrt(sum / n);
  };

  const vuAngle = function (t) {
    // Pivot en bas : balayage au-dessus, -20 (gauche) → +3 (droite).
    // Canvas: 0° = droite, sens horaire ; négatif = vers le haut.
    return (-138 + Math.max(0, Math.min(1, t)) * 96) * Math.PI / 180;
  };

  const drawVuMeter = function (canvas, level, peak, channel) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 40 || h < 40) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const rich = true;
    // True circle in CSS pixels; leave room below for pivot + needle counterweight.
    const padX = Math.max(8, w * 0.035);
    const padTop = Math.max(8, h * 0.05);
    const padBottom = Math.max(14, h * 0.1);
    const cx = w * 0.5;
    const cy = h - padBottom;
    const radius = Math.max(12, Math.min((w - padX * 2) * 0.5, cy - padTop));
    const accent = palette ? palette.accent : { r: 180, g: 150, b: 100 };
    const cream = { r: 214, g: 200, b: 172 };
    const ink = { r: 32, g: 24, b: 16 };
    const red = { r: 180, g: 62, b: 48 };

    ctx.clearRect(0, 0, w, h);

    // Dial face — aged parchment, dimmed to match the dark rack modules.
    const face = ctx.createRadialGradient(cx, cy - radius * 0.45, 6, cx, cy, radius * 1.2);
    face.addColorStop(0, rich ? "rgba(210, 196, 168, 0.78)" : "rgba(210, 196, 168, 0.4)");
    face.addColorStop(0.5, rich ? "rgba(168, 148, 116, 0.72)" : "rgba(168, 148, 116, 0.28)");
    face.addColorStop(1, rich ? "rgba(78, 62, 42, 0.55)" : "rgba(0,0,0,0)");
    ctx.beginPath();
    ctx.moveTo(cx - radius, cy);
    ctx.arc(cx, cy, radius, Math.PI, 0, false);
    ctx.closePath();
    ctx.fillStyle = face;
    ctx.fill();

    // Inner rim
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.97, Math.PI * 1.02, Math.PI * -0.02);
    ctx.strokeStyle = rgba(ink, rich ? 0.28 : 0.14);
    ctx.lineWidth = rich ? 2 : 1;
    ctx.stroke();

    // Scale arc
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.86, vuAngle(0), vuAngle(1));
    ctx.strokeStyle = rgba(ink, rich ? 0.35 : 0.2);
    ctx.lineWidth = 1.1;
    ctx.stroke();

    // Red zone
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.86, vuAngle(20 / 23), vuAngle(1));
    ctx.strokeStyle = rgba(red, rich ? 0.7 : 0.5);
    ctx.lineWidth = rich ? 2.4 : 1.8;
    ctx.stroke();

    const marks = [
      { vu: -20, label: "−20" },
      { vu: -10, label: "−10" },
      { vu: -7, label: "" },
      { vu: -5, label: "−5" },
      { vu: -3, label: "−3" },
      { vu: -1, label: "" },
      { vu: 0, label: "0" },
      { vu: 1, label: "" },
      { vu: 2, label: "" },
      { vu: 3, label: "+3" },
    ];

    marks.forEach(function (m) {
      const t = (m.vu + 20) / 23;
      const ang = vuAngle(t);
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const major = m.label !== "";
      const r0 = radius * (major ? 0.72 : 0.78);
      const r1 = radius * 0.86;
      ctx.beginPath();
      ctx.moveTo(cx + cos * r0, cy + sin * r0);
      ctx.lineTo(cx + cos * r1, cy + sin * r1);
      ctx.strokeStyle = m.vu >= 0 ? rgba(red, major ? 0.8 : 0.4) : rgba(ink, major ? 0.55 : 0.28);
      ctx.lineWidth = major ? 1.5 : 1;
      ctx.stroke();

      if (major) {
        ctx.fillStyle = m.vu >= 0 ? rgba(red, 0.85) : rgba(ink, 0.62);
        ctx.font = (rich ? "600 " : "500 ") + (rich ? "10px" : "9px") + " Outfit, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(m.label, cx + cos * radius * 0.6, cy + sin * radius * 0.6);
      }
    });

    ctx.fillStyle = rgba(ink, rich ? 0.38 : 0.26);
    ctx.font = "500 " + (rich ? "11px" : "10px") + " Outfit, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.letterSpacing = "0.18em";
    ctx.fillText("VU", cx, cy - radius * 0.28);
    ctx.letterSpacing = "0px";

    if (peak > 0.02) {
      const pang = vuAngle(peak);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(pang) * radius * 0.74, cy + Math.sin(pang) * radius * 0.74);
      ctx.lineTo(cx + Math.cos(pang) * radius * 0.88, cy + Math.sin(pang) * radius * 0.88);
      ctx.strokeStyle = rgba(red, 0.5);
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }

    // Needle + soft shadow (same angle — no glow drift)
    const ang = vuAngle(level || 0);
    const tipX = cx + Math.cos(ang) * radius * 0.84;
    const tipY = cy + Math.sin(ang) * radius * 0.84;
    const tail = Math.min(6, padBottom * 0.45);
    const baseX = cx - Math.cos(ang) * tail;
    const baseY = cy - Math.sin(ang) * tail;
    ctx.save();
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 2.1;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(baseX + 0.8, baseY + 1.1);
    ctx.lineTo(tipX + 0.8, tipY + 1.1);
    ctx.stroke();
    ctx.strokeStyle = rgba(ink, 0.94);
    ctx.lineWidth = rich ? 1.55 : 1.3;
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    ctx.restore();

    if ((level || 0) > 0.82) {
      ctx.beginPath();
      ctx.arc(tipX, tipY, 2.4, 0, Math.PI * 2);
      ctx.fillStyle = rgba(red, 0.5);
      ctx.fill();
    }

    // Brass pivot
    const hubR = rich ? 4.2 : 3.4;
    const hub = ctx.createRadialGradient(cx - 1.2, cy - 1.4, 0.4, cx, cy, hubR + 1);
    hub.addColorStop(0, "#f3e6c4");
    hub.addColorStop(0.45, rgba(accent, 0.85));
    hub.addColorStop(1, "#2a1c0c");
    ctx.beginPath();
    ctx.arc(cx, cy, hubR, 0, Math.PI * 2);
    ctx.fillStyle = hub;
    ctx.fill();
    ctx.strokeStyle = rgba(cream, 0.35);
    ctx.lineWidth = 0.8;
    ctx.stroke();

  };

  const updateVuMeters = function (playing, dt) {
    let targetL = 0;
    let targetR = 0;
    if (playing && timeL && timeR) {
      analyserL.getFloatTimeDomainData(timeL);
      analyserR.getFloatTimeDomainData(timeR);
      targetL = rmsToVu(readChannelRms(timeL));
      targetR = rmsToVu(readChannelRms(timeR));
    }
    // Live: snappy. Stopped/coast: slow fall so needles + peak marks settle.
    const atk = 0.58;
    const rel = playing ? 0.2 : 0.04;
    vuLevelL = targetL >= vuLevelL
      ? vuLevelL + (targetL - vuLevelL) * atk
      : vuLevelL + (targetL - vuLevelL) * rel;
    vuLevelR = targetR >= vuLevelR
      ? vuLevelR + (targetR - vuLevelR) * atk
      : vuLevelR + (targetR - vuLevelR) * rel;

    const now = performance.now();
    if (playing) {
      const stepL = peakHoldStep(vuPeakL, vuPeakUntilL, vuLevelL, now, dt);
      vuPeakL = stepL.v;
      vuPeakUntilL = stepL.until;
      const stepR = peakHoldStep(vuPeakR, vuPeakUntilR, vuLevelR, now, dt);
      vuPeakR = stepR.v;
      vuPeakUntilR = stepR.until;
    } else {
      vuPeakL *= Math.pow(0.12, dt);
      vuPeakR *= Math.pow(0.12, dt);
      if (vuPeakL < 0.008) vuPeakL = 0;
      if (vuPeakR < 0.008) vuPeakR = 0;
    }

    drawVuMeter(vuCanvasL, vuLevelL, vuPeakL, "l");
    drawVuMeter(vuCanvasR, vuLevelR, vuPeakR, "r");
  };

  // Absolute dB window + soft AGC. Power-sum per log band ≈ pink-flat RTA
  // (mean/peak bias was crushing highs into isolated spikes).
  const SPEC_DB_FLOOR = -70;
  const SPEC_DB_CEIL = -18;
  const SPEC_AGC_TARGET = 0.82;
  const SPEC_AGC_DECAY = 0.994;

  const sampleSpectrum = function (floatDb, bars) {
    const values = new Float32Array(bars);
    if (!floatDb) return values;
    const span = SPEC_DB_CEIL - SPEC_DB_FLOOR;
    let frameMax = 1e-6;
    for (let i = 0; i < bars; i += 1) {
      const f0 = hzAtT(i / bars);
      const f1 = hzAtT((i + 1) / bars);
      const b0 = Math.max(startBin, Math.floor(f0 / binHz));
      const b1 = Math.min(endBin, Math.max(b0 + 1, Math.ceil(f1 / binHz)));
      let power = 0;
      for (let k = b0; k < b1; k += 1) {
        const db = floatDb[k];
        if (db > -120) {
          const lin = Math.pow(10, db / 20);
          power += lin * lin;
        }
      }
      // Sum power across the log band (do not divide by bin count).
      const db = power > 1e-24 ? 10 * Math.log10(power) : SPEC_DB_FLOOR;
      const t = Math.max(0, Math.min(1, (db - SPEC_DB_FLOOR) / span));
      values[i] = t;
      if (t > frameMax) frameMax = t;
    }
    specRollPeak = Math.max(frameMax, specRollPeak * SPEC_AGC_DECAY);
    if (specRollPeak < 0.1) specRollPeak = 0.1;
    const scale = SPEC_AGC_TARGET / specRollPeak;
    for (let i = 0; i < bars; i += 1) {
      const t = Math.min(1, values[i] * scale);
      values[i] = Math.pow(t, 0.85);
    }
    return values;
  };

  const drawSpectrum = function (canvas, data, detectedHz, channel, frameDt) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dt = frameDt != null && frameDt > 0 ? Math.min(0.05, frameDt) : 1 / 60;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w < 8 || h < 8) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const nextW = Math.floor(w * dpr);
    const nextH = Math.floor(h * dpr);
    if (canvas.width !== nextW || canvas.height !== nextH) {
      canvas.width = nextW;
      canvas.height = nextH;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const padX = 8;
    const top = 14;
    const axisH = 22;
    const usableH = Math.max(40, h - top - axisH);
    const plotBottom = top + usableH;
    const a = palette.accent;
    const soft = palette.soft;

    ctx.clearRect(0, 0, w, h);

    // Smoked window — same warm ink as the module chassis.
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "rgba(18, 14, 10, 0.55)");
    bg.addColorStop(0.55, "rgba(10, 8, 6, 0.35)");
    bg.addColorStop(1, "rgba(6, 5, 4, 0.2)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    BAND_DEFS.forEach(function (band, i) {
      const x0 = hzToX(band.lo, w, padX);
      const x1 = hzToX(Math.min(F_HIGH, band.hi), w, padX);
      ctx.fillStyle = rgba(a, 0.012 + i * 0.006);
      ctx.fillRect(x0, top, Math.max(1, x1 - x0), usableH);
    });

    AXIS_TICKS.forEach(function (hz) {
      const x = hzToX(hz, w, padX);
      const grad = ctx.createLinearGradient(0, top, 0, plotBottom);
      grad.addColorStop(0, rgba(soft, 0));
      grad.addColorStop(0.5, rgba(soft, 0.08));
      grad.addColorStop(1, rgba(soft, 0));
      drawVLine(ctx, x, top, plotBottom, grad, 1);
    });

    // Peak Hz stays in the header / viz-peak labels — no overlay on the LED grid.

    const bars = SPEC_BARS;
    const floatDb = data ? (channel === "r" ? floatR : floatL) : null;
    const values = sampleSpectrum(floatDb, bars);
    const ensureSpecState = function (isRight) {
      const holdRef = isRight ? specHoldR : specHoldL;
      const envRef = isRight ? specEnvR : specEnvL;
      if (!holdRef || holdRef.length !== bars) {
        if (isRight) {
          specHoldR = new Float32Array(bars);
          specHoldUntilR = new Float64Array(bars);
        } else {
          specHoldL = new Float32Array(bars);
          specHoldUntilL = new Float64Array(bars);
        }
      }
      if (!envRef || envRef.length !== bars) {
        if (isRight) specEnvR = new Float32Array(bars);
        else specEnvL = new Float32Array(bars);
      }
    };
    ensureSpecState(channel === "r");
    const holds = channel === "r" ? specHoldR : specHoldL;
    const untils = channel === "r" ? specHoldUntilR : specHoldUntilL;
    const envs = channel === "r" ? specEnvR : specEnvL;
    const now = performance.now();
    const barSlot = (w - padX * 2) / bars;
    const barW = Math.max(3.2, barSlot * 0.72);

    for (let i = 0; i < bars; i += 1) {
      const raw = values[i] || 0;
      // Instant attack, Fast industry release on the live LED column.
      const prev = envs[i] || 0;
      const bar = raw >= prev ? raw : Math.max(raw, decayAmp(prev, BAR_FALL_DB_PER_S, dt));
      envs[i] = bar < 0.01 ? 0 : bar;
      // Latch to the live column; draw path parks the tick in the cell above the tip.
      const stepped = peakHoldStep(holds[i] || 0, untils[i] || 0, Math.max(envs[i], raw), now, dt);
      holds[i] = stepped.v;
      untils[i] = stepped.until;
      const x = padX + i * barSlot + (barSlot - barW) * 0.5;
      drawLedColumn(
        ctx,
        x,
        barW,
        plotBottom,
        usableH,
        envs[i],
        holds[i] > 0.03 ? holds[i] : null,
        LED_SEGS_MAIN
      );
    }

    // Decade graduations under the matrix: 31 · 63 · 125 · 250 · 500 · 1k … 16k
    ctx.fillStyle = rgba(soft, 0.55);
    ctx.font = "500 10px Sora, system-ui, sans-serif";
    ctx.textAlign = "center";
    const labelY = plotBottom + 14;
    AXIS_TICKS.forEach(function (hz) {
      const x = hzToX(hz, w, padX);
      ctx.fillText(fmtTick(hz), x, labelY);
    });
  };

  const finishCoast = function () {
    coasting = false;
    vizActive = false;
    root.classList.remove("is-live");
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    holdClock = 0;
    silentFrames = 0;
    vuLevelL = vuLevelR = 0;
    vuPeakL = vuPeakR = 0;
    if (dataL) dataL.fill(0);
    if (dataR) dataR.fill(0);
    clearBandMeters();
    updateDetectUI({ peakL: null, peakR: null, beat: null });
    if (analysisStatus) {
      analysisStatus.hidden = true;
      analysisStatus.textContent = "";
    }
    drawVuMeter(vuCanvasL, 0, 0, "l");
    drawVuMeter(vuCanvasR, 0, 0, "r");
    drawSpectrum(canvasL, null, null, "l");
    drawSpectrum(canvasR, null, null, "r");
  };

  const frame = function () {
    if (!vizActive || !analyserL || !analyserR) return;
    const playing = media && !media.paused && !media.ended;
    const now = performance.now();
    const dt = holdClock ? Math.min(0.05, (now - holdClock) / 1000) : 1 / 60;
    holdClock = now;

    if (!playing) {
      // Coast: EQ LEDs + isolator + VU fall together after pause.
      BAND_DEFS.forEach(function (band) {
        smoothBandPct[band.id] *= Math.pow(0.045, dt);
        if (smoothBandPct[band.id] < 0.002) smoothBandPct[band.id] = 0;
      });
      const bandE = paintBandMeters(now, dt, false);
      const specE = decayByteBuffer(dataL, dt) + decayByteBuffer(dataR, dt);
      // null → no fresh FFT; LED envs / peak holds coast on frame dt (not holdClock).
      drawSpectrum(canvasL, null, null, "l", dt);
      drawSpectrum(canvasR, null, null, "r", dt);
      updateVuMeters(false, dt);
      if (detectL) detectL.textContent = "—";
      if (detectR) detectR.textContent = "—";
      if (detectBeat) detectBeat.textContent = "—";
      if (peakLabelL) peakLabelL.textContent = "—";
      if (peakLabelR) peakLabelR.textContent = "—";
      const holdE = spectrumMotionEnergy();
      const stillMoving =
        vuLevelL > 0.012 || vuLevelR > 0.012 || vuPeakL > 0.02 || vuPeakR > 0.02 ||
        specE > 40 || holdE > 0.08 || bandE > 1.5;
      if (coasting && !stillMoving) {
        finishCoast();
        return;
      }
      raf = requestAnimationFrame(frame);
      return;
    }

    coasting = false;
    analyserL.getByteFrequencyData(dataL);
    analyserR.getByteFrequencyData(dataR);
    analyserL.getFloatFrequencyData(floatL);
    analyserR.getFloatFrequencyData(floatR);
    const peaks = detectPeaks();
    updateDetectUI(peaks);
    stereoFrames += 1;
    if (stereoFrames === 12 || stereoFrames % 90 === 0) sampleStereoLikelihood();
    if (analysisStatus && media) {
      let max = 0;
      for (let i = 0; i < dataL.length; i += 1) max = Math.max(max, dataL[i], dataR[i]);
      if (max < 2) {
        silentFrames += 1;
      } else {
        silentFrames = 0;
      }
      if (silentFrames >= SILENT_WARN_FRAMES) {
        analysisStatus.hidden = false;
        analysisStatus.textContent = "L’audio joue, mais l’analyseur ne voit pas le signal (souvent CORS / file://). Ouvre via http://127.0.0.1:8765.";
      } else if (!stereoLikely && max >= 2) {
        analysisStatus.hidden = false;
        analysisStatus.textContent = "G et D sont identiques dans le temps (mono ou copie). Les pics uniques demandent un vrai stéréo.";
      } else {
        analysisStatus.hidden = true;
        analysisStatus.textContent = "";
      }
    }
    drawSpectrum(canvasL, dataL, peaks.peakL, "l", dt);
    drawSpectrum(canvasR, dataR, peaks.peakR, "r", dt);
    updateVuMeters(true, dt);
    raf = requestAnimationFrame(frame);
  };

  const startViz = function () {
    coasting = false;
    if (raf) cancelAnimationFrame(raf);
    vizActive = true;
    root.classList.add("is-live");
    raf = requestAnimationFrame(frame);
  };

  const stopViz = function () {
    coasting = false;
    vizActive = false;
    root.classList.remove("is-live");
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    holdClock = 0;
    silentFrames = 0;
    vuLevelL = vuLevelR = 0;
    vuPeakL = vuPeakR = 0;
    if (dataL) dataL.fill(0);
    if (dataR) dataR.fill(0);
    clearBandMeters();
    updateDetectUI({ peakL: null, peakR: null, beat: null });
    if (analysisStatus) {
      analysisStatus.hidden = true;
      analysisStatus.textContent = "";
    }
    drawVuMeter(vuCanvasL, 0, 0, "l");
    drawVuMeter(vuCanvasR, 0, 0, "r");
    drawSpectrum(canvasL, null, null, "l");
    drawSpectrum(canvasR, null, null, "r");
  };

  // Pause / fin de piste : les aiguilles et le voyant retombent avec latence.
  const pauseViz = function () {
    if (!vizActive && !raf) return;
    coasting = true;
    vizActive = true;
    if (!raf) raf = requestAnimationFrame(frame);
  };

  const resetHolds = function () {
    smoothPeakL = null;
    smoothPeakR = null;
    smoothBeat = null;
    smoothBandPct = { low: 0, lowmid: 0, himid: 0, high: 0 };
    bandRollMax = 1e-6;
    bandHoldPct = { low: 0, lowmid: 0, himid: 0, high: 0 };
    bandHoldUntil = { low: 0, lowmid: 0, himid: 0, high: 0 };
    specHoldL = null;
    specHoldR = null;
    specHoldUntilL = null;
    specHoldUntilR = null;
    specEnvL = null;
    specEnvR = null;
    specRollPeak = 0.2;
    stereoLikely = true;
    stereoFrames = 0;
    silentFrames = 0;
    vuLevelL = vuLevelR = 0;
    vuPeakL = vuPeakR = 0;
    vuPeakUntilL = vuPeakUntilR = 0;
  };

  const prepareMedia = function (el) {
    if (!el || !el.tagName) return;
    const tag = el.tagName.toUpperCase();
    if (tag !== "VIDEO" && tag !== "AUDIO") return;
    try {
      // Must be set before (re)loading src so Web Audio can read samples.
      if (el.getAttribute("crossorigin") == null && el.crossOrigin !== "anonymous") {
        el.crossOrigin = "anonymous";
      }
    } catch (err) { /* ignore */ }
  };

  const captureMediaStream = function (el) {
    try {
      if (typeof el.captureStream === "function") return el.captureStream();
      if (typeof el.mozCaptureStream === "function") return el.mozCaptureStream();
    } catch (err) { /* unsupported / CORS */ }
    return null;
  };

  const closeGraph = function () {
    stopViz();
    try { if (tapSource) tapSource.disconnect(); } catch (err) { /* ignore */ }
    try { if (splitter) splitter.disconnect(); } catch (err) { /* ignore */ }
    try { if (analyserL) analyserL.disconnect(); } catch (err) { /* ignore */ }
    try { if (analyserR) analyserR.disconnect(); } catch (err) { /* ignore */ }
    // Do NOT stop captureStream tracks — that can tear down element playback.
    capturedStream = null;
    try {
      if (ac && ac.state !== "closed") ac.close();
    } catch (err) { /* ignore */ }
    ac = null;
    tapSource = null;
    audioTapMode = null;
    boundMedia = null;
    splitter = null;
    analyserL = null;
    analyserR = null;
    dataL = dataR = null;
    floatL = floatR = null;
    uniqueL = uniqueR = null;
    timeL = timeR = null;
  };

  const wireAnalysers = function (source) {
    splitter = ac.createChannelSplitter(2);
    try {
      splitter.channelCount = 2;
      splitter.channelCountMode = "explicit";
      splitter.channelInterpretation = "discrete";
    } catch (err) { /* older browsers */ }

    analyserL = ac.createAnalyser();
    analyserR = ac.createAnalyser();
    const FFT = 8192;
    analyserL.fftSize = FFT;
    analyserR.fftSize = FFT;
    // Near-raw FFT — column ballistics carry the motion.
    analyserL.smoothingTimeConstant = 0.05;
    analyserR.smoothingTimeConstant = 0.05;
    // Match our dB window so any byte-path reads stay consistent.
    analyserL.minDecibels = SPEC_DB_FLOOR;
    analyserR.minDecibels = SPEC_DB_FLOOR;
    analyserL.maxDecibels = SPEC_DB_CEIL;
    analyserR.maxDecibels = SPEC_DB_CEIL;
    try {
      analyserL.channelCount = 1;
      analyserR.channelCount = 1;
      analyserL.channelCountMode = "explicit";
      analyserR.channelCountMode = "explicit";
    } catch (err) { /* older browsers */ }

    dataL = new Uint8Array(analyserL.frequencyBinCount);
    dataR = new Uint8Array(analyserR.frequencyBinCount);
    floatL = new Float32Array(analyserL.frequencyBinCount);
    floatR = new Float32Array(analyserR.frequencyBinCount);
    uniqueL = new Float32Array(analyserL.frequencyBinCount);
    uniqueR = new Float32Array(analyserR.frequencyBinCount);
    timeL = new Float32Array(analyserL.fftSize);
    timeR = new Float32Array(analyserR.fftSize);

    binHz = ac.sampleRate / analyserL.fftSize;
    startBin = Math.max(0, Math.floor(F_LOW / binHz));
    endBin = Math.min(analyserL.frequencyBinCount, Math.ceil(F_HIGH / binHz));

    source.connect(splitter);
    splitter.connect(analyserL, 0);
    splitter.connect(analyserR, 1);
  };

  const setupGraph = async function () {
    if (!media) return;
    const tag = (media.tagName || "").toUpperCase();
    if (tag !== "VIDEO" && tag !== "AUDIO") return;

    prepareMedia(media);

    // Same media already tapped — keep the live path untouched.
    if (ac && tapSource && boundMedia === media) {
      if (ac.state === "suspended") {
        try { await ac.resume(); } catch (err) { /* ignore */ }
      }
      startViz();
      return;
    }

    if (ac && boundMedia && boundMedia !== media) {
      closeGraph();
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    // playback hint: stable, glitch-resistant path for headphone listening.
    try {
      ac = new AudioCtx({ latencyHint: "playback" });
    } catch (err) {
      ac = new AudioCtx();
    }

    // Preferred: native <video> → headphones; Web Audio only taps a capture stream.
    // Fallback: MediaElementSource (then audio MUST go through the context).
    // Prefer stream even before tracks appear — avoid locking the element into MES.
    let mode = null;
    let source = null;
    const stream = captureMediaStream(media);
    if (stream) {
      try {
        source = ac.createMediaStreamSource(stream);
        capturedStream = stream;
        mode = "stream";
      } catch (err) {
        source = null;
        capturedStream = null;
      }
    }

    if (!source) {
      try {
        source = ac.createMediaElementSource(media);
        mode = "element";
      } catch (err) {
        closeGraph();
        try {
          ac = new AudioCtx({ latencyHint: "playback" });
        } catch (errCtx) {
          ac = new AudioCtx();
        }
        try {
          source = ac.createMediaElementSource(media);
          mode = "element";
        } catch (err2) {
          ac = null;
          tapSource = null;
          boundMedia = null;
          if (analysisStatus) {
            analysisStatus.hidden = false;
            analysisStatus.textContent = "Impossible de brancher l’analyseur sur ce média. Recharge la page.";
          }
          return;
        }
      }
    }

    tapSource = source;
    audioTapMode = mode;
    boundMedia = media;

    try {
      tapSource.channelCount = 2;
      tapSource.channelCountMode = "explicit";
      tapSource.channelInterpretation = "discrete";
    } catch (err) { /* older browsers */ }

    wireAnalysers(tapSource);

    // Only the element-tap fallback needs Web Audio → speakers.
    // Stream tap leaves native media playback alone (best headphone fidelity).
    if (audioTapMode === "element") {
      tapSource.connect(ac.destination);
    }

    if (ac.state === "suspended") {
      try { await ac.resume(); } catch (err) { /* ignore */ }
    }
    startViz();
  };

  window.HorizonAnalyser = {
    attach: function (element) {
      if (!element) return;
      prepareMedia(element);
      if (media === element) return;
      media = element;
      silentFrames = 0;
      drawSpectrum(canvasL, null, null, "l");
      drawSpectrum(canvasR, null, null, "r");
    },
    setAccent: function (hex) {
      applyPalette(hex, true);
    },
    start: function () {
      if (ac && tapSource && boundMedia === media) {
        if (ac.state === "suspended") {
          ac.resume().catch(function () { /* ignore */ });
        }
        if (!vizActive || coasting) {
          if (!vizActive) resetHolds();
          startViz();
        }
        return;
      }
      const fresh = !vizActive;
      if (fresh) resetHolds();
      setupGraph();
    },
    stop: stopViz,
    /** Soft pause — needles + live dot coast down; keeps the audio tap. */
    pause: pauseViz,
    /** Hard teardown when leaving HTML5 media (e.g. switch to YouTube). */
    detach: function () {
      closeGraph();
      media = null;
      drawSpectrum(canvasL, null, null, "l");
      drawSpectrum(canvasR, null, null, "r");
    },
  };

  applyPalette("#869BE4", true);

  window.addEventListener("resize", function () {
    if (!vizActive) {
      drawSpectrum(canvasL, null, null, "l");
      drawSpectrum(canvasR, null, null, "r");
    }
  });
})();
