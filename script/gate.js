/* While the site is unfinished, every page shows only the in-progress placeholder,
   except on a local server. Adding ?gate to a local URL shows the placeholder
   anyway, to preview what visitors see. Loaded in <head>, before the body paints,
   so neither side flashes the other. To launch: delete this file, its <script>
   tags and the .gate placeholders in the pages, and the gate rules in styles.css. */
const isLocal = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
if (isLocal && !new URLSearchParams(location.search).has("gate"))
  document.documentElement.classList.add("local");
