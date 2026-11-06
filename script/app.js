/* Page controller: reads the inputs, runs the model, and writes every readout. */

import {
  exerciseValue,
  oppositeOptionValue,
  probabilityInTheMoney,
  priceAmerican,
  impliedVolatilityFrom,
  findCriticalPrice,
  dividendValueAt,
} from "./model.js";
import { dollars, percent, wholeDollars } from "./format.js";
import { startSymbolTips } from "./glossary.js";
import { drawChart } from "./chart.js";
import { fetchChain } from "./chain.js";

const el = function (id) {
  return document.getElementById(id);
};

const INPUT_IDS = [
  "stockPrice",
  "strike",
  "expirationDate",
  "contracts",
  "optionMark",
  "riskFreeRate",
  "dividendAmount",
  "exDividendDate",
  "creditReceived",
];
const REQUIRED_IDS = ["stockPrice", "strike", "optionMark"];
/* Only the settings that carry over between positions; the contract itself is
   picked fresh each visit. */
const PERSISTED_IDS = ["contracts", "riskFreeRate"];
const STORAGE_KEY = "shortOptionAssignment.v3";
const SHARES_PER_CONTRACT = 100;
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
  window
    .matchMedia("(prefers-color-scheme: light)")
    .addEventListener("change", scheduleRecalculation);
}

function saveInputs() {
  try {
    const saved = { call: isCall };
    PERSISTED_IDS.forEach(function (id) {
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
      PERSISTED_IDS.forEach(function (id) {
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
  el("markLabel").textContent = (isCall ? "Call" : "Put") + " Mark";
}

/* A put and a call are different contracts, so switching type starts the
   position over rather than carrying the other contract's quote across. */
function switchContractType(toCall) {
  if (toCall === isCall) return;
  isCall = toCall;
  paintContractType();
  el("ticker").value = "";
  loadTicker();
}

el("choosePut").addEventListener("click", function () {
  switchContractType(false);
});
el("chooseCall").addEventListener("click", function () {
  switchContractType(true);
});

/* ---------------------------------------------------------------- chain ---- */

/* With a chain loaded, the expiration and strike come from its dropdowns and fill
   the stock price and mark. Without one, the same fields are typed in by hand. */
let chain = null;
let manualEntry = false;
/* The ticker last sent for loading, so a typed and then committed symbol loads once. */
let requestedSymbol = "";
/* Results wait for Submit, then follow later edits until the position starts over. */
let submitted = false;
/* The fields describing one position, cleared whenever it starts over. */
const CONTRACT_IDS = [
  "stockPrice",
  "strike",
  "expirationDate",
  "optionMark",
  "creditReceived",
  "dividendAmount",
  "exDividendDate",
];

function tickerSymbol() {
  return el("ticker").value.trim().toUpperCase();
}

function setManualEntry(manual) {
  manualEntry = manual;
  el("position").classList.toggle("manual", manual);
  if (manual) el("moreDetails").open = true;
}

function fillChoices(id, placeholder, values, labelFor = String) {
  const select = el(id);
  select.replaceChildren(new Option(placeholder, ""));
  values.forEach(function (value) {
    select.add(new Option(labelFor(value), value));
  });
  select.disabled = values.length === 0;
}

async function loadTicker() {
  const symbol = tickerSymbol();
  requestedSymbol = symbol;
  chain = null;
  submitted = false;
  setManualEntry(false);
  CONTRACT_IDS.forEach(function (id) {
    el(id).value = "";
  });
  fillChoices("expiry", "—", []);
  fillChoices("strikeChoice", "—", []);
  el("chainStatus").textContent = symbol ? "Loading " + symbol + "…" : "";
  scheduleRecalculation();
  if (!symbol) return;
  try {
    const loaded = await fetchChain(symbol);
    if (tickerSymbol() !== symbol) return;
    chain = loaded;
    const expiries = [...new Set(loaded.contracts.map((contract) => contract.expiry))].sort();
    fillChoices("expiry", "Select", expiries, readableDate);
    el("chainStatus").textContent = "";
  } catch (error) {
    if (tickerSymbol() !== symbol) return;
    setManualEntry(true);
    el("chainStatus").textContent =
      "No option chain found for " + symbol + ". Enter the contract details by hand.";
  }
  scheduleRecalculation();
}

/* Starts on the strike nearest the stock price, so the list opens centred on the
   money, unless the new expiration also lists the strike already chosen. */
function fillStrikes() {
  const previous = Number(el("strikeChoice").value);
  const expiry = el("expiry").value;
  const strikes = chain.contracts
    .filter((contract) => contract.expiry === expiry)
    .map((contract) => contract.strike);
  const choices = [...new Set(strikes)].sort((a, b) => a - b);
  fillChoices("strikeChoice", "Select", choices);
  if (!choices.length) return scheduleRecalculation();
  const nearest = choices.reduce(function (best, strike) {
    return Math.abs(strike - chain.spot) < Math.abs(best - chain.spot) ? strike : best;
  });
  el("strikeChoice").value = String(choices.includes(previous) ? previous : nearest);
  applyChainContract();
}

function readableDate(isoDate) {
  return new Date(isoDate + "T00:00").toLocaleDateString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/* "Nov 6th, 2026", for reading the contract as a sentence. Non-breaking spaces
   keep the date on one line when the sentence wraps. */
function ordinalDate(isoDate) {
  const day = Number(isoDate.slice(8, 10));
  const suffix = [11, 12, 13].includes(day % 100)
    ? "th"
    : { 1: "st", 2: "nd", 3: "rd" }[day % 10] || "th";
  const month = new Date(isoDate + "T00:00").toLocaleDateString([], { month: "short" });
  return month + " " + day + suffix + ", " + isoDate.slice(0, 4);
}

/* Fractional days until the 4 PM New York close on the expiration date, when the
   option stops trading, so a same-day expiration still has its hours left. */
function daysUntil(expiry) {
  if (!expiry) return NaN;
  const closeAsUtc = new Date(expiry + "T16:00:00Z");
  const newYorkOffset = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  })
    .formatToParts(closeAsUtc)
    .find((part) => part.type === "timeZoneName").value; /* e.g. "GMT-4" */
  const offsetHours = Number(newYorkOffset.slice(3));
  return (closeAsUtc.getTime() - offsetHours * 3600000 - Date.now()) / 86400000;
}

function timeLeftLabel(days) {
  if (!(days > 0)) return "";
  return days < 1 ? (days * 24).toFixed(1) + " hours" : days.toFixed(1) + " days";
}

function applyChainContract() {
  const expiry = el("expiry").value,
    strike = Number(el("strikeChoice").value);
  const contract = chain.contracts.find(function (candidate) {
    return (
      candidate.expiry === expiry && candidate.strike === strike && candidate.isCall === isCall
    );
  });
  if (!contract) return;
  el("stockPrice").value = chain.spot.toFixed(2);
  el("strike").value = String(strike);
  el("expirationDate").value = expiry;
  el("optionMark").value = contract.mark === null ? "" : contract.mark.toFixed(2);
  el("chainStatus").textContent =
    contract.mark === null
      ? "CBOE has no quote for this contract. Enter the mark by hand."
      : "";
  if (contract.mark === null) el("moreDetails").open = true;
  recalculate();
}

function contractChosen() {
  return tickerSymbol() !== "" && (manualEntry || el("strikeChoice").value !== "");
}

/* What is still needed before the results show, or "" once nothing is. */
function pendingStep() {
  if (!tickerSymbol()) return "Enter a ticker to begin.";
  if (!contractChosen()) return "Choose an expiration and strike.";
  return submitted ? "" : "Submit to see the assignment risk.";
}

function signed(value) {
  return (value < 0 ? "−" : "+") + Math.abs(value).toFixed(2);
}

function paintQuote(spot, strike, days, mark, vol, lots) {
  el("quoteSymbol").textContent = tickerSymbol();
  el("quotePosition").textContent =
    lots +
    " × " +
    (Number.isInteger(strike) ? "$" + strike : dollars(strike)) +
    (isCall ? " Call" : " Put") +
    " expiring on " +
    ordinalDate(el("expirationDate").value);
  el("quotePrice").textContent = dollars(spot);
  el("quoteChange").textContent = chain
    ? signed(chain.change) + " (" + signed(chain.changePercent) + "%)"
    : "";
  el("quoteChange").classList.toggle("down", !!chain && chain.change < 0);
  el("quoteTimeLeft").textContent = timeLeftLabel(days);
  el("quoteMark").textContent = dollars(mark);
  el("quoteVol").textContent = vol === null ? "—" : percent(vol);
  el("quoteNote").textContent = chain
    ? "CBOE delayed quote · " +
      chain.quoteTime.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "Entered by hand";
}

/* Most tickers are four letters or fewer, so four typed letters load straight
   away; anything else loads on Enter or leaving the field. */
el("ticker").addEventListener("input", function () {
  if (tickerSymbol().length === 4) loadTicker();
});
el("ticker").addEventListener("change", function () {
  if (tickerSymbol() !== requestedSymbol) loadTicker();
});
el("submit").addEventListener("click", function () {
  submitted = true;
  recalculate();
  if (!el("results").hidden) el("results").scrollIntoView({ behavior: "smooth" });
});
el("expiry").addEventListener("change", fillStrikes);
el("strikeChoice").addEventListener("change", applyChainContract);

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
  "breakEven",
  "maxLoss",
];

/* Results stay out of the page until there is something to show. Toggling the
   animation class off and back on restarts it, so they ease in on every reveal
   rather than only the first. */
function showResults(visible) {
  el("prompt").hidden = visible;
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

/* The weekday before an ISO date. Holders must own the shares at that close to
   collect a dividend, so that is when a call is exercised for it. Holidays aside. */
function previousWeekday(isoDate) {
  const date = new Date(isoDate + "T12:00:00Z");
  do date.setUTCDate(date.getUTCDate() - 1);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6);
  return date.toISOString().slice(0, 10);
}

/* The next dividend as the model takes it, { amount, years, exDate }, or null when
   none is entered or it falls outside the option's life. */
function readDividend(spot, alerts) {
  const amount = numberFrom("dividendAmount"),
    exDate = el("exDividendDate").value,
    expiry = el("expirationDate").value;
  const hasAmount = el("dividendAmount").value.trim() !== "";
  el("dividendAmount").classList.toggle("invalid", hasAmount && !(amount > 0 && amount < spot));
  if (!hasAmount && !exDate) return null;
  if (!(amount > 0) || !exDate) {
    alerts.push("Enter both the dividend per share and its ex-dividend date to include it.");
    return null;
  }
  if (amount >= spot) {
    alerts.push("The dividend can't be larger than the stock price, so it is left out.");
    return null;
  }
  const days = daysUntil(previousWeekday(exDate));
  if (exDate > expiry || !(days > 0)) {
    alerts.push(
      exDate > expiry
        ? "The ex-dividend date falls after expiration, so the dividend doesn't affect this contract."
        : "The last day to own the shares for this dividend has passed, so it is left out.",
    );
    return null;
  }
  return { amount: amount, years: days / 365, exDate: exDate };
}

function recalculate() {
  const spot = numberFrom("stockPrice"),
    strike = numberFrom("strike"),
    days = daysUntil(el("expirationDate").value),
    mark = numberFrom("optionMark"),
    rate = readPercent("riskFreeRate"),
    lots = Math.max(1, Math.floor(numberFrom("contracts")) || 1);
  const alerts = [];

  el("submit").disabled = !contractChosen();
  const step = pendingStep();
  if (step) {
    el("prompt").textContent = step;
    showResults(false);
    showAlert([]);
    return;
  }

  /* Only flag what has been typed: a blank field is still waiting, not wrong. */
  REQUIRED_IDS.forEach(function (id) {
    const value = numberFrom(id);
    el(id).classList.toggle("invalid", el(id).value.trim() !== "" && !(value > 0));
  });
  el("expirationDate").classList.toggle(
    "invalid",
    el("expirationDate").value !== "" && !(days > 0),
  );
  el("daysLabel").textContent = timeLeftLabel(days);
  if (!(spot > 0 && strike > 0 && days > 0 && mark > 0)) {
    el("prompt").textContent = "Enter the expiration, strike, stock price and mark.";
    clearReadouts("Enter stock price, strike, a future expiration date and mark.");
    showResults(false);
    showAlert([]);
    return;
  }
  saveInputs();

  const years = days / 365;
  const contractWord = isCall ? "call" : "put";
  const dividend = readDividend(spot, alerts);
  const settledNow = exerciseValue(spot, strike, isCall);

  const vol = impliedVolatilityFrom(
    mark,
    spot,
    strike,
    years,
    rate,
    dividend,
    TREE_STEPS,
    isCall,
  );
  paintQuote(spot, strike, days, mark, vol, lots);
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
        "With the mark at exercise value, the model treats assignment as near certain.",
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
        `No implied volatility solves to this mark as a ${contractWord}. This happens when the stock price, strike, expiration and mark come from different quotes, or the option type doesn't match.`,
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

  const american = priceAmerican(spot, strike, years, rate, dividend, vol, TREE_STEPS, isCall);
  const continuationNow = american.continuation;
  const assignmentProbability = Math.min(1, Math.max(0, american.assignmentProbability));
  const criticalPrice = findCriticalPrice(
    strike,
    years,
    rate,
    dividend,
    vol,
    CRITICAL_STEPS,
    isCall,
  );
  const moneyness = probabilityInTheMoney(spot, strike, years, rate, dividend, vol, isCall);
  const extrinsic = continuationNow - settledNow;

  /* The early-exercise ledger, from put-call parity. A put's reward is the interest
     on the strike it receives early; a call's is the dividend it captures. Each
     forfeits the opposite option, and each pays the other's reward as a charge. */
  const strikeInterest = strike * (1 - Math.exp(-rate * years));
  const dividends = dividendValueAt(dividend, rate, 0);
  const forfeited = oppositeOptionValue(spot, strike, years, rate, dividend, vol, isCall);
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

  /* With a dividend ahead, the exercise decision can move to the ex-date. A call is
     only worth exercising at the close before it goes ex, and a put the dividend
     holds back becomes exercisable once it has. */
  let later = null;
  if (criticalPrice === null && dividend) {
    const price = isCall
      ? findCriticalPrice(
          strike,
          years - dividend.years,
          rate,
          { amount: dividend.amount, years: 1e-9 },
          vol,
          CRITICAL_STEPS,
          true,
        )
      : findCriticalPrice(
          strike,
          years - dividend.years,
          rate,
          null,
          vol,
          CRITICAL_STEPS,
          false,
        );
    if (price !== null) {
      const laterDays = dividend.years * 365;
      const past = isCall ? spot >= price : spot <= price;
      const sigma = vol * Math.sqrt(dividend.years);
      later = {
        price: price,
        exLabel: readableDate(dividend.exDate),
        roundedDays: laterDays < 1 ? "1" : String(Math.round(laterDays)),
        oneSigma: sigma,
        past: past,
        sigmas: past ? 0 : Math.abs(Math.log(spot / price)) / sigma,
      };
    }
  }

  const shares = SHARES_PER_CONTRACT * lots;
  const settlementTotal = strike * shares;

  /* Optional: what the seller banked up front. It sets the effective price the
     shares change hands at, and the position's mark-to-intrinsic result if the
     contract were assigned at today's spot. Out of the money that reduces to
     keeping the whole credit, which is correct: nothing would be assigned. */
  const credit = numberFrom("creditReceived");
  const hasCredit = Number.isFinite(credit) && credit > 0;
  /* Entered per share, the same convention as the option mark above. */
  const effectivePrice = hasCredit ? (isCall ? strike + credit : strike - credit) : null;
  const assignedNow = hasCredit ? (credit - settledNow) * shares : null;
  const incentiveTotal = netAdvantage * shares;
  const canExercise = settledNow > 0;
  /* Taken from the tree rather than the parity ledger: the ledger weighs exercising
     against holding to expiration, so it can't see that a call is better exercised
     at the ex-date than today. */
  const exerciseIsLive = canExercise && settledNow > continuationNow + strike * 1e-9;
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
    hasCredit: hasCredit,
    credit: credit,
    effectivePrice: effectivePrice,
    assignedNow: assignedNow,
    canExercise: canExercise,
    exerciseIsLive: exerciseIsLive,
    delta: american.delta,
    dividend: dividend,
    later: later,
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
    dividend,
    vol,
    criticalPrice,
    days,
    sigmasAway,
    later,
  );
}

/* --------------------------------------------------------------- display ---- */

function paintReadouts(data) {
  const side = isCall ? "above" : "below";
  const move = isCall ? "rise" : "fall";

  if (data.criticalPrice === null && data.later) {
    const later = data.later;
    const gap = ((Math.abs(data.spot - later.price) / data.spot) * 100).toFixed(1);
    const reach = later.past
      ? "where the stock already is"
      : `a ${move} of <strong>${gap}%</strong>`;
    paintTile(
      "critical",
      "$" + later.price.toFixed(2),
      later.past ? "alert" : "",
      isCall
        ? `Exercising only pays at the close before the stock goes ex-dividend on ${later.exLabel}. The holder would exercise then if the stock is above <strong>$${later.price.toFixed(2)}</strong>, ${reach}.`
        : `The dividend makes holding worth more until the stock goes ex on ${later.exLabel}. After that, exercising beats holding below <strong>$${later.price.toFixed(2)}</strong>, ${reach}.`,
    );
  } else if (data.criticalPrice === null) {
    paintTile(
      "critical",
      "None",
      "calm",
      isCall
        ? data.dividend
          ? "Even at the close before it goes ex, the dividend is too small to make exercising pay at any stock price."
          : "There is no dividend to capture, so no stock price makes exercising worthwhile. An American call on a non-dividend stock is never exercised early."
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
      data.exerciseIsLive ? "alert" : data.netAdvantage > 0 ? "watch" : "calm",
      data.netAdvantage <= 0
        ? `Exercising today costs the holder <strong>${dollars(-data.netAdvantage)}</strong> a share in forfeited value.`
        : data.exerciseIsLive
          ? `Exercising is worth <strong>${dollars(data.netAdvantage)}</strong> a share to the holder, or <strong>${wholeDollars(data.incentiveTotal)}</strong> across your ${data.lots} contract${data.lots === 1 ? "" : "s"}.`
          : `Exercising today beats holding to expiration by <strong>${dollars(data.netAdvantage)}</strong> a share, but waiting until the ex-dividend date is worth more still.`,
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

  if (data.criticalPrice === null && data.later) {
    paintLaterRiskTile(data, swing);
  } else if (data.criticalPrice === null) {
    paintTile(
      "risk",
      "None",
      "calm",
      isCall
        ? data.dividend
          ? "The dividend is too small to make exercising early worth more than holding."
          : "There is no dividend to capture, so exercising early is never worth more than holding."
        : "There is no interest to capture, so exercising early is never worth more than holding.",
    );
  } else if (data.exerciseIsLive) {
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

/* The risk tile when the decision sits at the ex-date: the same bands, measured
   by the typical move between now and then. */
function paintLaterRiskTile(data, swing) {
  const later = data.later;
  const typicalMove = dollars(data.spot * later.oneSigma);
  const when = isCall ? "just before it goes ex-dividend" : "once it has gone ex-dividend";
  const distance = ` A typical ${later.roundedDays}-day move to the ex-dividend date is <strong>${typicalMove}</strong>. Reaching that price takes a ${swing} of ${later.sigmas.toFixed(1)}× that.`;
  if (later.past) {
    paintTile(
      "risk",
      "High",
      "alert",
      `The stock is already past the price where exercising pays ${when} on ${later.exLabel}. At that price, the model has the holder exercising then.`,
    );
  } else if (later.sigmas < 1.0) {
    paintTile(
      "risk",
      "High",
      "alert",
      `The ex-dividend critical price is within one typical move.${distance}`,
    );
  } else if (later.sigmas < 1.75) {
    paintTile(
      "risk",
      "Elevated",
      "watch",
      `The ex-dividend critical price is within two typical moves.${distance}`,
    );
  } else if (later.sigmas < 2.75) {
    paintTile(
      "risk",
      "Low",
      "calm",
      `The ex-dividend critical price is more than two typical moves away.${distance}`,
    );
  } else {
    paintTile(
      "risk",
      "Minimal",
      "calm",
      `The ex-dividend critical price is more than three typical moves away.${distance}`,
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
    el("crossoverCaption").innerHTML =
      data.dividend && (isCall || data.rate > 0)
        ? isCall
          ? "Today continuation value stays above exercise value at every stock price: a holder after the dividend does better waiting for the close before the ex-date than exercising now. " +
            (data.later
              ? "At that close, exercising pays above <b>$" +
                data.later.price.toFixed(2) +
                "</b>."
              : "Even then the dividend is too small to make exercising pay.")
          : "The dividend still to come outweighs the interest on the strike, so continuation value stays above exercise value at every stock price until the stock goes ex. " +
            (data.later
              ? "After that, exercising pays below <b>$" + data.later.price.toFixed(2) + "</b>."
              : "")
        : isCall
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

  el("breakEvenRow").style.display = data.hasCredit ? "" : "none";
  el("maxLossRow").style.display = data.hasCredit ? "" : "none";
  if (data.hasCredit) {
    el("breakEvenLabel").textContent = isCall
      ? "Effective sale price"
      : "Effective cost per share";
    el("breakEven").textContent = dollars(data.effectivePrice);
    el("maxLossLabel").textContent = "If assigned at today's price";
    el("maxLoss").textContent =
      (data.assignedNow >= 0 ? "+" : "−") + wholeDollars(Math.abs(data.assignedNow));
    el("maxLoss").style.color = data.assignedNow >= 0 ? "var(--positive)" : "var(--negative)";
  }

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
        : data.netAdvantage > 0
          ? "Exercising today beats holding to expiration, but waiting until the ex-dividend date is worth more to them. If exercised, you would " +
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
    (isCall ? "D · e^−rt" : "K · (1 − e^−rT)") +
    " · the gain from exercising</small>";
  el("forfeitLabel").innerHTML =
    "Corresponding " +
    (isCall ? "put" : "call") +
    " value<small>forfeited by exercising</small>";
  el("chargeLabel").innerHTML =
    (isCall ? "Interest on the strike" : "Dividends forgone") +
    "<small>" +
    (isCall ? "K · (1 − e^−rT) · paid early" : "D · e^−rt · also forfeited") +
    "</small>";
  el("chargeLine").style.display = data.charge > 0.0005 ? "" : "none";

  el("advantageFormula").textContent = isCall
    ? "dividends − (put + interest)"
    : "interest − (call + dividends)";
  el("netAdvantage").textContent = dollars(data.netAdvantage);
  el("netAdvantage").style.color =
    data.netAdvantage > 0 ? "var(--negative)" : "var(--positive)";
  el("netAdvantageNote").textContent = data.exerciseIsLive
    ? "exercise optimal"
    : data.netAdvantage > 0
      ? "better at the ex-date"
      : "holding optimal";

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
    "The natural log of the stock price, less today's value of any dividend still to come, " +
    "divided by the strike, plus the rate less half the variance, all multiplied by the years " +
    "to expiration, then divided by the volatility times the square root of the years to expiration.";
  el("treeReading").textContent =
    "The up factor is the growth factor raised to the volatility times the square root of one " +
    "step's length. The down factor is one divided by the up factor. The up probability is the " +
    "growth factor raised to the rate times one step's length, minus the down factor, all " +
    "divided by the up factor minus the down factor. Any dividend still to come is added back " +
    "to each node's price until the ex-date.";
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

/* There is room for everything on the widest layout, so the dropdowns start open
   there; smaller screens keep them collapsed. The symbol glossary stays closed
   everywhere. Matches the 1060px breakpoint in styles.css. */
if (window.matchMedia("(min-width: 1060px)").matches)
  for (const dropdown of document.querySelectorAll("details:not(.lede-glossary)"))
    dropdown.open = true;

annotateAfterRepaint = startSymbolTips();

restoreInputs();
recalculate();
