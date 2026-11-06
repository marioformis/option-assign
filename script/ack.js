/* Terms acknowledgement, shown on every page load before the tool can be used.
   Nothing is stored, so each load or refresh asks again. Loaded on the calculator
   page only, with defer, so the body exists when it runs. */

const TERMS = `
  <h2 id="ackTitle">Before you use this tool</h2>
  <p>This calculator is for education only. By continuing, you agree to the <a href="terms.html" target="_blank" rel="noopener">Terms of Use</a>, including that:</p>
  <ol>
    <li><b>Not advice.</b> Nothing here is financial, investment, legal or tax advice, or a recommendation on any security. The operator is not a registered adviser or broker, and no advisory relationship is created.</li>
    <li><b>Estimates only.</b> Figures come from models and delayed third-party data, may contain errors, and are not predictions or guarantees of assignment or any outcome.</li>
    <li><b>Your responsibility.</b> All trading decisions are yours alone. Nothing here substitutes for your broker or a qualified professional.</li>
    <li><b>No warranty.</b> The site is provided "as is" and "as available", without warranties of any kind, express or implied.</li>
    <li><b>No liability.</b> To the fullest extent permitted by law, the operator is not liable for any loss or damage, including trading losses, lost profits, and indirect or consequential damages, from use of or reliance on the site. You release and hold the operator harmless from any related claim.</li>
    <li><b>Options are risky.</b> Losses can exceed the premium received. See the OCC's <a href="https://www.theocc.com/company-information/documents-and-archives/options-disclosure-document" target="_blank" rel="noopener">Characteristics and Risks of Standardized Options</a>.</li>
  </ol>
  <label class="ack-check"><input type="checkbox" id="ackAgree"> I have read, understand and agree to the Terms of Use.</label>
  <div class="ack-actions">
    <a class="ack-leave" href="https://www.google.com/">Leave site</a>
    <button type="button" class="ack-continue" id="ackContinue" disabled>Agree and continue</button>
  </div>
`;

const dialog = document.createElement("dialog");
dialog.className = "ack";
dialog.setAttribute("aria-labelledby", "ackTitle");
dialog.innerHTML = TERMS;
document.body.prepend(dialog);

let agreed = false;
const agree = dialog.querySelector("#ackAgree"),
  proceed = dialog.querySelector("#ackContinue");
agree.addEventListener("change", function () {
  proceed.disabled = !agree.checked;
});
proceed.addEventListener("click", function () {
  agreed = true;
  dialog.close();
});
/* Escape, or a browser closing the dialog by other means, doesn't count as agreeing. */
dialog.addEventListener("cancel", function (event) {
  event.preventDefault();
});
dialog.addEventListener("close", function () {
  if (!agreed) dialog.showModal();
});
dialog.showModal();
