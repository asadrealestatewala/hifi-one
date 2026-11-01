# Meetings and online workshops (video conferencing)

Hifi One has a built-in video meeting room, in the spirit of Google Meet, for team calls, client meetings and online workshops.

## What it does

- **Schedule or start instantly** from Meetings & Workshops, from a project page (the project's client is attached automatically), or from the Create menu. Types: meeting or online workshop (with an agenda).
- **Guest link for clients.** Every meeting has a generated link (`/join/<32 random characters>`). Clients open it in their browser, type their name, check their camera and microphone, and wait until the host lets them in. No account or app install. Send it by email (from the meeting page, using Settings → Email), WhatsApp (opens your WhatsApp with the message ready) or copy it. Clients linked to a meeting also see it, with a Join button, in their portal.
- **Video, voice and screen sharing.** Everyone's camera and microphone are shared with everyone else; the active speaker is highlighted; anyone can share their screen and the presenter's screen fills the stage with everyone else beside it.
- **Chat** inside the call, saved with the meeting (transcript on the meeting page). Messages are plain text and are never interpreted as HTML.
- **Host controls:** admit or deny people from the waiting room, remove someone, end the meeting for everyone. The host can switch the waiting room off per meeting.
- **Attendance:** after the meeting, who joined, when they left and for how long.

## How it works (so you know its limits)

- Video is **peer to peer (WebRTC)**: each person sends audio, camera and screen straight to every other person. The Hifi One server only passes the handshake messages and chat. This keeps the system simple and private, but it means each extra person adds load on everyone's computer and internet. **The limit is 8 people** per meeting; beyond that quality drops, so the system refuses to admit more. A larger or recorded call needs a media server (SFU) such as LiveKit, Janus or mediasoup, which is a separate piece of infrastructure to run.
- **Finding each other:** computers use a public STUN service (Google's, by default) to find a route. On strict company networks or some mobile networks a direct path is impossible and a **TURN relay** is needed. Set `ICE_SERVERS` (a JSON array in the standard WebRTC format) in the server environment to use your own STUN/TURN (for example coturn, or a hosted provider). Without TURN, some people will see "connection failed".
- **Live messages use a long-lived connection (server-sent events)** held in the server's memory. Run Hifi One as one process (as the Docker setup does). If you run several instances, route all traffic for a meeting to the same one (sticky sessions) or move the live hub to a shared store such as Redis.
- **HTTPS is required.** Browsers only allow camera, microphone and screen capture on `https://` addresses (and on `localhost`). The site's `Permissions-Policy` allows these only for Hifi One's own pages.
- **Recording (host only).** A host with the `meetings.recordings` permission can press Record in any meeting: internal team and progress meetings, client calls and workshops alike. The host's browser draws the video tiles it is showing into one picture, mixes everyone's audio, and uploads the result in 5-second pieces; the server appends them to one `.webm` file under `STORAGE_DIR/recordings` (back this folder up with the database) and closes it when the host stops or the meeting ends. Everyone in the call, including people who join later, sees a "This meeting is being recorded" banner. Recordings are listed on the meeting page and on the client's Delivery tab for people with the permission; starting, stopping and every download are audit logged. Limits: it records what the host's browser shows, so it needs the host's tab open (a closed tab loses at most the last few seconds); one recording is capped at 1.5 GB; the host's computer does the encoding. It is not a server-side recorder; for that a media server (LiveKit, Janus, mediasoup) would be needed. Tell people when joining that a meeting may be recorded.
- Screen sharing needs a desktop browser (Chrome, Edge, Firefox or Safari). Phones can join, see, hear, talk and chat but cannot share their screen.

## Security

- The guest link is a bearer secret: anyone who has it can ask to join; the waiting room means a person is only let in if the host admits them. The link dies when the meeting ends or is cancelled.
- Each person gets a private ticket (an httpOnly cookie scoped to that meeting) when they join. Every live endpoint checks that ticket on every request; a waiting, denied, removed or departed person receives nothing, and one meeting's ticket proves nothing about another.
- Guests are rate limited when joining, signalling and chatting; names are cleaned; only staff of the same organization can host or join as staff.
- These endpoints do not use browser sign-in (guests have none); the authorization test requires each of them to authenticate the participant.

## Tested

- 17 automated tests for the rules: scheduling validation, staff and guest joining, waiting room, host-only controls, deny/remove, ticket checks across meetings, ending and cancelling, chat limits and storage, attendance, the live message hub, and ICE configuration.
- A browser run with two participants on separate addresses (host on `localhost`, guest on `127.0.0.1`): the guest waited in the lobby, the host admitted them, video flowed both ways, chat messages arrived (HTML shown as text), and the host's screen share replaced the stage on the guest's side. Because the test machine has no camera or microphone, the run used synthetic video from a canvas; **real camera and microphone capture, real speakers, and calls across different networks (TURN) have not been tested yet**.
