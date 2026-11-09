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

## Rules
- Only people currently in a room can read it, send to it, or learn it exists; anything else is "not found". Pictures are `StoredFile` rows (`CHAT_MESSAGE`) with the same validation, scan and storage rules as other uploads; the file rule is "member of the room, chat permission, same organization; only the sender adds or removes".
- Staff only (`userType = EMPLOYEE`). No administrator back door: HR and Super Admin see only the rooms they are in.
- 40 messages per minute per person; 4000 characters per message; 50 MB per attachment.

## Not yet (later phases)
Voice/video calls (phases 3 and 4, reusing the meeting room's WebRTC signalling and `ICE_SERVERS`), @mentions, search inside messages, editing messages, replies and reactions.
