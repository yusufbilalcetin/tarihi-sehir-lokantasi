# Printer agent

A small Node process that runs **inside the restaurant** and puts queued
documents on paper.

The cloud server never dials a printer. It cannot: a printer lives on
`192.168.x.x`, behind the restaurant's router, and exposing it to the internet
would be the wrong architecture even if it were possible. Instead this agent
makes an **outbound HTTPS** connection to the application, claims the jobs that
belong to its own printers, writes the bytes to the local device, and reports
back. No inbound port is opened.

## What it is not

- It holds **no database credential** and **no Supabase service-role key**. Its
  only secret is its own bearer token.
- It **never composes printer commands**. The server renders ESC/POS and the
  agent forwards the bytes, which is what makes printer command injection
  impossible from the application side.
- `PRINTED` means "the bytes reached the configured transport". A dumb ESC/POS
  printer does not acknowledge paper, so it is not a claim that a ticket
  physically exists.

## Setup

```bash
cp printer-agent.config.example.json printer-agent.config.json
# edit the device map, then export the token the admin panel showed you once
export PRINTER_AGENT_TOKEN=...
npm run printer-agent
```

The token is shown **once**, when the agent is created or its token is rotated.
It is stored only as an HMAC digest, so a lost token is rotated, never
recovered. Keep it in the environment rather than in the config file, and never
commit `printer-agent.config.json`.

## Device map

The server stores a stable `deviceKey` such as `kitchen-main`. This file turns
that into an address, so the LAN layout stays local:

```json
{
  "devices": {
    "kitchen-main": { "transport": "tcp", "host": "192.168.1.50", "port": 9100 }
  }
}
```

`9100` is the usual ESC/POS port, but it is configuration, not an assumption.

## Journal

Successful job ids are appended to a small local journal. If an acknowledgement
is lost in flight and the server hands the same job back, the agent completes it
again without reprinting — one of several measures that reduce duplicate paper.
It is a mitigation, not an exactly-once guarantee.
