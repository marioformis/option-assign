# Option Assignment Calculator

Estimates the risk of early assignment on a short put or call. Enter the position
straight off a broker's option quote — stock price, strike, days to expiration,
contracts, the option's mark, risk-free rate, and dividend yield — and the page
reports the [critical price](https://en.wikipedia.org/wiki/Option_style#American_and_Bermudan_options)
where exercising starts to beat holding, what the buyer stands to gain by
exercising, and the probability of assignment by expiration.

## Calculations

- **Implied volatility** is solved from the mark using the
  [Cox–Ross–Rubinstein binomial model](https://en.wikipedia.org/wiki/Binomial_options_pricing_model),
  which prices American options directly.
- **Assignment probability** comes from that same binomial tree walked back from
  expiration: a node counts as assigned once exercise value exceeds continuation
  value, or the option finishes in the money.
- **Critical price (S\*)** is the price at which those two values are equal — the
  early-exercise boundary. It follows from
  [put–call parity](https://en.wikipedia.org/wiki/Put%E2%80%93call_parity):
  exercising early is only rational once the interest earned (for puts) or
  dividend captured (for calls) outweighs the value of the equivalent European
  option.
- **Probability in the money** is N(d₂) (N(−d₂) for a put) from the
  [Black–Scholes model](https://en.wikipedia.org/wiki/Black%E2%80%93Scholes_model).

All probabilities are risk-neutral, the same convention used for a broker's
"probability ITM" — not a forecast under your own view of the stock.
