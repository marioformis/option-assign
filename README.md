# option-assign

Assignment risk calculator for short options. Static site, no build step.

## Running locally

The page loads `app.js` as an ES module, and browsers block module imports over
`file://`. Opening `index.html` directly shows the header and inputs but no
results. Serve it over HTTP instead:

```sh
python3 -m http.server
```

Then open <http://localhost:8000>. Any static server works — VS Code's Live
Server extension does the same thing.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup |
| `styles.css` | Styling |
| `model.js` | Option pricing and probability. Pure functions, no DOM |
| `format.js` | Number formatting |
| `chart.js` | Critical-price chart |
| `glossary.js` | Symbol tooltips |
| `app.js` | Reads inputs, runs the model, writes the readouts |
