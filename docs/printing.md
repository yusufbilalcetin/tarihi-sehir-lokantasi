# Printing: adisyon, kitchen tickets and the print queue

How paper gets out of this system, and — more importantly — what happens when
it does not.

## Not fiscal

Nothing printed here is a fiscal document. There is no ÖKC, no EFT-POS
integration, no e-Arşiv and no e-Fatura. The customer bill (*adisyon*) is an
informational statement of what was ordered; the payment slip is an
informational record that money was taken; X and Z remain the restaurant's own
operational cash documents. Every one of them carries a printed notice:

> Bu belge mali belge / ÖKC fişi değildir. *(adisyon)*
> Bu belge mali belge / banka POS slipi değildir. *(ödeme bilgi fişi)*
> Bu rapor operasyonel kasa mutabakatıdır; mali cihaz/ÖKC Z raporu değildir. *(X/Z)*

Nothing in the product may present any of them as an official or tax document.

## Architecture

The cloud server never dials a printer, because it cannot: a thermal printer
lives on `192.168.x.x` behind the restaurant's router, and exposing it to the
internet would be the wrong architecture even if it were reachable.

```
order/payment transaction ──► print_jobs row (INSERT only)
                                     │
                     outbound HTTPS  │  claim / complete / fail
                                     ▼
                          printer agent (in the restaurant)
                                     │  raw TCP :9100
                                     ▼
                            ESC/POS thermal printer
```

Three properties follow from that shape and are the reason for it:

**Printing never blocks money.** Enqueuing is a row insert on the order's own
transaction and nothing else — no socket, no timeout, no external call. A
printer that is switched off, jammed or unplugged cannot roll back an order, a
payment or a shift close. The failure surfaces as a `FAILED` job in the queue,
which is a paper problem, not a data problem.

**A ticket cannot go missing between the two.** Because the insert is *inside*
the transaction that confirms the order, there is no window in which the order
exists and the ticket does not, and none in which a ticket exists for an order
that rolled back.

**Command injection is impossible from the API side.** A client names a
document and a source id (`{"documentType":"CUSTOMER_BILL","orderId":"…"}`) and
never its contents. The server reads the source from the database, composes the
snapshot, and renders ESC/POS itself. No request body, and no field a user can
type, ever reaches the byte stream as a command.

## The queue

`print_jobs` is a PostgreSQL queue, so it survives a server restart and a
crashed agent.

| Column | Purpose |
| --- | --- |
| `payload_snapshot` | The document as it was when asked for, versioned |
| `dedupe_key` | Partial unique index; a repeated occurrence collapses to one job |
| `status` | `PENDING` → `PROCESSING` → `PRINTED` \| `FAILED` \| `CANCELLED` |
| `lease_until` | Server-clock lease held by the agent that claimed it |
| `attempt_count` | Bounded; terminal at `PRINT_RETRY.maxAttempts` |
| `reprint_of_job_id` / `reprint_reason` | A reprint is a new row that names its original and says why |

Claiming uses `FOR UPDATE SKIP LOCKED` with a lease taken from the **server**
clock, so two agents (or one agent started twice) cannot be handed the same job,
and a crashed agent's jobs return to the queue when the lease expires rather
than being stuck forever.

Retries use bounded exponential backoff, capped, with a hard attempt limit: a
printer left switched off overnight is polled less and less often and eventually
lands in `FAILED`, where a human decides. Nothing retries forever.

Dedupe keys are deterministic per printed *occurrence* — `confirm`,
`add:<hash>`, `cancel:<itemId>` — so repeating a confirmation produces no second
ticket, while genuinely adding a course produces a new one. A reprint
deliberately carries `dedupe_key = null`: it is meant to be a duplicate.

## Routing

`printer_routes` maps (document type, category) to a printer. The most specific
route wins: a category's own route beats the document's default route, and a
category with no route of its own falls back to the default. One category may
fan out to several printers, but never twice to the same one. Inactive routes
and retired printers are skipped.

A mixed order splits per station, and each ticket carries only its own station's
lines: the grill never sees the drinks. Lines that route nowhere are **reported**
(`unroutedCount`), never silently dropped — and the order still succeeds.

With no routes configured at all, nothing is queued and every order still works.
That is the intended degraded mode, not a bug.

## The agent

See `tools/printer-agent/README.md` for setup. The security-relevant parts:

- It holds **no database credential and no service-role key**. Its only secret
  is its own bearer token. A foundation test asserts the source contains no
  `DATABASE_URL`, no `postgres://` and no Supabase reference.
- It **never composes printer commands** — it forwards bytes the server
  rendered.
- It connects **outbound only**. No inbound port is opened in the restaurant.
- The device map (`kitchen-main` → `192.168.1.50:9100`) is local. The server
  stores a stable `deviceKey` and never an IP address.

### Tokens

An agent token is 32 random bytes, base64url (43 characters), returned **once**
at creation or rotation. The database stores only `v<n>.<HMAC-SHA256>` computed
with `PRINTER_AGENT_TOKEN_PEPPER` and a printing-specific domain separator. A
lost token is rotated, never recovered. It is never logged, never written to an
audit payload, and never exposed to the browser (`printer_agents` is unreadable
to `anon` and `authenticated` alike).

`PRINTER_AGENT_TOKEN_PEPPER` is its own secret. It is **not** reused from
`OUTBOX_DISPATCH_SECRET`, `MAINTENANCE_SECRET`, `AUTH_SECRET` or `QR_TOKEN_PEPPER`,
and it must never be `NEXT_PUBLIC_`.

Revocation and rotation take effect on the very next call: the agent lookup
selects only active, unrevoked rows. A malformed token, an unknown token, a
revoked token and a deactivated agent all produce the same 401, so nothing
reveals which agents exist.

## What `PRINTED` means

**`PRINTED` means the bytes reached the configured transport.** A dumb ESC/POS
printer does not acknowledge paper: it does not report a jam, an empty roll, or
a cover left open. This system therefore cannot and does not claim that a
physical ticket exists. The admin queue and the kitchen board both say
"Yazdırıldı", and the UI states the limitation next to it.

The agent keeps a small local journal of completed job ids so that a lost
acknowledgement does not reprint the same ticket when the server hands it back.
That is a mitigation against duplicate paper, not an exactly-once guarantee —
no such guarantee is available over an unacknowledged serial protocol.

## Card data

No full PAN, CVV, card expiry, PIN or processor secret is ever stored in a print
payload or rendered onto paper. The payment slip prints the method and the
amount. This system is not in the card-data path at all.

## Character encoding

Turkish text needs a code page. Printers are configured per device with
`CP857`, `CP1254` or `UTF8`; the server selects the code page while rendering,
so `Kuzu Şiş` prints as `Kuzu Şiş` rather than `Kuzu Sis` or mojibake. An
unsupported encoding is rejected when the printer is created, rather than
discovered on paper.

Text is sanitised before it is rendered: control characters are stripped, and
tabs, newlines and other layout whitespace become a single space — deleting them
would run two words together on the ticket.

## Hardware verification

**No physical thermal printer was connected in this environment.** The wire
format is verified against a mock TCP server that asserts the byte stream (it
starts with `ESC @`, and the Turkish characters arrive as CP857 high bytes), and
the transport is plain `node:net`. No USB or serial driver is imported, because
none could be verified here.

Physical printer behaviour — paper width, cut depth, drawer kick, the exact
code page a given model honours — **requires on-site acceptance testing** before
production use.

## Failure modes and what the operator sees

| Situation | System behaviour | Screen |
| --- | --- | --- |
| Printer switched off | Job retries with backoff, then `FAILED` | Yazdırılamadı, with the error code |
| Agent not running | Jobs stay `PENDING`; agent shows offline | Çevrimdışı |
| No route configured | Nothing queued; order unaffected | Kuyrukta iş yok |
| Lost acknowledgement | Lease expires, job is re-handed, journal suppresses the reprint | Yazdırıldı |
| Torn or lost ticket | Operator reprints **with a reason** | Yeniden yazdırma, with the reason |

A reprint never overwrites the original job: the original keeps its status and
its snapshot, and the copy is a new row pointing at it. An unexplained duplicate
ticket at the pass is indistinguishable from a bug, which is why the reason is
mandatory and enforced by a check constraint as well as by validation.

## Retention

`print_jobs` and `print_job_attempts` are classified
`LONG_TERM_OPERATIONAL_HISTORY` and are **not** auto-deletable. The maintenance
job cannot reach them. `printer_agents` is `SECURITY_TECHNICAL`;
`restaurant_printers` and `printer_routes` are `MASTER_DATA`. See
`docs/data-retention.md`.
