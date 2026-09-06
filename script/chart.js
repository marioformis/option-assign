/* The critical price over the life of the option, drawn against the stock's
   projected range. */

import { findCriticalPrice } from "./model.js";

const CHART_STEPS = 110;

const INK = {
  grid: "#302D2A",
  axis: "#454039",
  faint: "#6F695F",
  text: "#F2EFE9",
  accent: "#D9A552",
  flag: "#D96A56",
  range: "#A49D93",
  panel: "#1B1917",
};

export function drawChart(
  isCall,
  spot,
  strike,
  years,
  rate,
  yield_,
  vol,
  criticalNow,
  days,
  sigmasAway,
) {
  const svg = document.getElementById("chart"),
    caption = document.getElementById("chartCaption");
  const hasCrossing = criticalNow !== null;
  const fractions = [
    0, 0.06, 0.13, 0.21, 0.29, 0.38, 0.47, 0.56, 0.65, 0.73, 0.81, 0.88, 0.94, 0.98, 1,
  ];

  /* Matching the viewBox to the element's pixel width keeps one user unit at one
     CSS pixel, so the type stays true size at any column width. */
  const width = Math.max(320, Math.round(svg.clientWidth || 680));
  const height = Math.round(Math.max(250, Math.min(430, width * 0.55)));
  svg.setAttribute("viewBox", "0 0 " + width + " " + height);
  const left = 58,
    right = width - 10,
    top = 14,
    bottom = height - 56,
    legendY = height - 32;

  const boundary = hasCrossing
    ? fractions.map(function (fraction) {
        const elapsed = days * fraction,
          remaining = years - elapsed / 365;
        const level =
          remaining <= 1e-6
            ? strike
            : findCriticalPrice(strike, remaining, rate, yield_, vol, CHART_STEPS, isCall);
        return { day: elapsed, level: level === null ? strike : level };
      })
    : [];

  const cone = fractions.map(function (fraction) {
    const elapsed = (days * fraction) / 365;
    const spread = vol * Math.sqrt(elapsed),
      drift = (rate - yield_ - (vol * vol) / 2) * elapsed;
    return {
      day: days * fraction,
      low1: spot * Math.exp(drift - spread),
      high1: spot * Math.exp(drift + spread),
      low2: spot * Math.exp(drift - 2 * spread),
      high2: spot * Math.exp(drift + 2 * spread),
    };
  });

  /* The range covers the cone, spot and strike. S* joins them when it is close
     enough to be worth showing; a boundary far out of reach is clamped instead, so
     it enters from the edge as it converges rather than flattening everything else. */
  const edge = cone[cone.length - 1];
  let lowest = Math.min(edge.low2, spot, strike),
    highest = Math.max(edge.high2, spot, strike);
  if (hasCrossing) {
    if (isCall) highest = Math.max(highest, Math.min(boundary[0].level, highest * 1.8));
    else lowest = Math.min(lowest, Math.max(boundary[0].level, lowest * 0.55));
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
    for (let i = 1; i < fractions.length; i++) {
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
  if (hasCrossing)
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
    if (markers[i].y - markers[i - 1].y < 13) markers[i].y = markers[i - 1].y + 13;
  }
  for (let i = markers.length - 1; i > 0; i--) {
    if (markers[i].y > bottom) markers[i].y = bottom;
    if (markers[i].y - markers[i - 1].y < 13) markers[i - 1].y = markers[i].y - 13;
  }
  const axisLabels = markers
    .map((marker) => {
      const y = toY(marker.price).toFixed(1);
      return (
        `<line x1="${left - 5}" y1="${y}" x2="${left}" y2="${y}" stroke="${marker.colour}" stroke-width="1.5"/>` +
        `<text x="${left - 9}" y="${(marker.y + 2.5).toFixed(1)}" fill="${marker.colour}" font-size="10" font-weight="${marker.weight}" font-family="JetBrains Mono,monospace" text-anchor="end">${priceLabel(marker.price)}</text>` +
        `<text x="${left - 9}" y="${(marker.y + 11).toFixed(1)}" fill="${INK.faint}" font-size="7.5" letter-spacing=".08em" font-family="Inter,sans-serif" text-anchor="end">${marker.name}</text>`
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
      return `<text x="${toX(day).toFixed(1)}" y="${bottom + 15}" fill="${INK.faint}" font-size="9" font-family="JetBrains Mono,monospace" text-anchor="${anchor}">${label}</text>`;
    })
    .join("");

  const boundaryPath = hasCrossing ? lineThrough(boundary, "level") : "";
  const regionEdge = isCall ? top : bottom;

  const strikeY = toY(strike).toFixed(1);
  const spotY = toY(spot).toFixed(1);
  const legendGap = hasCrossing ? 142 : 0;

  svg.innerHTML = [
    hasCrossing
      ? `<path d="${boundaryPath} L${toX(days).toFixed(1)} ${regionEdge} L${left} ${regionEdge} Z" fill="rgba(217,106,86,.13)"/>`
      : "",
    gridLines,
    `<path d="${bandBetween("high2", "low2")}" fill="rgba(164,157,147,.09)"/>`,
    `<path d="${bandBetween("high1", "low1")}" fill="rgba(164,157,147,.15)"/>`,
    `<path d="${lineThrough(cone, adverseKey)}" fill="none" stroke="${INK.range}" stroke-width=".9" stroke-dasharray="3 2.5" opacity=".75"/>`,
    `<line x1="${left}" y1="${strikeY}" x2="${right}" y2="${strikeY}" stroke="${INK.accent}" stroke-width="1" stroke-dasharray="5 3" opacity=".85"/>`,
    `<line x1="${left}" y1="${spotY}" x2="${right}" y2="${spotY}" stroke="${INK.text}" stroke-width=".9" opacity=".28"/>`,
    hasCrossing
      ? `<path d="${boundaryPath}" fill="none" stroke="${INK.flag}" stroke-width="2.2" stroke-linejoin="round"/>`
      : "",
    hasCrossing
      ? `<circle cx="${left}" cy="${toY(criticalNow).toFixed(1)}" r="3.6" fill="${INK.flag}" stroke="${INK.panel}" stroke-width="1.5"/>`
      : "",
    `<circle cx="${left}" cy="${spotY}" r="3.6" fill="${INK.text}" stroke="${INK.panel}" stroke-width="1.5"/>`,
    meeting
      ? `<circle cx="${toX(meeting.day).toFixed(1)}" cy="${toY(meeting.level).toFixed(1)}" r="3" fill="${INK.panel}" stroke="${INK.accent}" stroke-width="1.6"/>` +
        `<text x="${toX(meeting.day).toFixed(1)}" y="${(toY(meeting.level) - 9).toFixed(1)}" fill="${INK.accent}" font-size="8.5" font-family="Inter,sans-serif" text-anchor="middle">${isCall ? "+" : "\u2212"}1\u03C3 path meets S* \u00B7 day ${Math.round(meeting.day)}</text>`
      : "",
    axisLabels,
    `<line x1="${left}" y1="${bottom}" x2="${right}" y2="${bottom}" stroke="${INK.axis}" stroke-width="1"/>`,
    `<line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}" stroke="${INK.axis}" stroke-width="1"/>`,
    timeLabels,
    `<g font-family="Inter,sans-serif" font-size="9" fill="${INK.range}">`,
    hasCrossing
      ? `<rect x="${left}" y="${legendY}" width="9" height="9" rx="2" fill="rgba(217,106,86,.35)" stroke="${INK.flag}" stroke-width="1"/>` +
        `<text x="${left + 14}" y="${legendY + 8}">early exercise optimal</text>`
      : "",
    `<rect x="${left + legendGap}" y="${legendY}" width="9" height="9" rx="2" fill="rgba(164,157,147,.22)" stroke="${INK.range}" stroke-width="1"/>`,
    `<text x="${left + legendGap + 14}" y="${legendY + 8}">projected range \u00B7 1\u03C3 and 2\u03C3</text>`,
    "</g>",
  ].join("");

  caption.innerHTML = hasCrossing
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
      "the longer the position is held."
    : isCall
      ? "With no dividend there is nothing to capture by exercising early, so continuation value never falls to exercise value and no critical price exists. Only assignment at expiration is in play."
      : "At a " +
        (rate * 100).toFixed(2) +
        "% rate there is no interest to earn by taking the strike early, so continuation value never falls to exercise value and no critical price exists. Only assignment at expiration is in play.";
}
