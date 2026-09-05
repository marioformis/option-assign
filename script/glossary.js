/* Hoverable symbol definitions. Terms are read from the glossary markup so it
   stays the single source of truth for what each symbol means. */

const ANNOTATED_REGIONS = ["derivations", "breakdown", "tiles"];

function readGlossary() {
  const entries = new Map();
  const rows = document.querySelectorAll(".lede-glossary dl > div");
  for (const row of rows) {
    const term = row.querySelector("dt"),
      meaning = row.querySelector("dd");
    if (!term || !meaning) continue;
    for (const symbol of term.textContent.split(",")) {
      const key = symbol.trim();
      if (key)
        entries.set(key, { label: term.textContent.trim(), text: meaning.textContent.trim() });
    }
  }
  return entries;
}

/* Longest first so "S*" and "1σ" match before the bare "S" and "σ". */
function symbolPattern(keys) {
  const escaped = keys
    .slice()
    .sort((a, b) => b.length - a.length)
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp("(?<![A-Za-z0-9])(" + escaped.join("|") + ")(?![A-Za-z0-9])", "g");
}

function annotateSymbols(glossary) {
  const pattern = symbolPattern([...glossary.keys()]);
  for (const regionId of ANNOTATED_REGIONS) {
    const region = document.getElementById(regionId);
    if (!region) continue;
    const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
    const targets = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentNode.classList && node.parentNode.classList.contains("sym")) continue;
      if (pattern.test(node.nodeValue)) targets.push(node);
      pattern.lastIndex = 0;
    }
    for (const text of targets) {
      const holder = document.createElement("span");
      holder.innerHTML = text.nodeValue.replace(pattern, function (match) {
        return (
          '<span class="sym" tabindex="0" data-symbol="' + match + '">' + match + "</span>"
        );
      });
      text.parentNode.replaceChild(holder, text);
    }
  }
}

export function startSymbolTips() {
  const glossary = readGlossary();
  if (!glossary.size) return;
  const tip = document.createElement("div");
  tip.className = "sym-tip";
  document.body.appendChild(tip);

  const show = function (target) {
    const entry = glossary.get(target.getAttribute("data-symbol"));
    if (!entry) return;
    tip.innerHTML = "<b></b>";
    tip.firstChild.textContent = entry.label;
    tip.appendChild(document.createTextNode(entry.text));
    tip.classList.add("visible");
    const anchor = target.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    let left = anchor.left + anchor.width / 2 - box.width / 2;
    left = Math.max(10, Math.min(left, window.innerWidth - box.width - 10));
    const above = anchor.top - box.height - 9;
    tip.style.left = left + "px";
    tip.style.top = (above > 10 ? above : anchor.bottom + 9) + "px";
  };
  const hide = function () {
    tip.classList.remove("visible");
  };

  document.addEventListener("mouseover", function (event) {
    const target = event.target.closest && event.target.closest(".sym");
    if (target) show(target);
  });
  document.addEventListener("mouseout", function (event) {
    if (event.target.closest && event.target.closest(".sym")) hide();
  });
  document.addEventListener("focusin", function (event) {
    const target = event.target.closest && event.target.closest(".sym");
    if (target) show(target);
  });
  document.addEventListener("focusout", hide);
  window.addEventListener("scroll", hide, { passive: true });

  return function () {
    annotateSymbols(glossary);
  };
}
