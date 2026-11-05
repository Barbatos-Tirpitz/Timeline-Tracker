# Task Timeline Tracker

A self-hosted task management and timeline application built with Google Apps Script and Google Sheets. Track work in a sortable task list, plan schedules on a Gantt-style timeline, organize tasks into parent/subtask groups, and review workload in the Metrics workspace.

Each user or team deploys its own copy of the spreadsheet and bound Apps Script web app.

![Project status: active development](https://img.shields.io/badge/Status-Active%20Development-blue) ![Backend: Google Apps Script](https://img.shields.io/badge/Backend-Google%20Apps%20Script-orange) ![Frontend: HTML, CSS, JavaScript](https://img.shields.io/badge/Frontend-HTML%20%7C%20CSS%20%7C%20JavaScript-yellow) ![Storage: Google Sheets](https://img.shields.io/badge/Storage-Google%20Sheets-green)

## At a glance

- **All tasks:** Search, filter, sort, paginate, and bulk-update tasks.
- **Timeline:** View planned work by day, week, biweekly period, or month; drag task bars to reschedule.
- **Task hierarchy:** Group subtasks under parent tasks, track their progress and hours, and collapse or expand them in the timeline. The hierarchy supports one subtask level.
- **Metrics:** Review completions, scheduled hours, overdue and blocked work, and period summaries.
- **Invoices:** Prepare and save biweekly or custom-period hourly invoices for clients, then print or export copies.
- **Storage:** Keep task data in your own Google spreadsheet; no build-tool packages are needed.

## Preview

### Metrics

Review task progress, workload, and current status.

<img width="1854" height="938" alt="Metrics workspace" src="https://github.com/user-attachments/assets/e8a5142d-3c24-41bf-b427-b7ff01c157bd" />

### Timeline

Visualize schedules on a Gantt-style timeline, navigate across dates, and reschedule tasks by dragging their bars.

<img width="1856" height="932" alt="Timeline workspace" src="https://github.com/user-attachments/assets/5c76a682-3cf7-4688-8d5b-f3cde6056f27" />

### Task management

Create, edit, search, and filter tasks while keeping their details organized.

<img width="705" height="855" alt="Task details" src="https://github.com/user-attachments/assets/86b1b19c-f20e-4fdb-8eb9-9cb663323813" />
<img width="704" height="805" alt="Task management" src="https://github.com/user-attachments/assets/c88d465a-ff1f-47a1-a8a4-b712bf5acd64" />
<img width="698" height="672" alt="Task management" src="https://github.com/user-attachments/assets/cb00ecea-3017-4c64-a177-4e33eeeafa06" />

## Features

| Feature | Description |
|---|---|
| Task Management | Create, edit, update, and delete tasks |
| Grouped Task List | Sort and paginate parent groups, with separate pages for large child lists |
| Bulk Actions | Update selected statuses or explicitly selected tasks together |
| Bulk Subtasks | Create, update, and delete selected children from the parent task panel |
| Client Assignments | Assign multiple clients independently of task categories |
| Subtask Client Tags | Display each child's clients, Unassigned, and expandable additional names |
| Gantt Timeline | Visualize tasks against a calendar |
| Drag Scheduling | Reschedule individual tasks through drag-and-drop |
| Task Hierarchy | Organize work using parent tasks and subtasks |
| Collapse / Expand | Show or hide subtasks in the timeline |
| Progress Tracking | Monitor task completion and status |
| Search and Filters | Find tasks based on available criteria |
| Metrics Workspace | Daily, weekly, biweekly, monthly, and yearly task/hour summaries |
| Invoices | Biweekly hourly billing, saved client copies, paid tracking, PDF print and CSV export |

## Interface and Accessibility

The interface uses shared spacing, typography, control, focus, and layering styles across its workspaces. Controls and selection targets have larger hit areas, the mobile navigation keeps visible labels, and keyboard focus remains visible. The task editor uses a labelled native dialog with guarded dismissal and contained keyboard focus. Loading states announce progress, reduced-motion preferences are respected, and invoice field errors appear after interaction while readiness checks continue to prevent invalid issuance.

The UI refinements were informed by the [UI Design Cheat Sheet](https://www.designyourway.net/cs/ui-design-cheat-sheet/). They preserve the existing light theme, timeline geometry, status ordering, and manually dismissed notifications. These improvements are not a claim of full WCAG conformance.

## Task Hierarchy

The application supports a parent-child task structure.

- Root tasks have no parent identifier.
- Subtasks reference their parent using the Parent Task ID.
- Parent and subtask schedules are independent; changing a child does not change its parent's dates.
- Parent progress is calculated using the proportion of completed subtasks.
- Subtasks can be collapsed or expanded in the timeline.

**Current hierarchy depth:** One subtask level.

Parent assignment is validated on task creation, subtask creation, bulk selection and transfer. Parents must exist and be top-level; duplicate IDs are rejected by direct row lookups. Deleting a parent requires explicitly selecting all of its subtasks. A subtask with logged hours cannot be detached, and a top-level task with legacy Hours cannot become a subtask until that stored value is resolved, so hierarchy changes cannot hide or silently activate hours.

## Hours and Hours Progress

Only subtasks can store logged Hours, separate from planned start/end, actual work dates and the calendar-day Duration formula. Enter 0-10,000 hours with up to two decimals. New subtasks start at zero; their parent assignment enables the Hours input. Top-level tasks cannot log hours directly.

Every top-level task shows a read-only total of its direct subtasks, including zero when it has none. This total is consistent in task details, All tasks, Timeline labels/tooltips, Metrics and collapsed/filtered views. Legacy Hours values stored on top-level rows are retained in the sheet but ignored by reads, rollups and metrics; they are never mixed with subtask hours.

**Hours progress** is the hours on Done subtasks divided by total subtask hours, not the percentage of subtask counts. For example, a Done 3-hour child and an unfinished 2-hour child produce 3 / 5 hours and 60%. Zero total hours produces 0%, never a divide-by-zero value. Reopening a child reduces completed hours without erasing its recorded hours. Accessible progress bars appear in the parent details, frozen timeline labels and Hours logged metric. Existing task-count progress remains separate.

Global and dashboard hour metrics sum subtask hours once, never parent rollups. Dashboard date/client filters apply to subtask records and use the full hierarchy to avoid double counting context parents. These are stored task totals for the selected schedule range, not dated work-session logs or prorated hours.

Bulk Apply Hours assigns the same chosen value to every selected child, leaving unchecked fields unchanged. Hours-only saves write column P and Updated At only. They never alter timeline bar position/width/height, task dates, Duration formulas or invoice hours. Transfers/deletions change parent rollups on refresh but preserve the hours of remaining tasks. Invoice line hours and saved invoice snapshots stay independently controlled.

Hours is stored in column P, after Clients in O. Existing/blank task hours read as zero without implicit writes. Before recording hours on an existing spreadsheet, run **Task Manager > Upgrade Categories, Clients and Hours (with backup)**. The upgrade rejects occupied P, preserves prior task columns/formulas, and creates a backup before adding the header. Deploy both frontend and backend together and verify the upgrade on a copied spreadsheet first.

## Categories and Clients

Task categories are **Graphic Design**, **Video editing**, **Scheduling**, and **Revision**. Clients are a separate optional field: a task may have several clients, or none (Unassigned). Revision is available on create/edit and bulk edits; adding it does not reclassify old tasks automatically.

The Clients control offers reusable suggestions and an Add client action. Client names are trimmed and deduplicated case-insensitively; commas and quotes are valid parts of a name. Each task allows up to 50 client names of up to 100 characters. Suggestions come from current tasks, not a separate client registry.

Client filters in All tasks, timeline, and dashboard match any assigned client. Sorting by Clients uses the alphabetically first client, keeps Unassigned last in either direction, and shows each task once. Parent/child grouping still takes precedence over a global flat sort. New subtasks initially copy saved parent clients; later parent edits or transfers do not overwrite their assignments.

The Clients field is stored as a JSON string array in column O. Blank cells mean no clients. Existing columns A:N retain their positions. Malformed client JSON is reported rather than silently replaced.

Subtask rows display their own client assignments as compact tags, independently of the parent's current clients. Two tags are shown initially; additional names are available in an expandable list. Unassigned appears when a child has no clients, including after clearing clients with bulk edit.

## Metrics and Timeline Summary

The former Dashboard is now the dedicated **Metrics** workspace. Sticky Daily, Weekly, Biweekly, Monthly, and Yearly controls, reference date, previous/next arrows, Today, and client filter determine its analysis period. Monthly remains the default. The last period/date/client is remembered locally when browser storage is permitted. These analytics belong inside Metrics rather than repeating at the top of every workspace.

Four actionable tiles show actual completions in the selected period, recorded hours on scheduled work, current overdue work for the selected client, and blocked scheduled work. Parent/standalone and subtask counts are separated. Overdue is explicitly **now**, not a historical snapshot of the selected month.

**Planned vs Actual Finish** compares each leaf task completed in the selected period with its planned end date. Each row shows both dates and a diverging variance bar centered on On time: early finishes extend left and late finishes extend right, with an explicit day difference label. Tasks without either date are excluded. Late finishes appear first, with up to eight rows shown and a View completed action for the full list. Completion is scoped by actual completion date, so the planned end can fall outside the selected period. Parent containers are excluded to avoid counting the same work twice.

**Hours by Parent Task** shows the five largest groups by recorded subtask hours in the schedule window, with a View work shortcut for the full set. Shared-client subtasks count once for the selected client filter; hours are not split or added again for parent rollups. These are stored task totals, not hours worked on each calendar day. Accurate daily time-spent charts require dated time entries, which are not implemented.

**Needs Attention** prioritizes current overdue tasks, blocked work in the schedule window, work due today, and completed scheduled videos with zero recorded subtask hours. It shows at most eight rows, with View all, edit links, quick status changes and subtask-hour saves. Top-level tasks link to add or edit subtasks instead of exposing an hour input. Actions use the existing write/cooldown guards and one follow-up task refresh.

Tiles and chart bars open All tasks with an explicit Metrics filter and the relevant client/date context. Parent context is retained without including unrelated siblings. The filter reevaluates task changes, can be cleared explicitly, and is removed when ordinary task filters are changed. Returning to Metrics preserves its period/client selection. Review for invoicing carries a selected client and period into an empty invoice draft; it does not mark anything billed or overwrite an unsaved invoice without confirmation.
### Tasks and scheduling

- Create, update, and delete tasks; organize work with parent tasks and subtasks.
- Track status, category, priority, planned dates, actual work dates, client assignments, and hours.
- Search and filter tasks by available criteria, including status, category, client, priority, and date range.
- Select tasks for bulk status changes, edits, or deletion. Deletion requires explicit selection of subtasks; children are never silently included when a parent is selected.
- View schedule data in day, weekly, biweekly, or monthly periods. Biweekly means a continuous 14-day period.
- Parent progress is based on the proportion of completed subtasks. Parent hours are a read-only sum of direct child hours; standalone tasks can also record hours.
- Hours are recorded on leaf tasks and counted once in metrics. Hours progress for a parent is based on completed-subtask hours divided by total subtask hours.

### Metrics and reporting

The Metrics workspace provides daily, weekly, biweekly, monthly, and yearly summaries. It includes completion and scheduled-work metrics, charts, and a prioritized “Needs Attention” list. Client and date context is carried into task results opened from metrics.

The Timeline also has task-summary tiles that follow its selected calendar period and task filters. All tasks and Timeline support date ranges and presets.

### Categories and clients

The built-in categories are **Graphic Design**, **Video editing**, **Scheduling**, and **Revision**. Clients are optional and separate from categories; a task can have multiple clients or be unassigned. Client suggestions are reusable, and client names are trimmed and deduplicated without regard to case.

### Invoices

Invoices are separate from task scheduling: task Duration is measured in calendar days and is not billable time. Create hourly invoices for a two-week cycle or custom dates, add matching video-editing tasks for a client, review and save a draft, then issue the invoice when ready. Saved invoices are snapshots, so later task or billing-default changes do not change existing copies.

Invoice history tracks outstanding, paid, and void invoices. Copies can be printed as PDF or exported as CSV. Invoicing is a basic hourly workflow; it does not calculate taxes, discounts, foreign exchange, or track time automatically.

## Deploy

Test upgrades and deployment on a **copy** of your spreadsheet before using production data.

1. Create or choose a Google spreadsheet for the application.
2. In the spreadsheet's bound Apps Script project, add/update both [`App.html`](App.html) and [`code.gs`](code.gs). Keep the HTML filename `App`.
3. For a fresh spreadsheet, run **Initialize Task Database**. For an existing spreadsheet, use **Task Manager → Upgrade Categories, Clients and Hours** from the spreadsheet menu. Reload the spreadsheet first if the menu is not visible.
4. Review the upgrade backup and verify the headers, migrated categories, formulas, and client data. The upgrade creates a timestamped backup of `Task_Master`, adds Clients in column O and Hours in column P, and maps the legacy `Graphics` category to `Graphic Design`.
5. Publish a new web-app deployment version with the updated backend and frontend together, then verify the app using the checklist below.

No build-tool packages are required. The PDF export lazily loads jsPDF from a CDN. The task interface needs the deployed Apps Script web app for real data; opening `App.html` directly does not provide a backend.

### Automatic GitHub Deployment

The workflow at `.github/workflows/deploy-apps-script.yml` runs the Node regression suite and then updates the existing Apps Script web-app deployment on pushes to `main` or `v.9`. It preserves the deployment ID, so the web-app URL does not change. Other branches do not deploy automatically; the workflow can also be started manually on either deployment branch.

Configure these repository **Actions secrets** once:

- `CLASP_CREDENTIALS`: the complete JSON contents of the authorized user's `~/.clasprc.json`. Install clasp and run `clasp login` locally to create it. Treat this as a password; never commit or print it.
- `APPS_SCRIPT_ID`: the Script ID from the bound Apps Script project's Project Settings.
- `APPS_SCRIPT_DEPLOYMENT_ID`: the existing web-app deployment ID from Apps Script **Deploy → Manage deployments**.

Enable the Google Apps Script API for the authorized account. Each run first tests the code, pulls the current remote project (preserving its manifest), overlays `App.html` and `code.gs` from GitHub, pushes the project, and updates the specified deployment. A missing or invalid secret fails the workflow without publishing.

## Data and behavior notes

- The spreadsheet is the source of task data. Each deployment can use its own spreadsheet and web app.
- Existing/blank task hours are treated as zero. Hours use column P, after Clients in column O; the upgrade should be run before recording hours on an existing spreadsheet.
- Parent and subtask schedules are independent. Changing a subtask does not change its parent's dates, and status updates do not cascade through the hierarchy.
- In All tasks, parent groups and child lists are paginated separately. Selections persist across pages but are cleared when filters change.
- Invoice data is stored separately in `Invoice_Master` and `Invoice_Settings`, created when invoices or billing defaults are first saved.

## Development and verification

Run the dependency-free Node regression suite from the repository root:

```sh
node --test tests/task-tracker.test.cjs
```

Before production deployment, use a spreadsheet copy to check initial load and refresh recovery, task edits and bulk operations, date and timeline behavior at desktop and mobile widths, and category/client/hour upgrades. Also verify invoice creation, draft reopening, issued/paid/void copies, PDF printing, and CSV downloads. Do not populate production with synthetic invoices.

The intended workload is approximately 200–1,000 tasks. Validate performance with real Apps Script executions and your own spreadsheet before relying on that range.

## Technology

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Google Apps Script |
| Data store | Google Sheets |

## Planned work

Enhanced timeline navigation, Kanban, activity history, and dependencies/milestones are outside the current release.
