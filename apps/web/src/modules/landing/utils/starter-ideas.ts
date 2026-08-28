export type StarterIdea = {
  /** Short label shown on the chip. */
  label: string;
  /** Full, detailed spec dropped into the composer when the chip is clicked
   *  — deliberately thorough (entities, relationships, screens, edge cases,
   *  UI direction) so codegen has a real spec to build against instead of a
   *  one-line prompt it has to guess the details of. */
  prompt: string;
};

export const STARTER_IDEAS: StarterIdea[] = [
  {
    label: "Team CRM",
    prompt: `Build a team CRM for tracking sales deals.

Data model: Companies, Contacts (each linked to a company), and Deals (each linked to a contact — with a dollar value, a stage, and an expected close date).

Screens:
- A Kanban pipeline board with deal cards grouped into columns by stage (Lead, Qualified, Proposal, Negotiation, Won, Lost) — dragging a card into a new column updates its stage immediately.
- A Companies list with a detail page showing that company's contacts and open deals.
- A Contacts list (searchable) with a detail page showing contact info and full deal history.
- An activity log on each deal: short timestamped notes the team adds, newest first, showing who wrote each one.
- A dashboard with total open pipeline value, deals won this month, and a simple per-stage breakdown.

This is a shared team tool — every signed-in team member should see the same data, not a private per-user view. Handle the empty state gracefully for a brand-new account with no deals yet.

UI: clean and modern, generous whitespace, clear hierarchy between company/contact/deal levels, subtle hover and drag states on the pipeline board, and a layout that holds up well on tablet as well as desktop.`,
  },
  {
    label: "Feedback board",
    prompt: `Build a public feedback board where users submit ideas and vote on each other's.

Data model: Posts (title, description, author, status, created_at) and one Vote per (user, post) pair — a user can only upvote a post once, and unvoting removes their vote. Status is one of Open, Planned, In Progress, Done.

Screens:
- A main board listing posts, sortable by most votes or newest, filterable by status, with the vote count and an upvote button (filled/highlighted if the current user already voted) on each card.
- A post detail page with the full description, a comment thread (author + timestamp, newest last), and the same vote button.
- A "Submit an idea" form (title + description) for signed-in users.
- Status badges that are color-coded and consistent across the board and detail views.

Anyone signed in can read every post; only the signed-in author can edit or delete their own post. Voting requires being signed in.

UI: a clean, scannable card list, prominent vote counts, and a detail page that reads like a real product-feedback tool (think Canny/Linear feedback boards) — not a bare table.`,
  },
  {
    label: "Realtime chat",
    prompt: `Build a realtime chat app with multiple rooms.

Data model: Rooms (name, created_by) and Messages (room_id, sender, text, created_at). Anyone signed in can create a room and see the list of rooms.

Screens:
- A room list sidebar (name + a hint of the latest message) with a "New room" action.
- An active room view showing the message thread, with new messages from OTHER users appearing live via a realtime subscription — no manual refresh needed.
- A message composer pinned to the bottom that sends on Enter, clears after sending, and auto-scrolls the thread to the newest message.
- Visually distinguish the current user's own messages from everyone else's (e.g. alignment or color), and show sender name/initials plus a timestamp on each message, grouped sensibly when the same sender posts multiple messages in a row.

Assume multiple people are using this at once — the realtime behavior is the whole point, not an afterthought.

UI: a modern chat-bubble layout (think a clean Slack/Discord-style thread), comfortable spacing, and a room sidebar that clearly shows which room is active.`,
  },
  {
    label: "Event RSVPs",
    prompt: `Build an event platform with capacity-limited RSVPs.

Data model: Events (title, description, date/time, location, capacity, organizer) and RSVPs (event_id, user_id, status: going / maybe / declined).

Screens:
- An events list split into Upcoming and Past, each event card showing date, location, and current attendance vs capacity.
- An event detail page with full details, an RSVP control (going/maybe/decline) for the signed-in user, and a live attendee count.
- Once an event reaches capacity, new "going" RSVPs must be blocked at write time (not just hidden in the UI) — show the event as Full and prevent further confirmed RSVPs, independent of what the client sends.
- An organizer view (visible only to the event's own creator) listing all attendees and their RSVP status, and allowing them to edit or cancel their event.

UI: card-based event list with a clear date treatment, a capacity indicator (e.g. "42 / 50 going") that visually signals how full an event is, and clean, obvious RSVP button states (selected vs not).`,
  },
];
