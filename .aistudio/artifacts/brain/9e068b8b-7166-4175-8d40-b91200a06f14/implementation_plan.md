# Urgent Pop-up Messaging Refinement: Internal User Targeting & 48px Bold Red Display

Restructure and refine the emergency broadcast pop-up system to strictly target internal office users (excluding drivers), display urgent messages in prominent 48px bold red typography, deliver alerts directly to targeted users' login sessions, enable a 30-second auto-close countdown with manual dismissal, and restrict broadcast initiation strictly to the Owner.

## User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural and UX decisions were confirmed through user clarifications and will govern execution:

- **Target Audience Restriction**: In the recipient selection dropdown, driver names are completely excluded. Only authenticated internal office users (from staff logins, user passwords, and the Owner role) will be displayed.
- **Broadcast Scope**: "All Users" mode broadcasts exclusively to logged-in internal office users and Owner sessions, never leaking to driver devices.
- **Visual Presentation**: The popup alert text is rendered in **48px bold red** (`text-[48px] font-black text-red-600`) both in the live preview and on the recipient's viewport.
- **Dismissal Lifecycle**: Popups feature an auto-close timer of **30 seconds** with an animated progress countdown, while allowing immediate manual dismissal by the recipient or cancellation by the sender.
- **Permission Access**: The broadcast trigger button in navigation is visible and accessible **strictly to the Owner** (`role === 'owner'`).

---

## 1. Overview & Core Concept

- **What It Does**: Allows the business Owner to dispatch high-priority alerts across internal office terminals. Messages instantly appear as high-visibility modal popups with 48px bold red typography on the selected user's active session, play a distinct dual-tone auditory chime, and auto-dismiss after 30 seconds if not acknowledged sooner.
- **Target Audience**: Business Owner (sender) and internal office staff members (recipients like Pratixa, Khushi, and office operators).
- **Key Value**: Immediate, unmissable operational communication between Owner and internal staff without manual phone calls or third-party app switching.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Owner Dispatches Alert**:
   - Owner clicks the top navigation broadcast button (accessible only to Owner).
   - In the modal, Owner selects the target: "All Internal Staff & Owner" or an individual staff user (e.g. `Pratixa`, `Khushi`). No drivers are listed.
   - Owner types the notice text or selects a quick template chip.
   - A real-time preview displays the text formatted in **48px bold red** font.
   - Owner clicks "Send Pop-up".

2. **Recipient Receives Alert**:
   - The selected user's active screen instantly displays an overlay with dark backdrop blur.
   - A dual-tone Web Audio alert chimes.
   - The message is prominently displayed in **48px bold red typography** (`text-[48px] font-black text-red-600 leading-tight select-text break-words`).
   - A 30-second countdown bar ticks down at the top/bottom.
   - The recipient can click **"BAND KARE / CLOSE"** immediately, or wait for the 30-second timer to auto-dismiss the message.
   - If the Owner cancels the message from the "Chal Rahe Messages" tab, the popup instantly vanishes from the recipient's screen in real time.

### Visual Identity & Theme Tokens

- **Aesthetic Direction**: High-urgency executive dispatch, clean administrative design with high-contrast accessibility.
- **Color Discipline**:
  - Alert Accent: Crimson Red (`hsl(0, 84%, 60%)` / `#DC2626` / Tailwind `text-red-600`) strictly focused on the alert message and countdown bar.
  - Canvas: Background card with subtle crimson border glow (`border-4 border-red-600 shadow-[0_0_50px_rgba(220,38,38,0.45)]`).
- **Typography**:
  - Message Text: `48px` font size, `font-black` (900 weight), high optical legibility, balance wrapping.
  - Metadata: 12px muted text (`From: Owner · To: Pratixa · 30s auto-close`).

---

## 3. Key Product Decisions & Trade-Offs

- **Internal Users vs. Drivers Data Separation**:
  - *Chosen Approach*: Query driver lists with `role === 'user'` or `id.startsWith('usr_')`, merge with cached staff names from `vt_staff_names`, and filter out any entry designated as driver.
  - *Why*: In the underlying database schema, all users and drivers share the `drivers` table with role tags. Strict client-side filtering prevents field drivers from cluttering internal staff communication.
- **Session Identification & Multi-Device Target Matching**:
  - *Chosen Approach*: Match both case-insensitive username (`getLoggedInName().toLowerCase() === targetUser.toLowerCase()`) and role (`'user'` / `'owner'`). Store session credentials in both `sessionStorage` and fallback `localStorage` to ensure cross-tab resilience.
  - *Why*: Staff logins might be stored with varied capitalization (e.g., `PRATIXA` vs `Pratixa`). Case-insensitive normalization guarantees reliable delivery.
- **Dual-Dismiss Mechanism (30s Timer + Manual Close + Sender Stop)**:
  - *Chosen Approach*: `useEffect` timer on the popup modal that counts down from 30 seconds and calls `dismissUrgentMessage()`, supplemented by the existing manual close button and real-time SSE cancel broadcast.
  - *Why*: Satisfies the user requirement for automatic 30-second timeout while maintaining full interactive control.

---

## 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────┐
│                   Owner Dashboard                      │
│        (SendUrgentMessageModal - Owner Only)           │
│  - Filtered User List: Staff & Owner (No Drivers)      │
│  - 48px Bold Red Live Preview                          │
│  - POST /api/urgent-messages/send                      │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│               Express Server Backend                   │
│  - SSE Broadcast (/api/urgent-messages/stream)         │
│  - PostgreSQL / Memory Store for Messages              │
└──────────────────────────┬─────────────────────────────┘
                           │
            ┌──────────────┴──────────────┐
            ▼                             ▼
┌─────────────────────────┐   ┌──────────────────────────┐
│  Targeted Staff Device  │   │  Non-Targeted Device     │
│  - Matches logged-in    │   │  - Message filtered out  │
│    user name or role    │   │  - No popup shown        │
│  - 48px Bold Red Popup  │   │                          │
│  - 30s Auto-Close Timer │   │                          │
│  - Audio Alert Chime    │   │                          │
└─────────────────────────┘   └──────────────────────────┘
```

### Component & State Modifications

1. `src/components/SendUrgentMessageModal.tsx`:
   - Enforce Owner-only access (`getRole() === 'owner'`).
   - Extract internal user list exclusively from staff sources (`d.role === 'user'`, `id.startsWith('usr_')`, `vt_staff_names`, `user_passwords`). Explicitly exclude driver records.
   - Update target selector options:
     - `ALL`: "🔴 SABHI INTERNAL USERS (Staff & Owner Only)"
     - Specific staff users: individual user names.
   - Update live preview and typography to **48px bold red** (`text-[48px] font-black text-red-600 leading-tight`).

2. `src/components/UrgentMessagePopup.tsx`:
   - Set core message container style to `text-[48px] font-black text-red-600 leading-tight select-text break-words w-full`.
   - Add a 30-second countdown timer (`const [secondsLeft, setSecondsLeft] = useState(30)`):
     - Visually display countdown badge or progress bar ("Auto-closing in 30s").
     - Automatically trigger dismissal when timer reaches 0.
   - Retain manual "BAND KARE / CLOSE" button for immediate manual acknowledgment.

3. `src/lib/urgentMessageStore.ts`:
   - In `isMessageForCurrentUser(msg)`:
     - If `msg.targetUser === 'ALL'`, verify `myRole !== 'driver'`. Drivers must never receive internal broadcast messages.
     - Case-insensitive trimming on user names.
   - Add dual storage lookup (`sessionStorage` and `localStorage`) for logged-in user names in `auth.ts` to ensure identity is never lost across tab transitions.

4. `src/components/TopNav.tsx`:
   - Restrict the emergency broadcast icon button strictly to `role === 'owner'`.
