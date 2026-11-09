# Team chat

Staff chat inside Hifi One at **Project Operations → Team Chat** (`/chat`), permission `chat.use` (given to every staff role; run `npm run roles:sync` after deploying so existing roles receive it).

## Phase 1 (this version)
- **Direct messages** (one room per pair), **groups** (any staff member can create one; creator is admin; admins add, remove and rename; any member can leave; the last admin leaving hands admin to the longest-standing member), and **a room per project** (manager and members, kept in step with the project team each time someone opens chat).
- Text with emoji (built-in palette, nothing loaded from other sites), **pictures** (PNG, JPG, GIF, WebP up to 15 MB), avatars (profile photo or initials), unread counts per conversation and in the top bar, **read ticks** (one tick sent, two ticks read; groups show "Read by n of m" on hover), delete your own message, mute a conversation.
- **Live delivery** over server-sent events (`/api/chat/events`), held in memory like the meeting hub: run Hifi One as one process, or use sticky sessions / a shared store for several (see docs/MEETINGS.md). A dropped connection reconnects and reloads what was missed.
- Phone push (Expo) only for people with no open chat tab who have not muted the room. In-app notification rows are not created per message.

## Phase 2: videos, voice notes, files
- One attachment per message, up to **50 MB**: pictures, videos (MP4, MOV, WebM), voice notes, and documents (PDF, Word, Excel, CSV, text). The message kind (IMAGE, VIDEO, AUDIO, FILE) comes from what the file really is, checked by its contents. Voice and video types are accepted in chat only (`media` option of `validateUpload`); every other upload keeps the 15 MB and old type list.
- **Voice notes** are recorded in the browser (microphone permission, HTTPS required), up to 5 minutes, sent as WebM, Ogg or M4A depending on the browser.
- Chat files are served by `/api/chat/files/[id]` with byte-range support so videos and voice notes can be skipped through (Safari needs this). Pictures, video and audio play in the page; documents download.
- **Server setting:** `deploy/nginx/hifimarketing.co.conf` now has a `/api/chat/events` location (no buffering, needed for live messages) and raises the upload limit to 55 MB for the chat send route only. Copy it to the server and reload nginx; without it, files over 16 MB are refused by nginx and live messages may arrive late.
- Files are held in memory while being saved, so very many large uploads at once cost RAM; there is no video transcoding or thumbnailing.

## Phase 3: one-to-one calls (phase 4 below adds group calls)
- Voice and video buttons in the header of every **direct** conversation. Pressing one opens the call room (the existing WebRTC meeting room, same `ICE_SERVERS`, same 8-person engine) and rings the other person: a ring panel with Answer and Decline appears on **any Hifi One page** they have open (`CallListener` in the shell), with a short ring tone made by the browser and a desktop notification if they have allowed notifications. Nobody with no page open gets a phone push.
- Needs `chat.use` and `meetings.use`. Camera and microphone need HTTPS and the browser's permission, as in meetings.
- The conversation records each call as a line: ringing, in progress, "Video call · 4 min 12 s", declined, no answer, or "Missed voice call" (red for the person who missed it). A missed call also counts as an unread message.
- Ring times out after 45 s (server timer, plus a sweep when the conversation is opened, so a restart mid-ring cannot leave a call "ringing" for ever). The caller leaving before an answer cancels it; when everyone has left an answered call the call ends and its length is saved.
- A call is a meeting with purpose `CALL`: it is hidden from Meetings, the dashboard list and project views, it has no guest link, and the room can only be entered by starting or answering the call (not by knowing its address).
- Not yet: screen share is available in the room but not rung separately, no call history screen, no recording.
- **Real-network note:** two people on strict networks need a TURN relay (set `ICE_SERVERS`; see docs/MEETINGS.md). Without it some calls will show "connection failed". Not tested across different networks.

## Rules
- Only people currently in a room can read it, send to it, or learn it exists; anything else is "not found". Pictures are `StoredFile` rows (`CHAT_MESSAGE`) with the same validation, scan and storage rules as other uploads; the file rule is "member of the room, chat permission, same organization; only the sender adds or removes".
- Staff only (`userType = EMPLOYEE`). No administrator back door: HR and Super Admin see only the rooms they are in.
- 40 messages per minute per person; 4000 characters per message; 50 MB per attachment.

## Not yet (later phases)
@mentions, search inside messages, editing messages, replies and reactions.

## Phase 4: group calls
- The voice and video buttons also appear in **group and project rooms**. Pressing one rings every other active staff member of the room (ring panel on any page, titled with the room name and "Join"; phone push for people with no page open). The room is the same meeting room, so at most **8 people** can be in a call at once; the 9th person is told it is full.
- The first person to answer marks the call as in progress. After that anyone in the room can **Join call** from the call line in the conversation while it lasts, including the caller if they left. Their ring panel stays up until the call ends or the ring times out.
- One person declining only dismisses their own ring. The call is missed only if nobody answers within 45 s (or the caller leaves first); it ends, and its length is saved, when everyone has left.
- Rules are unchanged: needs `chat.use` and `meetings.use`, members only (someone who left the group cannot join), one call at a time per room, call rooms hidden from Meetings.
- Not tested across real networks or with 8 real devices; quality drops as the mesh grows (every person sends video to every other person). A media server such as LiveKit would be the next step for bigger calls.
