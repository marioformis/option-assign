/* Option pricing and probability. Pure functions — no DOM, no formatting — so
   this module runs unchanged in the browser and under Node for the test suite. */

/* Standard normal CDF: P(Z <= x) for a standard normal variable Z.
   Abramowitz & Stegun, Handbook of Mathematical Functions (1964), formula
   26.2.17. Kept in that formula's own notation so it reads line-for-line
   against the source (max absolute error 7.5e-8):
     t    = 1 / (1 + p*x)
     Z(x) = (1/sqrt(2*pi)) * exp(-x^2/2)              the standard normal density
     P(x) = 1 - Z(x)*(b1*t + b2*t^2 + b3*t^3 + b4*t^4 + b5*t^5),   x >= 0
   For x < 0, P(x) = 1 - P(-x) by symmetry. */
export function normalCdf(x) {
  const p = 0.2316419;
  const b1 = 0.31938153,
    b2 = -0.356563782,
    b3 = 1.781477937,
    b4 = -1.821255978,
    b5 = 1.330274429;

  const absX = Math.abs(x);
  const t = 1 / (1 + p * absX);
  const Z = 0.39894228 * Math.exp((-absX * absX) / 2); // 1/sqrt(2*pi) * exp(-x^2/2)

  const upperTail = Z * (t * (t * (t * (t * (t * b5 + b4) + b3) + b2) + b1));

  return x >= 0 ? 1 - upperTail : upperTail;
}

export function exerciseValue(spot, strike, isCall) {
  return isCall ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
}

/* The European option of the opposite type — what the holder forfeits by exercising.
   Put-call parity makes this exactly the quantity the incentive weighs against. */
export function oppositeOptionValue(spot, strike, years, rate, yield_, vol, isCall) {
  if (years <= 0 || vol <= 0) return exerciseValue(spot, strike, !isCall);
  const spread = vol * Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate - yield_ + (vol * vol) / 2) * years) / spread,
    d2 = d1 - spread;
  return isCall
    ? strike * Math.exp(-rate * years) * normalCdf(-d2) -
        spot * Math.exp(-yield_ * years) * normalCdf(-d1)
    : spot * Math.exp(-yield_ * years) * normalCdf(d1) -
        strike * Math.exp(-rate * years) * normalCdf(d2);
}

/* Probability of finishing in the money: N(d2) for a call, N(-d2) for a put. */
export function probabilityInTheMoney(spot, strike, years, rate, yield_, vol, isCall) {
  if (years <= 0 || vol <= 0) return (isCall ? spot > strike : spot < strike) ? 1 : 0;
  const spread = vol * Math.sqrt(years);
  const d2 = (Math.log(spot / strike) + (rate - yield_ - (vol * vol) / 2) * years) / spread;
  return isCall ? normalCdf(d2) : normalCdf(-d2);
}

/* Cox-Ross-Rubinstein tree for an American option. One backward pass returns the
   price, the continuation value alone, the risk-neutral probability of assignment
   by either route, and delta from the two step-one nodes. */
export function priceAmerican(spot, strike, years, rate, yield_, vol, steps, isCall) {
  const isInTheMoney = function (price) {
    return isCall ? price > strike + 0.01 : price < strike - 0.01;
  };
  if (years <= 0 || vol <= 0) {
    const settled = exerciseValue(spot, strike, isCall);
    return {
      price: settled,
      continuation: settled,
      assignmentProbability: isInTheMoney(spot) ? 1 : 0,
      delta: isInTheMoney(spot) ? (isCall ? 1 : -1) : 0,
    };
  }

  const stepYears = years / steps;
  const up = Math.exp(vol * Math.sqrt(stepYears)),
    down = 1 / up,
    upSquared = up * up;
  const discount = Math.exp(-rate * stepYears);
  let upProbability = (Math.exp((rate - yield_) * stepYears) - down) / (up - down);
  if (!(upProbability > 0)) upProbability = 0;
  else if (upProbability > 1) upProbability = 1;
  const downProbability = 1 - upProbability;

  /* Exercise must beat holding by more than double-precision noise. Without this,
     nodes where the two are equal to the last bit — every deep in-the-money node
     when the rate is zero — latch the exercise flag and the probability recursion
     compounds the error. */
  const tolerance = strike * 1e-9;

  const value = new Float64Array(steps + 1);
  const assigned = new Float64Array(steps + 1);
  let price = spot * Math.pow(up, -steps);
  for (let i = 0; i <= steps; i++) {
    value[i] = exerciseValue(price, strike, isCall);
    assigned[i] = isInTheMoney(price) ? 1 : 0; /* OCC exercise-by-exception: $0.01 ITM */
    price *= upSquared;
  }

  let nodeUp = 0,
    nodeDown = 0;
  for (let step = steps - 1; step >= 0; step--) {
    let nodePrice = spot * Math.pow(up, -step);
    for (let i = 0; i <= step; i++) {
      const holding = discount * (upProbability * value[i + 1] + downProbability * value[i]);
      const exercising = isCall ? nodePrice - strike : strike - nodePrice;
      if (exercising > holding + tolerance) {
        value[i] = exercising;
        assigned[i] = 1;
      } else {
        value[i] = holding;
        assigned[i] = upProbability * assigned[i + 1] + downProbability * assigned[i];
      }
      nodePrice *= upSquared;
    }
    if (step === 1) {
      nodeDown = value[0];
      nodeUp = value[1];
    }
  }

  return {
    price: value[0],
    continuation: discount * (upProbability * nodeUp + downProbability * nodeDown),
    assignmentProbability: assigned[0],
    delta: (nodeUp - nodeDown) / (spot * up - spot * down),
  };
}

/* Implied volatility from the American mark. Null when the mark sits outside
   anything the model can produce. */
export function impliedVolatilityFrom(mark, spot, strike, years, rate, yield_, steps, isCall) {
  const floor = 0.005,
    ceiling = 5;
  if (priceAmerican(spot, strike, years, rate, yield_, floor, steps, isCall).price >= mark)
    return null;
  if (priceAmerican(spot, strike, years, rate, yield_, ceiling, steps, isCall).price <= mark)
    return null;
  let low = floor,
    high = ceiling;
  for (let i = 0; i < 46; i++) {
    const mid = (low + high) / 2;
    if (priceAmerican(spot, strike, years, rate, yield_, mid, steps, isCall).price > mark)
      high = mid;
    else low = mid;
  }
  return (low + high) / 2;
}

/* The critical price: where exercise value overtakes continuation value. A put's
   exercise region lies below it and a call's above, so the search runs in opposite
   directions. Null when no such price exists — a put's incentive is the interest on
   the strike, so a zero rate removes it, and a call's is the dividend, so a
   non-dividend call is never exercised early at any price. */
export function findCriticalPrice(strike, years, rate, yield_, vol, steps, isCall) {
  if (isCall ? yield_ <= 0 : rate <= 0) return null;
  if (years <= 0) return strike;

  let low, high;
  if (isCall) {
    low = strike;
    high = strike * 100;
    const holdsAtCeiling =
      priceAmerican(high, strike, years, rate, yield_, vol, steps, true).price >
      high - strike + strike * 1e-9;
    if (holdsAtCeiling)
      return null; /* a small yield against a large rate puts it out of reach */
  } else {
    low = 1e-6;
    high = strike;
  }

  for (let i = 0; i < 44; i++) {
    const mid = (low + high) / 2;
    const holding =
      priceAmerican(mid, strike, years, rate, yield_, vol, steps, isCall).price >
      exerciseValue(mid, strike, isCall) + strike * 1e-9;
    if (isCall) {
      if (holding) low = mid;
      else high = mid;
    } else {
      if (holding) high = mid;
      else low = mid;
    }
  }
  return (low + high) / 2;
}
