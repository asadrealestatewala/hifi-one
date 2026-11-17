# Solution feed: live results for partners and sales agents

Added 2026-11-17 on Asad's "go". Each Solution (Campusly, Velocity ERP, Pharmivo POS, Agentify ERP) reports its client workspaces to Hifi One,
so partners and sales agents see live status and usage in their portals without asking anyone.

## What is sent (counts only)

Asad's decision (2026-11-17): status and usage counts only. No client records ever leave a Solution: no student, patient, customer or sale
details. The report has no field for them, and any unknown field is dropped.

```
POST https://<hifi one>/api/solution-feed/<CODE>        CODE = CAMPUSLY | VELOCITY | PHARMIVO | AGENTIFY (the Solution's code)
Content-Type: application/json
X-Feed-Timestamp: <milliseconds since 1970>
X-Feed-Signature: <hex HMAC-SHA256 of "<timestamp>.<raw body>" with the Solution's secret>

{
  "reportedAt": "2026-11-17T06:00:00+05:00",            optional, defaults to when it arrives
  "workspaces": [                                         1 to 500 per report; send several reports if there are more
    {
      "id": "beaconhouse-dha",                            the workspace's own slug or id in the Solution (required)
      "name": "Beaconhouse DHA",                          (required)
      "status": "LIVE",                                   TRIAL | LIVE | OVERDUE | SUSPENDED | CANCELLED (required)
      "plan": "Standard",
      "paidUntil": "2026-12-05",
      "activeUsers": 38,                                  people who signed in during the last 30 days
      "units": 420, "unitLabel": "students",              what the Solution bills by: students, branches, devices
      "lastActivityAt": "2026-11-17T05:40:00+05:00",
      "appVersion": "2.3.1"
    }
  ]
}
```

Replies: 200 `{ ok, accepted, created, updated, skipped }`; 400 wrong shape; 401 unknown Solution, no secret, bad signature or a timestamp more
than 5 minutes away (so a captured report cannot be replayed); 413 over 2 MB; 429 too many bad signatures from one address.
An older report arriving after a newer one is skipped. Suggested schedule: every 15 minutes.

## In Hifi One

- **Partner Stack → Live Solutions** (`/partner-stack/live`, `partners.manage`): feed status per Solution ("Not configured", waiting for the
  first report, reporting, or not reporting), and every reported workspace with a picker to link it to its Hifi One client.
  A Super Admin creates, replaces or switches off each Solution's secret here; it is shown once and stored sealed (AES-256-GCM from SESSION_SECRET).
- **Partner portal → My schools**: a "Live results" column for each of the partner's own schools (matched by client and Solution). When the
  reported count differs from the count the partner entered, the partner is told Hifi checks it before billing. Billing still uses confirmed counts only.
- **Prospector → My clients live** (`/leads/prospector/clients`, `crm.edit`): office and field sales agents see the clients they converted
  (the converted lead's owner, the same rule commissions use), with status, usage, paid-until date and what the status means for commission.
- **Daily job "Live Solutions check"**: tells the partner team when a Solution has not reported for 3 hours (or never reported a day after its
  secret was made), and how many workspaces are waiting to be linked.

Figures older than 3 hours are marked "may be out of date" everywhere.

## Not built yet

- The Solutions' side (each repo sends the report). Campusly first, then Velocity ERP, Pharmivo POS, Agentify ERP. Those repos deploy through
  GitHub Actions, which is off, so each needs a manual deploy.
- Automatic linking (for example a partner referral code entered at signup in the Solution). Linking is by staff for now.
- Pre-filling reseller monthly counts from the reported count (shown beside the entered count today).
