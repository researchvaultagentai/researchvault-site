# International invoice payments

This feature is built only by `deploy/patent-en/build.mjs` for the independent
English Pages project. Neither the Iranian site (including its English
translation), shared Patent API, nor article bot is changed.

## Available now

- `/patent/en/payments/` lists the signed-in customer's international cases and
  issued USD invoices. The landing page and dashboard link to it.
- USDT receiving details use TRON/TRC20 only, with a locally generated address
  QR, copy button, exact invoice amount, explicit fee/network instructions and
  receipt submission. No wallet private key or seed is requested or stored.
- The merchant accepts one USDT per USD invoiced. This is an invoice settlement
  convention, not a guarantee of USDT market value.
- PayPal is explicitly unavailable. No merchant address or payment link is
  fabricated, and there is no operational PayPal checkout yet.
- Receipts are saved as **client messages pending administrator review** in
  the existing authenticated patent case. Retry detection operates within that
  case. These messages are not a payment ledger or trusted settlement evidence.
- The handler never marks an invoice paid, activates work, approves a file, or
  releases any password. A submitted/public transaction hash is not proof that
  the customer paid for this invoice.

## Existing invoice units

The current shared admin form submits and displays whole currency units even
though its database column is named `amount_minor`. For a Stage 1 USD invoice,
enter **1111**, currency **USD**, provider **manual** or **usdt**, milestone
**stage1_deposit**, and non-refundable service terms. For a chargeable revision
invoice, enter **111**, milestone **stage1_revision** (via the existing admin API
where required). Draft changes and corrections to service errors are not billed.

For a future issuer that uses cents, explicitly set invoice metadata
`usd_amount_unit: "cents"`; then 111100 means USD 1111.00. Missing metadata uses
the existing whole-USD convention. Unrecognized units, unexpected fixed Stage 1
fees, paid/draft/partial/expired invoices, non-USD invoices and domestic cases
cannot open a new payment. Do not reinterpret existing invoices silently.

## Administrator settlement procedure

1. Independently inspect the successful **solidified** TRON transaction and
   actual Transfer event, not a screenshot or the client message alone.
2. Confirm the official USDT contract, receiving wallet, net amount and date.
3. Establish payer/invoice attribution. Public transaction hashes can be copied.
   Check other cases and the payment ledger to prevent reuse across invoices.
4. Only then use the existing authenticated administrator settlement action.

The current shared manual `mark-paid` action has not been redesigned here.
Automatic settlement needs a durable globally unique transaction/log ledger,
strong payer/invoice binding, invoice concurrency rules and reconciliation.
Automatic password delivery additionally needs final report approval and the
approved PDF hash. These are separate, unfinished integration steps.

## Optional chain lookup preparation

No new Cloudflare resource or key is required for the manual-review flow.
`PATENT_API` remains the existing private Service binding.

If `TRONGRID_API_KEY` is later configured as a **Pages runtime secret**, a
single bounded mainnet `walletsolidity/gettransactioninfobyid` lookup can assist
receipt review. Missing keys cause no RPC request. Provider failure does not
discard a customer's receipt or turn it into a successful payment. Even an
exact matching event stays pending: it does not establish who paid or unique
use of the transaction. No polling, paid provider fallback or wallet signing is
enabled. Keep the optional key out of public variables, source and logs.

Official references:
- https://tether.to/en/supported-protocols/
- https://developers.tron.network/docs/event
- https://developers.tron.network/docs/confirmation-semantics
- https://developers.tron.network/reference/select-network

## Validation

`node --test deploy/patent-en/test/*.test.mjs` checks routing, authentication,
invoice scope/units, exact fee checks, receipt retries and chain parsing.
`node deploy/patent-en/test/payments.browser.mjs` covers responsive layouts,
independent QR decoding, clipboard, pending receipt submission, logged-out and
domestic/paid-case exclusion using synthetic fixtures. It does not send funds.
