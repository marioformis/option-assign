/* Relays CBOE's delayed option chain with CORS headers so the GitHub Pages site can read it. */

const SITE_ORIGIN = "https://marioformis.github.io";
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const TICKER = /^_?[A-Z.]{1,6}$/;
const CACHE_SECONDS = 60;

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    if (origin !== SITE_ORIGIN && !LOCAL_ORIGIN.test(origin)) {
      return new Response("Forbidden", { status: 403 });
    }

    const symbol = (new URL(request.url).searchParams.get("symbol") || "").toUpperCase();
    if (!TICKER.test(symbol)) {
      return new Response("Invalid symbol", {
        status: 400,
        headers: { "Access-Control-Allow-Origin": origin, Vary: "Origin" },
      });
    }

    const chainResponse = await fetch(
      `https://cdn-api.cboe.com/api/global/delayed_quotes/options/${symbol}.json`,
      { cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true } },
    );
    const relayedResponse = new Response(chainResponse.body, chainResponse);
    relayedResponse.headers.delete("Set-Cookie");
    relayedResponse.headers.set("Access-Control-Allow-Origin", origin);
    relayedResponse.headers.set("Vary", "Origin");
    return relayedResponse;
  },
};
