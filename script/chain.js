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
    contracts: standardContracts(body.data.options.map(contractFrom)),
  };
}

/* A chain can carry more than one option root. A root with a digit (NVDA1 after a
   split, or B1VDA) trades a non-standard deliverable, so its prices don't fit a
   100-share model and are dropped. Where two remaining roots list the same contract
   (SPX and SPXW), the root with the most listings wins. */
function standardContracts(contracts) {
  const standard = contracts.filter((contract) => !/\d/.test(contract.root));
  const listings = new Map();
  standard.forEach(function (contract) {
    listings.set(contract.root, (listings.get(contract.root) || 0) + 1);
  });
  const chosen = new Map();
  standard.forEach(function (contract) {
    const key = contract.expiry + contract.isCall + contract.strike;
    const held = chosen.get(key);
    if (!held || listings.get(contract.root) > listings.get(held.root)) chosen.set(key, contract);
  });
  return [...chosen.values()];
}

/* An OCC option symbol ends in YYMMDD, C or P, then the strike × 1000 in eight digits. */
/* With no ask there is no market to take a midpoint of, so the mark is left null
   for the user to enter. A missing bid alone still gives the usual ask / 2. */
function contractFrom(quote) {
  const code = quote.option.slice(-15);
  return {
    root: quote.option.slice(0, -15),
    expiry: "20" + code.slice(0, 2) + "-" + code.slice(2, 4) + "-" + code.slice(4, 6),
    isCall: code[6] === "C",
    strike: Number(code.slice(7)) / 1000,
    mark: quote.ask > 0 ? (quote.bid + quote.ask) / 2 : null,
  };
}
