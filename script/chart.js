/* The critical price over the life of the option, drawn against the stock's
   projected range. */

import { findCriticalPrice, dividendValueAt } from "./model.js";

const CHART_STEPS = 110;

/* Colours come from the stylesheet so the chart follows light and dark mode
   without keeping a second copy of the palette. Read per draw, since the theme
   can change while the page is open. */
function readInk() {
  const style = getComputedStyle(document.documentElement);
  const token = (name) => style.getPropertyValue(name).trim();
  return {
    grid: token("--rule"),
    axis: token("--rule-strong"),
    faint: token("--text-faint"),
    text: token("--text"),
    accent: token("--accent-text"),
    flag: token("--negative"),
    range: token("--text-soft"),
    panel: token("--surface"),
    zoneFill: token("--zone-fill"),
    zoneSwatch: token("--zone-swatch"),
    coneOuter: token("--cone-outer"),
    coneInner: token("--cone-inner"),
    coneSwatch: token("--cone-swatch"),
  };
}

export function drawChart(
  isCall,
  spot,
  strike,
  years,
  rate,
  dividend,
  vol,
  criticalNow,
  days,
  sigmasAway,
  later,
) {
  const INK = readInk();
  const svg = document.getElementById("chart"),
    caption = document.getElementById("chartCaption");
  const fractions = [
    0, 0.06, 0.13, 0.21, 0.29, 0.38, 0.47, 0.56, 0.65, 0.73, 0.81, 0.88, 0.94, 0.98, 1,
  ];
  /* A dividend adds samples at the close before it goes ex and just after, so the
     jump in the critical price lands on the right day. */
  const exDay = dividend ? dividend.years * 365 : null;
  const sampleDays = fractions.map((fraction) => days * fraction);
  if (exDay !== null) sampleDays.push(exDay, Math.min(days, exDay + 0.02));
  sampleDays.sort((a, b) => a - b);
  /* The dividend as seen from a later day: still to come until its ex-date close. */
  const dividendFrom = function (elapsed) {
    return dividend && elapsed <= dividend.years
      ? { amount: dividend.amount, years: Math.max(dividend.years - elapsed, 1e-9) }
      : null;
  };

  /* Null where no stock price makes exercising pay: every day before a call's
     ex-dividend close, or while a dividend still holds a put back. */
  const boundary = sampleDays.map(function (day) {
    const elapsed = day / 365,
      remaining = years - elapsed;
    const level = findCriticalPrice(
      strike,
      remaining <= 1e-6 ? 0 : remaining,
      rate,
      dividendFrom(elapsed),
      vol,
      CHART_STEPS,
      isCall,
    );
    return { day: day, level: level };
  });
  const hasCrossing = boundary.some((point) => point.level !== null);
  /* Runs of consecutive days with a critical price, each drawn as its own line. */
  const runs = [];
  boundary.forEach(function (point, i) {
    if (point.level === null) return;
    if (i > 0 && boundary[i - 1].level !== null) runs[runs.length - 1].push(point);
    else runs.push([point]);
  });
  const firstLevel = hasCrossing ? runs[0][0].level : null;

  /* Matching the viewBox to the element's pixel width keeps one user unit at one
     CSS pixel, so the type stays true size at any column width. */
  const width = Math.max(320, Math.round(svg.clientWidth || 680));
  const height = Math.round(Math.max(250, Math.min(430, width * 0.55)));
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  const left = 74,
    right = width - 10,
    top = 16;
  /* The two legend entries stack when the chart is too narrow to fit them side by side. */
  const legendGap = 172,
    legendStacked = hasCrossing && left + legendGap + 190 > right;
  const bottom = height - (legendStacked ? 82 : 64),
    legendY = height - (legendStacked ? 52 : 34);

  /* The range spreads the escrowed part of the price, then adds back the dividend
     still to come, so it steps down by the dividend at the ex-date. */
  const escrowed = spot - dividendValueAt(dividend, rate, 0);
  const cone = sampleDays.map(function (day) {
    const elapsed = day / 365;
    const spread = vol * Math.sqrt(elapsed),
      drift = (rate - (vol * vol) / 2) * elapsed,
      pending = dividendValueAt(dividend, rate, elapsed);
    return {
      day: day,
      low1: escrowed * Math.exp(drift - spread) + pending,
      high1: escrowed * Math.exp(drift + spread) + pending,
      low2: escrowed * Math.exp(drift - 2 * spread) + pending,
      high2: escrowed * Math.exp(drift + 2 * spread) + pending,
    };
  });

  /* The range covers the cone, spot and strike. S* joins them when it is close
     enough to be worth showing; a boundary far out of reach is clamped instead, so
     it enters from the edge as it converges rather than flattening everything else. */
  const edge = cone[cone.length - 1];
  let lowest = Math.min(edge.low2, spot, strike),
    highest = Math.max(edge.high2, spot, strike);
  if (hasCrossing) {
    if (isCall) highest = Math.max(highest, Math.min(firstLevel, highest * 1.8));
    else lowest = Math.min(lowest, Math.max(firstLevel, lowest * 0.55));
  }
  lowest *= 0.975;
  highest *= 1.015;

  const toX = function (day) {
    return left + (days > 0 ? day / days : 0) * (right - left);
  };
  const toY = function (price) {
    return (
      bottom -
      ((Math.max(lowest, Math.min(highest, price)) - lowest) / (highest - lowest)) *
        (bottom - top)
    );
  };
  const lineThrough = function (points, key) {
    return points
      .map(function (point, i) {
        return (i ? "L" : "M") + toX(point.day).toFixed(1) + " " + toY(point[key]).toFixed(1);
      })
      .join(" ");
  };
  const bandBetween = function (highKey, lowKey) {
    return (
      lineThrough(cone, highKey) +
      " " +
      cone
        .slice()
        .reverse()
        .map(function (point) {
          return "L" + toX(point.day).toFixed(1) + " " + toY(point[lowKey]).toFixed(1);
        })
        .join(" ") +
      " Z"
    );
  };

  /* Where the adverse one-sigma path first meets the exercise region: down for a
     short put, up for a short call. */
  const adverseKey = isCall ? "high1" : "low1";
  const separation = function (i) {
    return isCall
      ? boundary[i].level - cone[i][adverseKey]
      : cone[i][adverseKey] - boundary[i].level;
  };
  let meeting = null;
  if (hasCrossing) {
    for (let i = 1; i < sampleDays.length; i++) {
      if (boundary[i - 1].level === null || boundary[i].level === null) continue;
      const before = separation(i - 1),
        after = separation(i);
      if (before > 0 && after <= 0) {
        const weight = before / (before - after);
        meeting = {
          day: cone[i - 1].day + (cone[i].day - cone[i - 1].day) * weight,
          level: boundary[i - 1].level + (boundary[i].level - boundary[i - 1].level) * weight,
        };
        break;
      }
    }
  }

  const priceLabel = function (price) {
    return price >= 1000
      ? "$" + Math.round(price).toLocaleString("en-US")
      : "$" + price.toFixed(2);
  };
  const markers = [];
  if (criticalNow !== null)
    markers.push({ price: criticalNow, colour: INK.flag, name: "CRITICAL", weight: 700 });
  markers.push({ price: spot, colour: INK.text, name: "SPOT", weight: 600 });
  markers.push({ price: strike, colour: INK.accent, name: "STRIKE", weight: 600 });
  markers.forEach(function (marker) {
    marker.y = toY(marker.price);
  });
  markers.sort(function (a, b) {
    return a.y - b.y;
  });
  for (let i = 1; i < markers.length; i++) {
    if (markers[i].y - markers[i - 1].y < 22) markers[i].y = markers[i - 1].y + 22;
  }
  for (let i = markers.length - 1; i > 0; i--) {
    if (markers[i].y > bottom) markers[i].y = bottom;
    if (markers[i].y - markers[i - 1].y < 22) markers[i - 1].y = markers[i].y - 22;
  }
  const axisLabels = markers
    .map((marker) => {
      const y = toY(marker.price).toFixed(1);
      return (
        `<line x1="${left - 6}" y1="${y}" x2="${left}" y2="${y}" stroke="${marker.colour}" stroke-width="1.5"/>` +
        `<text x="${left - 10}" y="${(marker.y + 4).toFixed(1)}" fill="${marker.colour}" font-size="12.5" font-weight="${marker.weight}" font-family="JetBrains Mono,monospace" text-anchor="end">${priceLabel(marker.price)}</text>` +
        `<text x="${left - 10}" y="${(marker.y + 15).toFixed(1)}" fill="${INK.faint}" font-size="9.5" letter-spacing=".08em" font-family="Inter,sans-serif" text-anchor="end">${marker.name}</text>`
      );
    })
    .join("");

  const timeMarks = [0, 0.25, 0.5, 0.75, 1];
  const gridLines = timeMarks
    .map((fraction) => {
      const x = toX(days * fraction).toFixed(1);
      return `<line x1="${x}" y1="${top}" x2="${x}" y2="${bottom}" stroke="${INK.grid}" stroke-width=".5"/>`;
    })
    .join("");
  const timeLabels = timeMarks
    .map((fraction) => {
      const day = days * fraction;
      const anchor = fraction === 0 ? "start" : fraction === 1 ? "end" : "middle";
      const label =
        fraction === 0 ? "today" : fraction === 1 ? "expiration" : `${Math.round(day)}d`;
      return `<text x="${toX(day).toFixed(1)}" y="${bottom + 18}" fill="${INK.faint}" font-size="11.5" font-family="JetBrains Mono,monospace" text-anchor="${anchor}">${label}</text>`;
    })
    .join("");

  const regionEdge = isCall ? top : bottom;
  /* A run of one day — a call's ex-dividend close — becomes a narrow band. */
  const zones = runs
    .map(function (run) {
      if (run.length === 1) {
        const x = toX(run[0].day),
          y = toY(run[0].level);
        return `<rect x="${(x - 4).toFixed(1)}" y="${Math.min(y, regionEdge).toFixed(1)}" width="8" height="${Math.abs(regionEdge - y).toFixed(1)}" fill="${INK.zoneFill}"/>`;
      }
      return `<path d="${lineThrough(run, "level")} L${toX(run[run.length - 1].day).toFixed(1)} ${regionEdge} L${toX(run[0].day).toFixed(1)} ${regionEdge} Z" fill="${INK.zoneFill}"/>`;
    })
    .join("");
  const boundaryLines = runs
    .map(function (run) {
      if (run.length === 1)
        return `<circle cx="${toX(run[0].day).toFixed(1)}" cy="${toY(run[0].level).toFixed(1)}" r="3.6" fill="${INK.flag}" stroke="${INK.panel}" stroke-width="1.5"/>`;
      return `<path d="${lineThrough(run, "level")}" fill="none" stroke="${INK.flag}" stroke-width="2.2" stroke-linejoin="round"/>`;
    })
    .join("");
  const exMarker =
    exDay === null
      ? ""
      : `<line x1="${toX(exDay).toFixed(1)}" y1="${top}" x2="${toX(exDay).toFixed(1)}" y2="${bottom}" stroke="${INK.range}" stroke-width="1" stroke-dasharray="2 3" opacity=".7"/>` +
        `<text x="${(toX(exDay) + 5).toFixed(1)}" y="${top + 11}" fill="${INK.range}" font-size="11.5" font-family="Inter,sans-serif">ex-dividend</text>`;

  const coneLegendX = hasCrossing && !legendStacked ? left + legendGap : left,
    coneLegendY = legendStacked ? legendY + 19 : legendY;

  const strikeY = toY(strike).toFixed(1);
  const spotY = toY(spot).toFixed(1);

  svg.innerHTML = [
    zones,
    gridLines,
    exMarker,
    `<path d="${bandBetween("high2", "low2")}" fill="${INK.coneOuter}"/>`,
    `<path d="${bandBetween("high1", "low1")}" fill="${INK.coneInner}"/>`,
    `<path d="${lineThrough(cone, adverseKey)}" fill="none" stroke="${INK.range}" stroke-width=".9" stroke-dasharray="3 2.5" opacity=".75"/>`,
    `<line x1="${left}" y1="${strikeY}" x2="${right}" y2="${strikeY}" stroke="${INK.accent}" stroke-width="1" stroke-dasharray="5 3" opacity=".85"/>`,
    `<line x1="${left}" y1="${spotY}" x2="${right}" y2="${spotY}" stroke="${INK.text}" stroke-width=".9" opacity=".28"/>`,
    boundaryLines,
    criticalNow !== null
      ? `<circle cx="${left}" cy="${toY(criticalNow).toFixed(1)}" r="3.6" fill="${INK.flag}" stroke="${INK.panel}" stroke-width="1.5"/>`
      : "",
    `<circle cx="${left}" cy="${spotY}" r="3.6" fill="${INK.text}" stroke="${INK.panel}" stroke-width="1.5"/>`,
    meeting
      ? `<circle cx="${toX(meeting.day).toFixed(1)}" cy="${toY(meeting.level).toFixed(1)}" r="3" fill="${INK.panel}" stroke="${INK.accent}" stroke-width="1.6"/>` +
        `<text x="${toX(meeting.day).toFixed(1)}" y="${(toY(meeting.level) - 10).toFixed(1)}" fill="${INK.accent}" font-size="11.5" font-family="Inter,sans-serif" text-anchor="middle">${isCall ? "+" : "\u2212"}1\u03C3 path meets S* \u00B7 day ${Math.round(meeting.day)}</text>`
      : "",
    axisLabels,
    `<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="${INK.axis}" stroke-width="1"/>`,
    `<line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" stroke="${INK.axis}" stroke-width="1"/>`,
    timeLabels,
    `<g font-family="Inter,sans-serif" font-size="12" fill="${INK.range}">`,
    hasCrossing
      ? `<rect x="${left}" y="${legendY}" width="11" height="11" rx="2" fill="${INK.zoneSwatch}" stroke="${INK.flag}" stroke-width="1"/>` +
        `<text x="${left + 17}" y="${legendY + 10}">early exercise optimal</text>`
      : "",
    `<rect x="${coneLegendX}" y="${coneLegendY}" width="11" height="11" rx="2" fill="${INK.coneSwatch}" stroke="${INK.range}" stroke-width="1"/>`,
    `<text x="${coneLegendX + 17}" y="${coneLegendY + 10}">projected range \u00B7 1\u03C3 and 2\u03C3</text>`,
    "</g>",
  ].join("");

  const meetingNote = meeting
    ? " The marked crossing is where one typical path would meet S* — an illustration of timing, not a probability. The assignment probability above covers every path."
    : "";
  caption.innerHTML =
    criticalNow !== null
      ? "The critical price is <b>$" +
        criticalNow.toFixed(2) +
        "</b> today — " +
        (Math.abs((spot - criticalNow) / spot) * 100).toFixed(1) +
        "% " +
        (isCall ? "over" : "under") +
        " spot" +
        (sigmasAway !== null
          ? ", " + sigmasAway.toFixed(2) + "σ of the move still available"
          : "") +
        ". S* " +
        (isCall ? "falls" : "rises") +
        " toward the strike as expiration nears, because there is " +
        "progressively less extrinsic value standing between the two values, so the same stock price grows riskier " +
        "the longer the position is held." +
        (dividend
          ? " It jumps at the ex-dividend date, when the dividend comes off the stock price."
          : "") +
        meetingNote
      : later
        ? (isCall
            ? "A call is only worth exercising at the close before the stock goes ex-dividend on " +
              later.exLabel +
              ". The red mark is the price above which the holder would exercise then: <b>$" +
              later.price.toFixed(2) +
              "</b>. Every other day, holding is worth more."
            : "Until the stock goes ex-dividend on " +
              later.exLabel +
              ", the dividend still to come makes holding worth more at every price. After that, the critical price starts at <b>$" +
              later.price.toFixed(2) +
              "</b> and rises toward the strike.") + meetingNote
        : isCall && dividend
          ? "Even at the close before the stock goes ex-dividend, the dividend is too small to make exercising pay, so no critical price exists. Only assignment at expiration is in play."
          : isCall
            ? "With no dividend there is nothing to capture by exercising early, so continuation value never falls to exercise value and no critical price exists. Only assignment at expiration is in play."
            : "At a " +
              (rate * 100).toFixed(2) +
              "% rate there is no interest to earn by taking the strike early, so continuation value never falls to exercise value and no critical price exists. Only assignment at expiration is in play.";
}
