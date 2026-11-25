# One Cloudflare Durable Object per Room, with server-authoritative Format rules

Each **Room** is a single Cloudflare Durable Object that holds all of its state and the WebSocket connections of everyone in it; every **Format** rule (hidden Spectrum positions until reveal, Surrounded removal votes, chair races, caps, Host PIN rate limiting) is enforced inside that object, and clients only send intents and render state. We chose this over a Node + Socket.IO server (more to run and scale for a mostly idle, bursty workload) and over Supabase/Firebase realtime (database-first, which makes it hard to keep hidden information hidden from clients). Durable Object storage and alarms also give us Room expiry after 7 days of inactivity without a separate cleanup job.

## Consequences

- We are tied to Cloudflare Workers for the backend; moving off means rewriting the Room server, not just redeploying it.
- There is no cross-Room database in v1. Anything that spans Rooms (accounts, saved Lineups) will need a separate store later.
