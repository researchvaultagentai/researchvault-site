import { INTERNATIONAL_ORIGIN, USDT, invoiceQuote, receiptReference } from './international-payments-config.js';

const $ = id => document.getElementById(id);
const show = (id, visible = true) => $(id).classList.toggle('hidden', !visible);
const money = amount => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(amount));
let snapshot, selectedInvoice, selectedQuote, generation = 0, submitting = false;

function notice(text, error = false) {
  $('paymentNotice').textContent = text;
  $('paymentNotice').classList.toggle('payment-error', error);
}
function receiptNotice(text, error = false) {
  $('receiptStatus').textContent = text;
  $('receiptStatus').classList.toggle('payment-error', error);
  show('receiptStatus');
}
function renderHistory() {
  $('receiptHistory').replaceChildren();
  for (const message of snapshot.messages || []) {
    const reference = receiptReference(message.body);
    if (reference?.invoiceId !== selectedInvoice.id) continue;
    const tx = reference.transactionId;
    const p = document.createElement('p');
    p.append('Receipt submitted for review · ');
    const link = document.createElement('a');
    link.href = 'https://tronscan.org/#/transaction/' + tx;
    link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = tx.slice(0, 12) + '…';
    p.append(link); $('receiptHistory').append(p);
  }
}
function selectInvoice(invoice, quote) {
  selectedInvoice = invoice; selectedQuote = quote;
  for (const button of $('paymentInvoices').querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.invoiceId === invoice.id));
  $('usdtAmount').textContent = Number(quote.usdt).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USDT';
  $('invoiceSummary').textContent = 'Invoice ' + invoice.id + ' · USD ' + quote.usd;
  $('walletAddress').value = USDT.address;
  $('copyStatus').textContent = '';
  $('refundTerms').textContent = quote.nonRefundable
    ? 'This invoice is non-refundable under the agreed service terms, subject to applicable law.'
    : 'The refund terms in your signed engagement and issued invoice apply.';
  $('receiptForm').reset(); show('receiptStatus', false);
  show('transferEmpty', false); show('transferDetails'); renderHistory();
}
async function loadCase() {
  const version = ++generation;
  selectedInvoice = null; selectedQuote = null; snapshot = null;
  show('transferDetails', false); show('transferEmpty'); $('paymentInvoices').replaceChildren();
  const id = $('paymentCase').value;
  if (!id) { notice('No international case yet. Start a confidential case before requesting an invoice.'); return; }
  notice('Loading invoices…');
  try {
    const result = await Patent.api('/api/cases/' + encodeURIComponent(id));
    if (version !== generation) return;
    if (result.case?.id !== id || result.case.pricing_market !== 'international') throw new Error('International billing is unavailable for this case.');
    snapshot = result;
    const invoices = Array.isArray(result.invoices) ? result.invoices : [];
    let first;
    for (const invoice of invoices) {
      const quote = invoiceQuote(invoice, id);
      const button = document.createElement('button'); button.type = 'button';
      button.className = 'invoice-choice'; button.dataset.invoiceId = invoice.id;
      button.setAttribute('aria-pressed', 'false'); button.disabled = !quote;
      const label = document.createElement('strong'); label.textContent = invoice.label || invoice.milestone || 'Service invoice';
      const value = document.createElement('span'); value.className = 'invoice-value';
      value.textContent = quote ? money(quote.usd) : (invoice.status === 'paid' ? 'Payment confirmed' : 'Contact us to confirm payment options');
      const status = document.createElement('span'); status.className = 'small';
      status.textContent = invoice.id + ' · ' + (invoice.status || 'not issued');
      button.append(label, value, status);
      if (quote) {
        button.addEventListener('click', () => selectInvoice(invoice, quote));
        first ||= { invoice, quote };
      }
      $('paymentInvoices').append(button);
    }
    if (first) {
      selectInvoice(first.invoice, first.quote);
      notice('Pay the selected invoice, then submit its transaction ID for review.');
    } else notice(invoices.length ? 'There is no invoice eligible for a new USDT payment. Contact us if you need help.' : 'Your invoice has not been issued yet. Please wait for the confirmed scope and invoice before transferring.');
  } catch (error) { if (version === generation) notice(error.message, true); }
}
async function submitReceipt(event) {
  event.preventDefault();
  if (submitting || !selectedQuote || !selectedInvoice || !snapshot || !$('receiptForm').reportValidity()) return;
  const transactionId = $('transactionId').value.trim();
  if (!/^[a-f0-9]{64}$/i.test(transactionId)) return receiptNotice('Enter the 64-character TRON transaction ID.', true);
  // Capture selection before awaiting. A case switch cannot attach the response
  // to the newly selected invoice or display a false success there.
  const caseId = snapshot.case.id, invoiceId = selectedInvoice.id;
  submitting = true; $('submitReceipt').disabled = true; $('paymentCase').disabled = true;
  for (const button of $('paymentInvoices').querySelectorAll('button')) button.disabled = true;
  receiptNotice('Saving your receipt…');
  try {
    const result = await Patent.api('/api/international-payments/receipts', { method: 'POST', body: {
      case_id: caseId, invoice_id: invoiceId, transaction_id: transactionId, acknowledged: $('receiptAcknowledged').checked,
    } });
    if (result.status !== 'pending_review' || result.invoice_paid !== false) throw new Error('Payment status could not be confirmed. Contact support; do not send another transfer.');
    receiptNotice('Receipt saved — payment review pending. Keep your transaction record and check your case for confirmation. Do not send a second transfer.');
    $('receiptForm').reset();
  } catch (error) { receiptNotice(error.message + ' Keep your transaction record; do not send another transfer.', true); }
  finally {
    submitting = false; $('submitReceipt').disabled = false; $('paymentCase').disabled = false;
    for (const button of $('paymentInvoices').querySelectorAll('button')) {
      const invoice = snapshot.invoices.find(value => value.id === button.dataset.invoiceId);
      button.disabled = !invoiceQuote(invoice, snapshot.case.id);
    }
  }
}
async function init() {
  if (location.origin !== INTERNATIONAL_ORIGIN) {
    notice('International payments are available only on the official ResearchVault Patent site.', true); return;
  }
  $('paymentCase').addEventListener('change', loadCase);
  $('receiptForm').addEventListener('submit', submitReceipt);
  $('copyWallet').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(USDT.address); $('copyStatus').textContent = 'Address copied. Confirm TRON (TRC20) in your wallet.'; }
    catch { $('walletAddress').focus(); $('walletAddress').select(); $('copyStatus').textContent = 'Select and copy the address above.'; }
  });
  try {
    const me = await Patent.api('/api/me');
    if (!me?.user) { show('paymentLogin'); notice('Sign in to see your own cases and issued invoices.'); return; }
    const result = await Patent.api('/api/cases');
    const cases = (result.cases || []).filter(item => item.pricing_market === 'international');
    const selected = new URLSearchParams(location.search).get('case');
    for (const item of cases) {
      const option = document.createElement('option'); option.value = item.id;
      option.textContent = (item.public_ref || item.id) + ' · ' + (item.title || 'Patent case');
      $('paymentCase').append(option);
    }
    if (selected && cases.some(item => item.id === selected)) $('paymentCase').value = selected;
    show('billingWorkspace'); await loadCase();
  } catch (error) { notice(error.message + ' Please retry or contact support before making a transfer.', true); }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
