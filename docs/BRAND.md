# Highfy Brand Guide for the Task Tracker (comlead)

> **Revision (Oct 2026): minimalist, mostly grey.** The app is built on a neutral
> base and uses brand colours only to highlight. Where this note conflicts with
> the sections below, this note wins.
>
> - **Base:** warm off-white page (`--canvas` #F5F4F1), white cards with a 1px
>   hairline (`--line` #E8E6E2), 20px radius, no coloured outlines.
> - **Text:** near-black ink (`--ink` #1E1C1A) for headings and body, grey
>   (`--ink-muted` #736F6A) for meta. Headlines and section titles are ink,
>   sentence case, semibold; no ALL CAPS kickers.
> - **Purple** (#7C118C) only for: primary buttons, the active navigation item,
>   "In progress", links, and the one filled hero card per page.
> - **Orange** (#FF8F4B) only for attention: overdue, blocked, urgent, today.
> - **Pills:** To do white with hairline; In progress purple; Blocked orange;
>   Done and Cancelled quiet grey. Priority: Urgent orange, High near-black,
>   Medium grey, Low plain grey text.
> - Sidebar white with a hairline; hover rows and table headers `--subtle`
>   #F2F1EE.
> - Logo, crown and League Spartan are unchanged.

Apply this to the whole app. It translates Highfy's deck design system into web UI rules. When something here conflicts with a generic shadcn/Tailwind default, this file wins.

## 1. Colour tokens

Define these once as CSS variables (and map them into the Tailwind theme and shadcn variables). Never hard-code hex values in components.

| Token | Hex | Role |
|---|---|---|
| `--brand-bg` | `#FAEDFC` | App background (lavender) |
| `--brand-primary` | `#7C118C` | Headlines, primary buttons, active states, links, filled cards |
| `--brand-primary-deep` | `#5C1270` | Hover/pressed state of primary, body text on light backgrounds |
| `--brand-accent` | `#FF8F4B` | Orange. Scarce. See rules below |
| `--brand-muted` | `#E8CDEE` | Secondary text on purple, inactive/greyed states, Done tasks |
| `--brand-panel` | `#EAD9F2` | Light purple panels, sidebar, table header rows, hover rows |
| `--brand-surface` | `#FFFFFF` | Cards, modals, inputs |

Functional colours (not in the deck, needed for an app; use sparingly and only for their meaning):

| Token | Hex | Use only for |
|---|---|---|
| `--danger` | `#C62828` | Destructive actions (delete), form errors |
| `--success` | `#2E7D32` | Success toasts only |

### Orange rules
Orange is never decoration. It marks the one thing that needs attention:
- Overdue tasks (badge and due date text)
- Urgent priority badge
- Unread notification dot
- The single most important number on a dashboard card
- Today's date in calendar view

If orange appears on two unrelated things in the same view, one of them is wrong.

Accessibility: orange `#FF8F4B` is too light for small text on white. Use it as a fill (badge, pill, dot) with `--brand-primary-deep` or white bold text, or for large bold numbers only.

### Status colours
| Status | Treatment |
|---|---|
| To do | Outlined pill, purple border, purple text |
| In progress | Filled purple pill, white text |
| Blocked | Filled orange pill, deep plum text |
| Done | Muted lavender pill, deep plum text; task title in muted style with strikethrough optional |
| Cancelled | Muted lavender outline, muted text |

### Priority
| Priority | Treatment |
|---|---|
| Urgent | Orange filled pill |
| High | Purple filled pill |
| Medium | Purple outlined pill |
| Low | Muted lavender pill |

## 2. Typography

- Font: **League Spartan** everywhere. Load with `next/font/google` (weights 400, 500, 600, 700). Replace any existing Poppins or default font references.
- Bold (600/700) for headings, labels, buttons, numbers. Regular (400) for body.
- **Sentence case** for everything: headings, buttons, menu items, table headers. Never Title Case.
- Page headlines may end with a full stop when they are a statement (e.g. "Your tasks for today."). Navigation labels do not.

| Element | Size (desktop / mobile) | Weight | Colour |
|---|---|---|---|
| Breadcrumb eyebrow | 13px / 12px | 600 | primary |
| Page headline | 32px / 24px | 700 | primary |
| Section kicker | 12px, ALL CAPS, letter-spacing 0.08em | 700 | accent (orange) or primary |
| Card title | 18px / 16px | 600 | primary |
| Body | 15px / 15px | 400 | primary-deep |
| Small/meta (dates, owners) | 13px | 500 | primary-deep at 70% opacity |
| Big stat number | 40px / 32px | 700 | primary, or accent for the one that matters |

## 3. Page chrome

Every page has the same header structure, borrowed from the deck:

1. **Breadcrumb eyebrow**, top-left. Format `Section / Sub-section / Detail`, max four levels. Examples: `Tasks / My tasks`, `Departments / Marketing / SEO`, `Meetings / Commercial / 14 Oct 2026`, `Activity / Ibrar / Today`.
2. **Headline** directly beneath it.
3. **Crown mark**, top-right of the header, small, in orange. I will provide the crown SVG; until then, leave a clearly marked placeholder component (`<CrownMark />`). Do not invent or draw a crown.

On mobile the crown stays, the breadcrumb truncates from the left (keep the last two levels).

## 4. Layout

- Background: `--brand-bg` lavender on every page.
- Content sits on white cards over the lavender, never directly on the background except headers.
- Generous spacing. Desktop page padding 48px, mobile 16px. Card padding 24px desktop, 16px mobile. Gap between cards 24px.
- Sidebar navigation: `--brand-panel` background, active item as filled purple with white text, rounded 12px.
- Mobile first. Every view must work at 375px wide without horizontal scrolling. Tables become stacked cards on mobile.

## 5. Cards

Two treatments, and the difference carries meaning:

- **Outlined card**: white fill, 2px `--brand-primary` border, 20px radius. Default for tasks, meetings, panels.
- **Filled card**: solid `--brand-primary`, no border, 20px radius, white text, the key figure or phrase in orange. Use for the one hero element on a page (e.g. on the CEO dashboard, the "Overdue across company" card).

Use subtle hairline borders (`--brand-panel`) for dense lists and tables instead of heavy outlines, so the outlined card stays meaningful.

Buttons and inputs: 12px radius. Pills and badges: fully rounded.

## 6. Components

- **Primary button**: filled purple, white bold text, hover deep plum.
- **Secondary button**: white with purple 2px border, purple text.
- **Ghost button**: purple text only, panel background on hover.
- **Destructive button**: danger red, used only for delete, always with a confirm dialog.
- **Inputs**: white, 1.5px `--brand-panel` border, purple focus ring.
- **Kanban columns**: `--brand-panel` background, column title as a section kicker with a count.
- **Table header row**: `--brand-panel` background, bold purple text, sentence case.
- **Empty states**: one plain sentence and one button. No illustrations.
- **Icons**: Lucide, 1.75px stroke, purple. No emoji in the UI.

## 7. Dashboard stats

Follow the deck's stat card pattern:
- Small ALL CAPS kicker label, oversized number, one-line plain description underneath.
- In a row of stat cards, one is filled purple (the most important), the rest are outlined white.
- Numbers that need attention (overdue, blocked) can use orange. Everything else stays purple.

## 8. Charts (if any)

- Inside a white rounded card with generous padding.
- Bars step from pale lilac (`--brand-muted`) to full purple. Orange only for the single highlighted bar or value.
- Value labels above bars in bold purple. Hairline grey axes. No gridlines. No legend unless there are two or more series.
- Each chart on the same page uses a different chart type.

## 9. Voice for UI text

Highfy talks like a calm, honest colleague. Plain, specific, a little dry. Never hype.

- Say the plain true thing. "3 tasks overdue." not "Uh oh! Looks like you're falling behind!"
- No exclamation marks, no emoji, no exaggerated cheer.
- Empty states: "Nothing due today." / "No meetings recorded yet."
- Errors: say what happened and what to do. "Couldn't save. Check your connection and try again."
- Confirmations: short. "Task marked done."
- No em dashes anywhere in UI text.
- Sentence case everywhere.

## 10. Dark mode

Not needed for v1. Light theme only. Structure the tokens so a dark theme can be added later.

## 11. Checklist before calling it done

- [ ] All colours come from tokens, no stray hex values
- [ ] League Spartan loaded and applied everywhere
- [ ] Every page has breadcrumb, headline and crown placeholder
- [ ] Orange used only for things that need attention
- [ ] Status and priority pills match the tables above
- [ ] Sentence case and no exclamation marks in UI text
- [ ] Every view checked at 375px wide
