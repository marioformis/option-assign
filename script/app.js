/* Page controller: reads the inputs, runs the model, and writes every readout. */

import {
  exerciseValue,
  oppositeOptionValue,
  probabilityInTheMoney,
  priceAmerican,
  impliedVolatilityFrom,
  findCriticalPrice,
} from "./model.js";
import { dollars, percent, wholeDollars } from "./format.js";
import { startSymbolTips } from "./glossary.js";
import { drawChart } from "./chart.js";

const el = function (id) {
  return document.getElementById(id);
};

const INPUT_IDS = [
  "stockPrice",
  "strike",
  "daysToExpiry",
  "contracts",
  "optionMark",
  "riskFreeRate",
  "dividendYield",
];
const REQUIRED_IDS = ["stockPrice", "strike", "daysToExpiry", "optionMark"];
const STORAGE_KEY = "shortOptionAssignment.v2";
const TREE_STEPS = 300;
const CRITICAL_STEPS = 140;

/* Inputs are plain text, so the browser no longer screens them. parseFloat alone
   is too permissive here — it reads "11,38" as 11 and "1.2.3" as 1.2, turning a
   typo into a plausible wrong answer. Accept a pasted currency symbol and
   thousands separators, then require what remains to be a complete number. */
const NUMERIC_TEXT = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;
const numberFrom = function (id) {
  const cleaned = el(id)
    .value.trim()
    .replace(/[$\s]/g, "")
    .replace(/,(?=\d{3}\b)/g, "");
  if (!NUMERIC_TEXT.test(cleaned)) return NaN;
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : NaN;
};

/* Standard normal CDF. Abramowitz & Stegun 26.2.17, absolute error under 7.5e-8. */
/* ---------------------------------------------------------------- state ---- */

let isCall = false;
let pendingFrame = 0;
/* Set once the glossary is ready; re-marks symbols after each repaint. */
let annotateAfterRepaint = null;

function scheduleRecalculation() {
  if (pendingFrame) return;
  pendingFrame = requestAnimationFrame(function () {
    pendingFrame = 0;
    recalculate();
  });
}

INPUT_IDS.forEach(function (id) {
  el(id).addEventListener("input", scheduleRecalculation);
  el(id).addEventListener("change", scheduleRecalculation);
});
if (typeof window !== "undefined") {
  window.addEventListener("resize", scheduleRecalculation);
  /* The chart paints its own colours, so a change of system theme needs a
     redraw; CSS handles the rest of the page on its own. */
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", scheduleRecalculation);
}

function saveInputs() {
  try {
    const saved = { call: isCall };
    INPUT_IDS.forEach(function (id) {
      saved[id] = el(id).value;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch (error) {
    /* private mode or blocked storage: inputs simply will not persist */
  }
}

function restoreInputs() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved) {
      INPUT_IDS.forEach(function (id) {
        if (typeof saved[id] === "string" && saved[id] !== "") el(id).value = saved[id];
      });
      isCall = !!saved.call;
    }
  } catch (error) {
    /* ignore malformed storage */
  }
  paintContractType();
}

function paintContractType() {
  el("choosePut").classList.toggle("selected", !isCall);
  el("chooseCall").classList.toggle("selected", isCall);
  el("choosePut").setAttribute("aria-pressed", String(!isCall));
  el("chooseCall").setAttribute("aria-pressed", String(isCall));
  el("contractLabel").textContent = isCall ? "Short Call" : "Short Put";
  el("markLabel").innerHTML =
    (isCall ? "Call" : "Put") + ' mark <span class="unit">bid-ask midpoint</span>';
}

/* Switching type re-prices the mark to the other contract at the current implied
   volatility, so the toggle lands on a live quote rather than an unsolvable one.
   It is a starting point the user overwrites with their own. */
function switchContractType(toCall) {
  if (toCall === isCall) return;
  const spot = numberFrom("stockPrice"),
    strike = numberFrom("strike"),
    days = numberFrom("daysToExpiry"),
    mark = numberFrom("optionMark"),
    rate = readPercent("riskFreeRate"),
    yield_ = Math.max(0, readPercent("dividendYield"));
  if (
    [spot, strike, days, mark].every(Number.isFinite) &&
    spot > 0 &&
    strike > 0 &&
    days > 0 &&
    mark > 0
  ) {
    const years = days / 365;
    const vol = impliedVolatilityFrom(mark, spot, strike, years, rate, yield_, 200, isCall);
    if (vol !== null) {
      const repriced = priceAmerican(spot, strike, years, rate, yield_, vol, 200, toCall).price;
      if (repriced > 0.005) el("optionMark").value = repriced.toFixed(2);
    }
  }
  isCall = toCall;
  paintContractType();
  recalculate();
}

el("choosePut").addEventListener("click", function () {
  switchContractType(false);
});
el("chooseCall").addEventListener("click", function () {
  switchContractType(true);
});

function readPercent(id) {
  const value = numberFrom(id);
  return (Number.isFinite(value) ? value : 0) / 100;
}

/* Tiles share one accent scale, so the value colour and the card's left rule can
   never drift apart. */
const TILE_COLOURS = {
  alert: "var(--negative)",
  watch: "var(--caution)",
  calm: "var(--positive)",
  "": "var(--text)",
};
const TILE_IDS = ["critical", "incentive", "assignment", "risk"];

/* Two of these live in the tile row and two inside the exercise card, so the tone
   class is swapped without disturbing whichever base class the element carries. */
const TONES = ["alert", "watch", "calm"];

function paintTile(name, value, tone, detail) {
  const valueNode = el(name + "Value");
  valueNode.textContent = value;
  valueNode.style.color = TILE_COLOURS[tone];
  const container = el(name + "Tile");
  TONES.forEach(function (other) {
    container.classList.remove(other);
  });
  if (tone) container.classList.add(tone);
  if (detail !== undefined) el(name + "Detail").innerHTML = detail;
}

function toneFor(value, alertAbove, watchAbove) {
  return value >= alertAbove ? "alert" : value >= watchAbove ? "watch" : "calm";
}

const CLEARED_FIELDS = [
  "distanceSigma",
  "distanceScale",
  "extrinsicValue",
  "extrinsicTotal",
  "rewardValue",
  "rewardTotal",
  "forfeitValue",
  "forfeitTotal",
  "chargeValue",
  "chargeTotal",
  "netAdvantage",
  "netAdvantageNote",
  "moneynessProbability",
  "settlementSize",
  "impliedVolatility",
  "deltaValue",
  "spotHeading",
  "exerciseNow",
  "continuationNow",
  "advantageNow",
  "criticalHeading",
  "exerciseCritical",
  "continuationCritical",
  "differenceCritical",
  "incentivePerShare",
  "incentiveTotal",
  "incentiveVerdict",
  "shareCount",
  "strikePrice",
  "settlementTotal",
];

/* Results stay out of the page until there is something to show. Toggling the
   animation class off and back on restarts it, so they ease in on every reveal
   rather than only the first. */
function showResults(visible) {
  const results = el("results");
  if (!visible) {
    results.hidden = true;
    results.classList.remove("revealed");
    return;
  }
  if (!results.hidden) return;
  results.hidden = false;
  results.classList.remove("revealed");
  void results.offsetWidth; /* forces the restart */
  results.classList.add("revealed");
}

function clearReadouts(message) {
  TILE_IDS.forEach(function (name) {
    paintTile(name, "—", "", "—");
  });
  el("criticalDetail").textContent = message;
  CLEARED_FIELDS.forEach(function (id) {
    el(id).textContent = "—";
  });
  el("chartAside").textContent = "—";
  el("chart").innerHTML = "";
  el("chartCaption").textContent = "—";
  el("crossoverCaption").textContent = "—";
  el("obligationCaption").textContent = "—";
}

function showAlert(messages) {
  const box = el("alertBox");
  if (messages.length) {
    box.textContent = messages.join(" ");
    box.style.display = "block";
  } else box.style.display = "none";
}

/* ----------------------------------------------------------- calculation ---- */

function recalculate() {
  const spot = numberFrom("stockPrice"),
    strike = numberFrom("strike"),
    days = numberFrom("daysToExpiry"),
    mark = numberFrom("optionMark"),
    rate = readPercent("riskFreeRate"),
    yield_ = Math.max(0, readPercent("dividendYield")),
    lots = Math.max(1, Math.floor(numberFrom("contracts")) || 1);
  const alerts = [];

  REQUIRED_IDS.forEach(function (id) {
    const value = numberFrom(id);
    el(id).classList.toggle("invalid", !(Number.isFinite(value) && value > 0));
  });
  if (!(spot > 0 && strike > 0 && days > 0 && mark > 0)) {
    clearReadouts("Enter stock price, strike, days and mark.");
    showResults(false);
    showAlert([]);
    return;
  }
  saveInputs();

  const years = days / 365;
  const contractWord = isCall ? "call" : "put";
  const settledNow = exerciseValue(spot, strike, isCall);

  const vol = impliedVolatilityFrom(
    mark,
    spot,
    strike,
    years,
    rate,
    yield_,
    TREE_STEPS,
    isCall,
  );
  if (vol === null) {
    const atFloor = mark <= settledNow + 1e-9;
    clearReadouts(
      atFloor
        ? "The quote is already at its exercise value."
        : "No volatility solves to this mark.",
    );
    if (atFloor) {
      paintTile(
        "critical",
        "At spot",
        "alert",
        "The two values have already met, so exercising is live for the holder right now.",
      );
      paintTile(
        "incentive",
        "live",
        "alert",
        "There is no extrinsic value left for the holder to give up by exercising.",
      );
      paintTile(
        "assignment",
        "~100%",
        "alert",
        "With the mark at exercise value, assume this contract is assigned.",
      );
      paintTile(
        "risk",
        "Optimal now",
        "alert",
        "Exercise value has caught continuation value.",
      );
      alerts.push(
        `The mark is at or below the exercise value (${isCall ? "stock − strike" : "strike − stock"}). Either the quote is stale or crossed, or this contract is already a live early-exercise candidate.`,
      );
    } else {
      alerts.push(
        `No implied volatility solves to this mark as a ${contractWord}. Check that the stock price, strike, days and mark all come from the same quote, and that the option type matches.`,
      );
    }
    el("chartCaption").textContent =
      "Implied volatility could not be solved, so the chart is unavailable.";
    /* Both branches have something to report — filled tiles in one case, an
       explanation of the bad quote in the other — so the results stay visible. */
    showResults(true);
    showAlert(alerts);
    return;
  }

  const american = priceAmerican(spot, strike, years, rate, yield_, vol, TREE_STEPS, isCall);
  const continuationNow = american.continuation;
  const assignmentProbability = Math.min(1, Math.max(0, american.assignmentProbability));
  const criticalPrice = findCriticalPrice(
    strike,
    years,
    rate,
    yield_,
    vol,
    CRITICAL_STEPS,
    isCall,
  );
  const moneyness = probabilityInTheMoney(spot, strike, years, rate, yield_, vol, isCall);
  const extrinsic = continuationNow - settledNow;

  /* The early-exercise ledger, from put-call parity. A put's reward is the interest
     on the strike it receives early; a call's is the dividend it captures. Each
     forfeits the opposite option, and each pays the other's reward as a charge. */
  const strikeInterest = strike * (1 - Math.exp(-rate * years));
  const dividends = spot * (1 - Math.exp(-yield_ * years));
  const forfeited = oppositeOptionValue(spot, strike, years, rate, yield_, vol, isCall);
  const reward = isCall ? dividends : strikeInterest;
  const charge = isCall ? strikeInterest : dividends;
  const netAdvantage = reward - (forfeited + charge);

  const oneSigma = vol * Math.sqrt(years);
  const alreadyPast =
    criticalPrice !== null && (isCall ? spot >= criticalPrice : spot <= criticalPrice);
  const sigmasAway =
    criticalPrice !== null && !alreadyPast && oneSigma > 0
      ? Math.abs(Math.log(spot / criticalPrice)) / oneSigma
      : null;

  const shares = 100 * lots;
  const settlementTotal = strike * shares;
  const incentiveTotal = netAdvantage * shares;
  const canExercise = settledNow > 0;
  const exerciseIsLive = netAdvantage > 0 && canExercise;
  const dayWord = days === 1 ? "day" : "days";
  const roundedDays = Number.isInteger(days) ? String(days) : days.toFixed(1);

  paintReadouts({
    spot: spot,
    strike: strike,
    days: days,
    dayWord: dayWord,
    roundedDays: roundedDays,
    lots: lots,
    shares: shares,
    rate: rate,
    vol: vol,
    years: years,
    oneSigma: oneSigma,
    contractWord: contractWord,
    criticalPrice: criticalPrice,
    sigmasAway: sigmasAway,
    assignmentProbability: assignmentProbability,
    moneyness: moneyness,
    settledNow: settledNow,
    continuationNow: continuationNow,
    extrinsic: extrinsic,
    reward: reward,
    charge: charge,
    forfeited: forfeited,
    netAdvantage: netAdvantage,
    incentiveTotal: incentiveTotal,
    settlementTotal: settlementTotal,
    canExercise: canExercise,
    exerciseIsLive: exerciseIsLive,
    delta: american.delta,
  });

  if (!canExercise) {
    alerts.push(
      `The ${contractWord} is out of the money, so there is no exercise value to compare. The risk shown is the chance it finishes in the money.`,
    );
  }
  showAlert(alerts);

  showResults(true);
  paintDerivations();
  if (annotateAfterRepaint) annotateAfterRepaint();
  drawChart(
    isCall,
    spot,
    strike,
    years,
    rate,
    yield_,
    vol,
    criticalPrice,
    days,
    sigmasAway,
  );
}

/* --------------------------------------------------------------- display ---- */

function paintReadouts(data) {
  const side = isCall ? "above" : "below";
  const move = isCall ? "rise" : "fall";

  if (data.criticalPrice === null) {
    paintTile(
      "critical",
      "None",
      "calm",
      isCall
        ? "There is no dividend to capture, so no stock price makes exercising worthwhile. An American call on a non-dividend stock is never exercised early."
        : `At a ${(data.rate * 100).toFixed(2)}% rate there is no interest to earn on the strike, so the two values never cross at any price.`,
    );
  } else {
    const gap = ((Math.abs(data.spot - data.criticalPrice) / data.spot) * 100).toFixed(1);
    paintTile(
      "critical",
      "$" + data.criticalPrice.toFixed(2),
      data.exerciseIsLive ? "alert" : "",
      data.exerciseIsLive
        ? `The stock is already past this price with ${data.roundedDays} ${data.dayWord} left, so exercising today beats holding.`
        : `With ${data.roundedDays} ${data.dayWord} left, the stock would have to be at <strong>$${data.criticalPrice.toFixed(2)}</strong> today — a ${move} of <strong>${gap}%</strong> — for exercising to beat holding.`,
    );
  }

  if (!data.canExercise) {
    paintTile(
      "incentive",
      "n/a",
      "calm",
      "The contract is out of the money, so it has no exercise value to capture.",
    );
  } else {
    paintTile(
      "incentive",
      (data.netAdvantage > 0 ? "+" : "−") + wholeDollars(Math.abs(data.incentiveTotal)),
      data.netAdvantage > 0 ? "alert" : "calm",
      data.netAdvantage > 0
        ? `Exercising is worth <strong>${dollars(data.netAdvantage)}</strong> a share to the holder, or <strong>${wholeDollars(data.incentiveTotal)}</strong> across your ${data.lots} contract${data.lots === 1 ? "" : "s"}.`
        : `Exercising today costs the holder <strong>${dollars(-data.netAdvantage)}</strong> a share in forfeited value.`,
    );
  }

  paintTile(
    "assignment",
    percent(data.assignmentProbability),
    toneFor(data.assignmentProbability, 0.5, 0.2),
    `Chance you are assigned at some point, early or at expiration. Its mirror is a <strong>${percent(1 - data.assignmentProbability)}</strong> chance the contract expires worthless and you keep the premium.`,
  );

  paintRiskTile(data);

  el("chartAside").textContent = `IV ${(data.vol * 100).toFixed(1)}%  ·  ${data.roundedDays}d`;

  paintCrossover(data);
  paintObligation(data);
  paintBreakdown(data);
}

function paintRiskTile(data) {
  const swing = isCall ? "rally" : "drop";
  /* A distance in standard deviations means little on its own, so each band
     states the typical move in dollars and the multiple of it required. */
  const typicalMove = dollars(data.spot * data.oneSigma);
  const distance = function () {
    return ` A typical ${data.roundedDays}-day move for this stock is <strong>${typicalMove}</strong>. Reaching the critical price takes a ${swing} of ${data.sigmasAway.toFixed(1)}× that.`;
  };

  if (data.criticalPrice === null) {
    paintTile(
      "risk",
      "None",
      "calm",
      isCall
        ? "There is no dividend to capture, so exercising early is never worth more than holding."
        : "There is no interest to capture, so exercising early is never worth more than holding.",
    );
  } else if (data.netAdvantage > 0) {
    paintTile(
      "risk",
      "Optimal now",
      "alert",
      "Exercise value already exceeds continuation value, so exercising today is worth more than holding.",
    );
  } else if (data.sigmasAway < 1.0) {
    paintTile(
      "risk",
      "High",
      "alert",
      `The critical price is within one typical ${data.roundedDays}-day move of <strong>${typicalMove}</strong>.${distance()}`,
    );
  } else if (data.sigmasAway < 1.75) {
    paintTile(
      "risk",
      "Elevated",
      "watch",
      "The critical price is within two typical moves." + distance(),
    );
  } else if (data.sigmasAway < 2.75) {
    paintTile(
      "risk",
      "Low",
      "calm",
      "The critical price is more than two typical moves away." + distance(),
    );
  } else {
    paintTile(
      "risk",
      "Minimal",
      "calm",
      "The critical price is more than three typical moves away." + distance(),
    );
  }
}

function paintCrossover(data) {
  const lead = data.continuationNow - data.settledNow;
  el("spotHeading").textContent = "$" + data.spot.toFixed(2);
  el("exerciseNow").textContent = dollars(data.settledNow);
  el("continuationNow").textContent = dollars(data.continuationNow);
  el("advantageLabel").textContent =
    lead >= 0 ? "Holding is worth more by" : "Exercising is worth more by";
  el("advantageNow").textContent = dollars(Math.abs(lead));
  el("advantageNow").style.color = lead >= 0 ? "var(--positive)" : "var(--negative)";

  if (data.criticalPrice === null) {
    el("criticalHeading").textContent = "—";
    ["exerciseCritical", "continuationCritical", "differenceCritical"].forEach(function (id) {
      el(id).textContent = "—";
      el(id).style.color = "";
    });
    el("crossoverCaption").innerHTML = isCall
      ? "With no dividend there is nothing to capture by taking delivery early, so continuation value stays above exercise value at every stock price. The two never cross — Merton's result that an American call on a non-dividend stock is never exercised early. Only assignment at expiration is in play."
      : "At a " +
        (data.rate * 100).toFixed(2) +
        "% rate there is no interest to earn by taking the strike early, so continuation value stays above exercise value at every stock price. The two never cross, and only assignment at expiration is in play.";
    return;
  }

  /* At the critical price the two are equal by construction — that is what defines it. */
  const valueAtCrossing = exerciseValue(data.criticalPrice, data.strike, isCall);
  el("criticalHeading").textContent = "$" + data.criticalPrice.toFixed(2);
  el("exerciseCritical").textContent = dollars(valueAtCrossing);
  el("continuationCritical").textContent = dollars(valueAtCrossing);
  el("differenceCritical").textContent = "$0.00";
  el("differenceCritical").style.color = "var(--negative)";
  el("crossoverCaption").innerHTML =
    "Today the contract is worth more held than exercised: continuation value <b>" +
    dollars(data.continuationNow) +
    "</b> against an exercise value of <b>" +
    dollars(data.settledNow) +
    "</b>, a gap of <b>" +
    dollars(Math.abs(lead)) +
    "</b> — the extrinsic value. That gap narrows as the stock " +
    (isCall ? "rises" : "falls") +
    ", because a deeper " +
    "in-the-money " +
    data.contractWord +
    ' has less time value left to lose. At <span class="flag">$' +
    data.criticalPrice.toFixed(2) +
    "</span> the two lines cross and both are worth " +
    dollars(valueAtCrossing) +
    ". " +
    (isCall ? "Above" : "Below") +
    " that price exercise value is the larger of the two, so exercising " +
    "returns more than holding and you are assigned.";
}

function paintObligation(data) {
  const live = data.exerciseIsLive;
  el("incentivePerShare").textContent = data.canExercise ? dollars(data.netAdvantage) : "n/a";
  el("incentivePerShare").style.color = live ? "var(--negative)" : "var(--positive)";
  el("contractCountLabel").textContent =
    "All " + data.lots + " contract" + (data.lots === 1 ? "" : "s");
  el("incentiveTotal").textContent = data.canExercise
    ? (data.netAdvantage > 0 ? "+" : "−") + wholeDollars(Math.abs(data.incentiveTotal))
    : "n/a";
  el("incentiveTotal").style.color = live ? "var(--negative)" : "var(--positive)";
  el("incentiveVerdict").textContent = !data.canExercise
    ? "Not while OTM"
    : live
      ? "Yes — now"
      : "Not yet";
  el("incentiveVerdict").style.color = live ? "var(--negative)" : "var(--positive)";
  el("incentivePanel").className = "split-panel" + (live ? " flagged" : "");

  el("shareActionLabel").textContent = isCall ? "Shares to deliver" : "Shares to buy";
  el("shareCount").textContent = data.shares.toLocaleString("en-US");
  el("strikePrice").textContent = "$" + data.strike.toFixed(2);
  el("settlementLabel").textContent = isCall ? "Proceeds you receive" : "Amount you would pay";
  el("settlementTotal").textContent = wholeDollars(data.settlementTotal);

  const obligation =
    (isCall ? "deliver" : "buy") +
    " <b>" +
    data.shares.toLocaleString("en-US") +
    "</b> shares at $" +
    data.strike.toFixed(2) +
    ", worth <b>" +
    wholeDollars(data.settlementTotal) +
    "</b>";

  el("obligationCaption").innerHTML =
    "Only the buyer can choose to exercise. " +
    (!data.canExercise
      ? "The contract is out of the money, so exercising it returns nothing. If exercised, you would " +
        obligation +
        "."
      : live
        ? "Exercising gains them <b>" +
          dollars(data.netAdvantage) +
          "</b> per share, or <b>" +
          wholeDollars(data.incentiveTotal) +
          "</b> in total. If exercised, you would " +
          obligation +
          "."
        : "Exercising today costs them <b>" +
          dollars(-data.netAdvantage) +
          "</b> per share in forfeited value. If exercised, you would " +
          obligation +
          ".") +
    (data.canExercise && Math.abs(data.incentiveTotal) > 0.005
      ? " Their gain or loss from exercising is " +
        ((Math.abs(data.incentiveTotal) / data.settlementTotal) * 100).toFixed(2) +
        "% of that position's value."
      : "");
}

function paintBreakdown(data) {
  const perShare = function (id, value) {
    el(id + "Value").textContent = dollars(value);
    el(id + "Total").textContent = wholeDollars(value * data.shares) + " total";
  };

  el("distanceSigma").textContent =
    data.sigmasAway === null ? "—" : data.sigmasAway.toFixed(2) + "σ";
  el("distanceScale").textContent =
    "1σ ≈ " + dollars(data.spot * data.oneSigma) + " over " + data.roundedDays + "d";

  perShare("extrinsic", data.extrinsic);
  perShare("reward", data.reward);
  perShare("forfeit", data.forfeited);
  perShare("charge", data.charge);

  el("rewardLabel").innerHTML =
    (isCall ? "Dividends captured" : "Interest on strike proceeds") +
    "<small>" +
    (isCall ? "S · (1 − e^−qT)" : "K · (1 − e^−rT)") +
    " · the gain from exercising</small>";
  el("forfeitLabel").innerHTML =
    "Corresponding " +
    (isCall ? "put" : "call") +
    " value<small>forfeited by exercising</small>";
  el("chargeLabel").innerHTML =
    (isCall ? "Interest on the strike" : "Dividends forgone") +
    "<small>" +
    (isCall ? "K · (1 − e^−rT) · paid early" : "S · (1 − e^−qT) · also forfeited") +
    "</small>";
  el("chargeLine").style.display = data.charge > 0.0005 ? "" : "none";

  el("advantageFormula").textContent = isCall
    ? "dividends − (put + interest)"
    : "interest − (call + dividends)";
  el("netAdvantage").textContent = dollars(data.netAdvantage);
  el("netAdvantage").style.color =
    data.netAdvantage > 0 ? "var(--negative)" : "var(--positive)";
  el("netAdvantageNote").textContent =
    data.netAdvantage > 0 ? "exercise optimal" : "holding optimal";

  el("moneynessProbability").textContent = percent(data.moneyness);
  el("moneynessFormula").textContent =
    (isCall ? "N(d₂)" : "N(−d₂)") + " · your broker's “prob. ITM”";
  el("settlementSizeLabel").innerHTML =
    (isCall ? "Stock delivered if assigned" : "Capital required if assigned") +
    "<small>strike × 100 × contracts</small>";
  el("settlementSize").textContent = wholeDollars(data.settlementTotal);
  el("impliedVolatility").textContent = (data.vol * 100).toFixed(1) + "%";
  el("deltaValue").textContent = data.delta.toFixed(4);
}

/* Three of the four derivations differ by contract type. */
function paintDerivations() {
  const side = isCall ? "above" : "below";
  const contractWord = isCall ? "call" : "put";

  el("moneynessNotation").textContent = isCall ? "N(d₂)" : "N(−d₂)";
  el("moneynessNote").innerHTML =
    "The risk-neutral probability that the stock closes " +
    side +
    " the strike at expiration. This is the figure your broker labels “probability ITM.” It is " +
    "<em>not</em> delta: delta is " +
    (isCall ? "N(d₁)" : "N(−d₁)") +
    ", and since d₁ = d₂ + σ√T, delta always " +
    (isCall ? "overstates" : "understates") +
    " a " +
    contractWord +
    "'s chance of finishing in the money.";

  /* Each formula read aloud, with the symbols replaced by what they stand for. */
  el("moneynessReading").textContent =
    "The natural log of the stock price divided by the strike, plus the rate less the dividend " +
    "yield less half the variance, all multiplied by the years to expiration, then divided by " +
    "the volatility times the square root of the years to expiration.";
  el("treeReading").textContent =
    "The up factor is the growth factor raised to the volatility times the square root of one " +
    "step's length. The down factor is one divided by the up factor. The up probability is the " +
    "growth factor raised to the rate less the dividend yield times one step's length, minus the " +
    "down factor, all divided by the up factor minus the down factor.";
  el("criticalReading").textContent = isCall
    ? "The value of holding at the critical price equals the critical price minus the strike."
    : "The value of holding at the critical price equals the strike minus the critical price.";

  el("criticalFormula").textContent = "continuation(S*) = " + (isCall ? "S* − K" : "K − S*");
  el("criticalNote").innerHTML =
    "Found by bisecting the same tree for the stock price at which the option's " +
    "value falls to exactly its exercise value; the exercise region lies " +
    side +
    " it. Put-call parity gives " +
    "the identical condition in tradeable terms: exercise becomes optimal once " +
    (isCall
      ? "the dividend captured exceeds the corresponding put value plus the interest given up by paying the strike early."
      : "the interest on the strike proceeds exceeds the corresponding call value plus any dividends forgone.");
}

annotateAfterRepaint = startSymbolTips();

restoreInputs();
recalculate();
