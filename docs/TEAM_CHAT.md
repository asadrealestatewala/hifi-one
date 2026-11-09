# Team chat

Staff chat inside Hifi One at **Project Operations → Team Chat** (`/chat`), permission `chat.use` (given to every staff role; run `npm run roles:sync` after deploying so existing roles receive it).

## Phase 1 (this version)
- **Direct messages** (one room per pair), **groups** (any staff member can create one; creator is admin; admins add, remove and rename; any member can leave; the last admin leaving hands admin to the longest-standing member), and **a room per project** (manager and members, kept in step with the project team each time someone opens chat).
- Text with emoji (built-in palette, nothing loaded from other sites), **pictures** (PNG, JPG, GIF, WebP up to 15 MB), avatars (profile photo or initials), unread counts per conversation and in the top bar, **read ticks** (one tick sent, two ticks read; groups show "Read by n of m" on hover), delete your own message, mute a conversation.
- **Live delivery** over server-sent events (`/api/chat/events`), held in memory like the meeting hub: run Hifi One as one process, or use sticky sessions / a shared store for several (see docs/MEETINGS.md). A dropped connection reconnects and reloads what was missed.
- Phone push (Expo) only for people with no open chat tab who have not muted the room. In-app notification rows are not created per message.

## Rules
- Only people currently in a room can read it, send to it, or learn it exists; anything else is "not found". Pictures are `StoredFile` rows (`CHAT_MESSAGE`) with the same validation, scan and storage rules as other uploads; the file rule is "member of the room, chat permission, same organization; only the sender adds or removes".
- Staff only (`userType = EMPLOYEE`). No administrator back door: HR and Super Admin see only the rooms they are in.
- 40 messages per minute per person; 4000 characters per message.

## Not yet (later phases)
Videos, voice notes and files (phase 2), voice/video calls (phases 3 and 4, reusing the meeting room's WebRTC signalling and `ICE_SERVERS`), @mentions, search inside messages, editing messages, replies and reactions.
