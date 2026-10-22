/* Loads CBOE's delayed option chain through the Cloudflare Worker relay (see worker/). */

const CHAIN_URL = "https://cboe-chain.formim2016.workers.dev/?symbol=";
const TIMEOUT_MS = 8000;

export async function fetchChain(symbol) {
  const response = await fetch(CHAIN_URL + encodeURIComponent(symbol), {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Chain request failed with status " + response.status);
  const body = await response.json();
  return {
    spot: body.data.current_price,
    change: body.data.price_change,
    changePercent: body.data.price_change_percent,
    /* CBOE stamps the quote in UTC without a zone marker. */
    quoteTime: new Date(body.timestamp.replace(" ", "T") + "Z"),
    contracts: body.data.options.map(contractFrom),
  };
}

/* An OCC option symbol ends in YYMMDD, C or P, then the strike × 1000 in eight digits. */
function contractFrom(quote) {
  const code = quote.option.slice(-15);
  return {
    expiry: "20" + code.slice(0, 2) + "-" + code.slice(2, 4) + "-" + code.slice(4, 6),
    isCall: code[6] === "C",
    strike: Number(code.slice(7)) / 1000,
    mark: (quote.bid + quote.ask) / 2,
  };
}
