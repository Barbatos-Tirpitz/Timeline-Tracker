# Multi Purpose Planner

A self-hosted planning application built with Google Apps Script and Google Sheets. Manage project schedules and tasks, review work metrics, prepare invoices, and record day-to-day expenses in separate workspaces.

Each user or team deploys its own copy of the spreadsheet and bound Apps Script web app.

![Project status: active development](https://img.shields.io/badge/Status-Active%20Development-blue) ![Backend: Google Apps Script](https://img.shields.io/badge/Backend-Google%20Apps%20Script-orange) ![Frontend: HTML, CSS, JavaScript](https://img.shields.io/badge/Frontend-HTML%20%7C%20CSS%20%7C%20JavaScript-yellow) ![Storage: Google Sheets](https://img.shields.io/badge/Storage-Google%20Sheets-green)

## At a glance

- **All tasks:** Search, filter, sort, paginate, and bulk-update tasks.
- **Timeline:** View planned work by day, week, biweekly period, or month; drag task bars to reschedule.
- **Recurring tasks:** Generate independent weekly, biweekly, or monthly task copies through an inclusive end date (up to 100 occurrences).
- **Task hierarchy:** Group subtasks under parent tasks, track their progress and hours, and collapse or expand them in the timeline. The hierarchy supports one subtask level.
- **Metrics:** Review completions, scheduled hours, overdue and blocked work, and period summaries.
- **Invoices:** Prepare and save biweekly or custom-period hourly invoices for clients, then print or export copies.
- **Finance:** Record expenses and earnings, manage recurring forecasts, and compare income and spending by currency.
- **Storage:** Keep task, invoice, expense, earning, and recurring-rule data in separate tabs in your own Google spreadsheet; no build-tool packages are needed.

## Preview

### Metrics

Review task progress, workload, and current status.

<img width="1815" height="953" alt="image" src="https://github.com/user-attachments/assets/17b155ca-0ef9-4aee-87f6-caccfcc6a2fc" />


### Timeline
<img width="1846" height="932" alt="Timeline workspace" src="https://github.com/user-attachments/assets/4386db74-e671-4de9-9a4d-62ad5db8a24f" />

Visualize schedules on a Gantt-style timeline, navigate across dates, and reschedule tasks by dragging their bars.

<img width="1846" height="932" alt="image" src="https://github.com/user-attachments/assets/4386db74-e671-4de9-9a4d-62ad5db8a24f" />


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
| Recurring Tasks | Generate standalone weekly, biweekly, or monthly task occurrences through a chosen date |
| Collapse / Expand | Show or hide subtasks in the timeline |
| Progress Tracking | Monitor task completion and status |
| Search and Filters | Find tasks based on available criteria |
| Metrics Workspace | Period summaries, finish variance, and date-stamped time-entry reports |
| Invoices | Biweekly hourly billing, saved client copies, paid tracking, PDF print and CSV export |
| Finance | Expense, earnings, and recurring ledgers with a per-currency income/spending dashboard |

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

Parent assignment is validated on task creation, subtask creation, bulk selection and transfer. Parents must exist and be top-level; duplicate IDs are rejected by direct row lookups. Deleting a parent requires explicitly selecting all of its subtasks. A subtask with an expected-hours estimate or logged entries cannot be detached, and a top-level task with legacy Hours cannot become a subtask until that stored value is resolved, so hierarchy changes cannot hide or silently activate hours.

## Hours and Hours Progress

Only subtasks can have an expected-hours estimate, separate from actual logged time, planned start/end, actual work dates and the calendar-day Duration formula. Set 0-10,000 expected hours with up to two decimals. New subtasks start at zero; their parent assignment enables the Expected hours input. Top-level tasks cannot have an estimate directly.

Every top-level task shows a read-only total of its direct subtasks, including zero when it has none. This total is consistent in task details, All tasks, Timeline labels/tooltips, Metrics and collapsed/filtered views. Legacy Hours values stored on top-level rows are retained in the sheet but ignored by reads, rollups and metrics; they are never mixed with subtask hours.

**Hours progress** compares actual time-entry hours logged against expected subtask hours, not the percentage of subtask counts or task status. For example, a 3-hour estimate with 2 hours logged produces 2 / 3 hours and 67%. Marking a task Done does not count its estimate as time spent. Zero expected hours produces 0%, never a divide-by-zero value. Accessible progress bars appear in the parent details, frozen timeline labels and expected-hours metric. Existing task-count progress remains separate.

Global and dashboard expected-hour metrics sum leaf-subtask estimates once, never parent rollups. Dashboard date/client filters apply to subtask records and use the full hierarchy to avoid double counting context parents. Actual time spent is the sum of dated entries and is independent of task status.

Dated time entries can be logged from a leaf subtask's edit dialog or from the parent's bulk subtask panel with a work date, hours, and optional note. They are stored in a separate `Time_Entry_Master` sheet and deleted with their task. Entries contribute to actual logged-time progress but do not change expected Hours. Expected Hours remain editable after entries exist. Entries are not automatically added to invoice lines.

Bulk Apply Expected Hours assigns the same chosen estimate to every selected child, leaving unchecked fields unchanged. Estimate-only saves write column P and Updated At only. They never alter timeline bar position/width/height, task dates, Duration formulas or invoice hours. Transfers/deletions change parent rollups on refresh but preserve the estimates of remaining tasks. Invoice line hours and saved invoice snapshots stay independently controlled.

Expected Hours are stored in column P, after Clients in O. Existing/blank estimates read as zero without implicit writes. Before setting estimates on an existing spreadsheet, run **Task Manager > Upgrade Categories, Clients and Hours (with backup)**. The upgrade rejects occupied P, preserves prior task columns/formulas, and creates a backup before adding the header. Deploy both frontend and backend together and verify the upgrade on a copied spreadsheet first.

## Categories and Clients

Task categories are **Graphic Design**, **Video editing**, **Scheduling**, and **Revision**. Clients are a separate optional field: a task may have several clients, or none (Unassigned). Revision is available on create/edit and bulk edits; adding it does not reclassify old tasks automatically.

The Clients control offers reusable suggestions and an Add client action. Client names are trimmed and deduplicated case-insensitively; commas and quotes are valid parts of a name. Each task allows up to 50 client names of up to 100 characters. Suggestions come from current tasks, not a separate client registry.

Client filters in All tasks, timeline, and dashboard match any assigned client. Sorting by Clients uses the alphabetically first client, keeps Unassigned last in either direction, and shows each task once. Parent/child grouping still takes precedence over a global flat sort. New subtasks initially copy saved parent clients; later parent edits or transfers do not overwrite their assignments.

The Clients field is stored as a JSON string array in column O. Blank cells mean no clients. Existing columns A:N retain their positions. Malformed client JSON is reported rather than silently replaced.

Subtask rows display their own client assignments as compact tags, independently of the parent's current clients. Two tags are shown initially; additional names are available in an expandable list. Unassigned appears when a child has no clients, including after clearing clients with bulk edit.

## Metrics and Timeline Summary

The former Dashboard is now the dedicated **Metrics** workspace. Daily, Weekly, Biweekly, Monthly, Yearly, and Custom controls determine its analysis period. Presets use an editable reference date; Custom provides editable inclusive From and Through dates. Previous/next moves by the selected range's length, and Today resets the selected date or custom range. Monthly remains the default. The last period/date/client is remembered locally when browser storage is permitted. These analytics belong inside Metrics rather than repeating at the top of every workspace.

Four actionable tiles show actual completions in the selected period, expected hours and logged actual time on scheduled work, current overdue work for the selected client, and blocked scheduled work. Parent/standalone and subtask counts are separated. Overdue is explicitly **now**, not a historical snapshot of the selected month.

**Planned vs Actual Finish** compares each leaf task completed in the selected period with its planned end date. Each row shows both dates and a text result: a number of days early, on time, or a number of days late. Tasks without either date are excluded. Late finishes appear first, with up to eight rows shown and a View completed action for the full list. Completion is scoped by actual completion date, so the planned end can fall outside the selected period. Parent containers are excluded to avoid counting the same work twice.

**Expected Hours by Parent Task** shows the five largest groups by subtask estimates in the schedule window, with a View work shortcut for the full set. Shared-client subtasks count once for the selected client filter; estimates are not split or added again for parent rollups. **Time logged by date** shows daily entry totals for the selected period and client scope; those entries contribute to actual task and parent progress.

**Needs Attention** prioritizes current overdue tasks, blocked work in the schedule window, work due today, and completed scheduled videos with zero expected subtask hours. It shows at most eight rows, with View all, edit links, quick status changes and expected-hour saves. Top-level tasks link to add or edit subtasks instead of exposing an hour input. Actions use the existing write/cooldown guards and one follow-up task refresh.

Tiles and chart bars open All tasks with an explicit Metrics filter and the relevant client/date context. Parent context is retained without including unrelated siblings. The filter reevaluates task changes, can be cleared explicitly, and is removed when ordinary task filters are changed. Returning to Metrics preserves its period/client selection. Review for invoicing carries a selected client and period into an empty invoice draft; it does not mark anything billed or overwrite an unsaved invoice without confirmation.
### Tasks and scheduling

- Create, update, and delete tasks; organize work with parent tasks and subtasks.
- Track status, category, priority, planned dates, actual work dates, client assignments, and hours.
- Search and filter tasks by available criteria, including status, category, client, priority, and date range.
- Select tasks for bulk status changes, edits, or deletion. Deletion requires explicit selection of subtasks; children are never silently included when a parent is selected.
- View schedule data in day, weekly, biweekly, or monthly periods. Biweekly means a continuous 14-day period.
- Parent task-count progress is based on the proportion of Done subtasks. Parent expected Hours are a read-only sum of direct child estimates.
- Actual time is recorded on leaf tasks and counted once in metrics. Hours progress compares logged time-entry hours with expected subtask Hours, independent of Done status.

### Metrics and reporting

The Metrics workspace provides daily, weekly, biweekly, monthly, and yearly summaries. It includes completion and scheduled-work metrics, charts, and a prioritized “Needs Attention” list. Client and date context is carried into task results opened from metrics.

The Timeline also has task-summary tiles that follow its selected calendar period and task filters. All tasks and Timeline support date ranges and presets.

### Categories and clients

The built-in categories are **Graphic Design**, **Video editing**, **Scheduling**, and **Revision**. Clients are optional and separate from categories; a task can have multiple clients or be unassigned. Client suggestions are reusable, and client names are trimmed and deduplicated without regard to case.

Native date pickers retain the browser/operating system format, with a readable month-name label alongside the chosen value. Storage, date inputs, filtering and billing calculations continue to use ISO calendar dates internally. Task date-only writes are parsed in the spreadsheet time zone and read back in that same zone to avoid off-by-one-day changes when Apps Script and spreadsheet time zones differ. This does not migrate or rewrite saved task/invoice dates.

### Finance Planner

Open the **Finance** group to manage **Expenses**, **Earnings**, and **Recurring** rules, or use **Expense Dashboard** to compare monthly income and spending. The dashboard shows actual earnings, expenses, and net by currency, received/pending income, expense payment status, six-month income-versus-expense trends, category and merchant comparisons, earning-source comparisons, and separate recurring forecasts. A single Refresh Finance action reloads all three Finance ledgers.

Expense and earning records are stored in separate **Expense_Master** and **Earning_Master** worksheets, created on the first successful save to each ledger. Recurring rules are stored in **Recurring_Master**. Opening or refreshing workspaces does not create these sheets. The schemas do not change `Task_Master`, `Invoice_Master`, or invoice settings. Supported currencies include USD, PHP, EUR, GBP, CAD, AUD, JPY, and KRW; JPY and KRW use whole-unit precision. The dashboard can convert display totals to a selectable reporting currency using the latest daily Frankfurter mid-market rates. The source rate date is shown; rates are cached per reporting currency/day, and if a refresh fails the last cached rates are marked stale. Original earning and expense amounts are never rewritten. Receipt links are stored as URLs only; the app does not upload files.

Currency amount and rate inputs reject nonnumeric text, add thousands separators and normalize decimal precision on blur, then pass clean ungrouped numbers to storage. JPY and KRW inputs are whole-unit values; other supported currencies use two decimal places. Descriptions and notes are not reformatted.

Daily rates are fetched server-side from Frankfurter; no API key or transaction details are sent. The bound Apps Script must be authorized for external requests (`UrlFetchApp`) before rates can load. If rate lookup is unavailable, the dashboard falls back to separate native-currency totals. Converted historical totals use the latest daily rate, not a transaction-date historical rate.

Recurring rules support weekly, monthly, quarterly, and yearly forecasts with optional end dates. Forecasts are not posted as transactions and do not change actual earnings or expense totals. Daily reference-rate conversion is for planning and comparison, not live trading or accounting valuation; it does not use transaction-date historical rates. This is a planning prototype, not accounting or tax software; it does not include budgets, reimbursement approvals, receipt uploads, payment processing, or task/client linking. Test persistence, rate authorization, and header validation on a copy of the workbook before using it with production data.

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

Enable the Google Apps Script API for the authorized account. Each run first tests the code, pulls the current remote project (preserving its manifest), removes root files sharing the `App` or `Code` stem with the tracked sources, overlays canonical `App.html` and `code.gs` from GitHub, checks for any remaining same-stem Apps Script filename conflicts, pushes the project, and updates the specified deployment. A missing or invalid secret or remaining conflict fails the workflow before publishing.

## Data and behavior notes

- The spreadsheet is the source of task data. Each deployment can use its own spreadsheet and web app.
- Existing/blank expected hours are treated as zero. Estimates use column P, after Clients in column O; the upgrade should be run before setting estimates on an existing spreadsheet.
- Parent and subtask schedules are independent. Changing a subtask does not change its parent's dates, and status updates do not cascade through the hierarchy.
- In All tasks, parent groups and child lists are paginated separately. Selections persist across pages but are cleared when filters change.
- Invoice data is stored separately in `Invoice_Master` and `Invoice_Settings`, created when invoices or billing defaults are first saved.
- Expense data is stored separately in `Expense_Master`, created on the first successful expense save; reads are non-mutating.
- Earnings are stored in `Earning_Master`; recurring expense and earning forecasts are stored in `Recurring_Master`. Reads are non-mutating, and recurring forecasts never create ledger transactions automatically.

The server checks that every selected task still belongs directly to the chosen parent under the same lock as the write. Bulk transfer is not included. Spreadsheet runtime failures can still leave partial writes; reconciliation reloads data without retrying a mutation.

## Biweekly Invoices

Open **Invoices** in the sidebar or **Open invoices** in Metrics. The invoice workspace is separate from task scheduling: the task Duration column is calendar days and is never treated as billable hours.

### First Setup

1. Open Billing defaults and set your name/business, contact details, currency, hourly rate, payment instructions, and the first date of a 14-day billing cycle.
2. Save the defaults. Initial defaults are USD, a zero hourly rate, and today's spreadsheet date as the cycle anchor; these are placeholders, not an assumed billing agreement.
3. Create a new invoice and type a client name or choose a suggestion. Suggestions come from task client assignments and saved invoice history; new names can be entered directly. Billing timeline offers Two weeks (start date plus 13 days, inclusive) or Custom dates (your own start/end). The period arrows move by the selected range's length. The default biweekly period is anchored to Billing cycle starts, not twice per calendar month.
4. Add each invoice line manually. Enter its description, hours, and hourly rate; task videos are never imported or billed automatically. The total is the sum of each line's hours multiplied by its rate. Rates default from the most recent saved invoice for that client/currency, or the global default; every line can be overridden. Use up to two decimals for hours and rates. A task may have several clients, but each invoice is explicitly for one client; hours are not automatically allocated, duplicated, or inferred from task dates/status.
5. Set an optional Invoice number and Invoice name, save draft, review the client preview, then Issue invoice when ready. A blank number is allocated automatically. Custom numbers are unique across saved invoices (case-insensitive) and editable while Draft; issued copies remain immutable. Names appear in the client preview, generated PDF, CSV/text copies and export filenames. Positive hours/rates and sender/client details are required for client copies and issuance.

Use **Download PDF** for a client copy without a script link. The PDF is generated directly from invoice data, with page numbering but no app URL or browser header/footer. The app lazily loads integrity-pinned jsPDF 3.0.4 over HTTPS from cdnjs; invoice data is processed locally, not uploaded to that CDN. If loading fails, use Print instead. The separate **Print** command still uses the browser dialog: turn off its **Headers and footers** option to suppress browser-added dates/URLs. Page CSS cannot reliably disable that browser setting. Download CSV and Copy text remain available. Verify the resulting file in your deployed browser before sending it.

Changing the client or billing timeline confirms before clearing entered lines; cancelling preserves the draft. The 100-line limit applies to the invoice. The draft preview shows only the total amount; client copies contain the manually entered line items and total. Choosing dates does not automatically issue or send an invoice.

### Saved Copies and Status

Invoice readiness is shown above the editor and beside individual line fields. Missing client/sender/dates, missing or invalid descriptions/hours/rates, duplicate video lines, duplicate invoice numbers and an already issued/paid client-period are identified before issuing. Checklist items focus the affected field; duplicate warnings can open the saved invoice after confirmation. Issue invoice is disabled until checks pass, while Save draft remains available for incomplete drafts supported by the backend. The backend still revalidates every save/issue under its lock. Corrected fields update readiness without clearing entries, and existing issued/paid/void copies are labelled as saved copies rather than editable drafts.

Invoices are snapshots of client details, descriptions, hours, rates, currency, and payment notes. Later task edits/deletion and changed defaults do not alter saved copies. Drafts remain editable or deletable. Issued invoices are read-only and can be marked Paid or Void; paid/void snapshots remain in history. Voiding preserves the original and permits a replacement for the same client/period. Only one issued/paid invoice is permitted per client and period. Mark paid records your manual confirmation; the app does not collect or transfer money.

History can be filtered by client and is paginated. Outstanding and paid totals are shown separately by currency, without conversion. Stale invoice/default revisions are rejected rather than silently overwriting another session's changes. Unsaved editors are retained after failures, and ambiguous writes reconcile history without automatic retries. Reopen the saved invoice to resolve a revision conflict; use Reload saved defaults to discard stale default edits explicitly.

The backend lazily creates **Invoice_Master** on the first invoice save and **Invoice_Settings** on the first defaults save. Viewing invoices does not create sheets. These sheets do not modify Task_Master or require extra task columns. Invoice IDs persist across draft retries, invoice numbers are allocated under a script lock, and totals are recalculated server-side with per-line minor-unit rounding. Conflicting sheet headers or malformed snapshots produce errors instead of overwriting data.

This is simple hourly invoicing, not a tax/accounting or automatic time-tracking system. There are no tax/VAT calculations, discounts, foreign-exchange conversion, automatic sending, reminders, or payment processing. The spreadsheet/deployment access controls also govern billing data. Test real Sheets persistence and the deployed browser's print/download permissions before using client copies.

## All Tasks

Subtasks have inline Expected hours inputs with explicit Save (or Enter), Unsaved/Check state, and disabled unchanged saves. Tasks with logged time show that actual total separately from their estimate. Every top-level task shows calculated/read-only expected subtask hours. Unsaved inline values survive paging, sorting, filter changes and refreshes until saved; missing tasks, top-level tasks, and tasks that become parents are pruned. Failed writes retain the draft value, then reconcile task data. Closing/reloading the page warns when unsaved inline values remain.

Task detail, drag-reschedule, and single-task hour writes include the loaded Updated At version. If another session changes that task first, the server rejects the stale write instead of silently replacing the newer values; refresh/reopen before retrying. This protection does not make Google Sheets writes transactional, and status/deletion/bulk workflows retain their own validation and reconciliation behavior.

- Search by task ID, name, category, description, or client. Filter by status, category, client, priority, and date range.
- Date filters include tasks overlapping the range, including boundary dates. Undated tasks are excluded only when a date filter is active.
- Sort by task ID, name, category, clients, priority, status, start, or end date. Undated tasks sort last in either direction.
- Pages contain 25 parent groups by default (25/50/100 options). Each expanded parent shows up to 25 matching children, with its own child-page controls.
- A matching child keeps its parent visible as context without including nonmatching siblings. Context-only parents cannot be selected or updated inline.
- Parent checkboxes select only that task. The header checkbox selects only the matching rows currently displayed, never collapsed children or other pages. Select tasks offers All matching tasks or one status; its Select matching action explicitly selects all matching records under the current filters, including other pages and collapsed matching rows. It replaces the prior selection and never includes context-only parents that fail the filters.
- Selection persists across pages and collapse changes, clears when filters change, and removes deleted IDs after refresh. The selected count includes selections on other pages.
- Inline status changes and bulk status updates do not cascade through the hierarchy.
- Bulk deletion requires explicit selection of every existing subtask before selecting a parent for deletion. No children are automatically included. The server rechecks this rule before writing, and deletion requires confirmation.

## Loading and Performance

Task dialogs capture a clean form baseline. Closing with Cancel, Escape or the backdrop, opening another task, and switching workspaces ask before discarding task or pending subtask/bulk edits. Cancelling keeps entered values. Calculated parent-hour updates are not considered user edits. Successful main saves mark form fields saved; pending child creation/bulk fields keep the dialog open. Status-only updates preserve other unsaved details. Successfully created/applied reusable templates are not repeatedly treated as unsaved work. Focus returns to the opening control when it is still present.

The frontend shares one task snapshot and renders only the active view. Searches are debounced by 200 ms; filtering, sorting, paging, and switching views do not fetch tasks. The timeline mounts only viewport rows plus an eight-row buffer on each side, and batches geometry reads before inserting bars.

Saving task details and status uses one write request. Each action performs at most one follow-up task refresh. Mutations are serialized in the browser, and stale responses from earlier reads are ignored. Server mutations and category upgrades share a script lock across web-app and spreadsheet-menu execution contexts.

Command buttons cannot issue overlapping writes. A shared guard also rejects an identical command and payload submitted within 700 ms, even if the first write and refresh have already finished. This covers rapid clicks and repeated form submissions; entered names, quantity, selection and edits are preserved. Changed commands can proceed once the pending operation finishes, and the same batch can be deliberately added again after the cooldown. The form remains inactive and shows a busy state through the reconciliation refresh; closing the dialog is available after the write finishes. Calendar navigation and other non-mutating controls are not throttled. This is browser-side protection, not server-side exactly-once execution across tabs, reloads or ambiguous network failures.

Week view uses compact 72px day columns, 54px rows, and 20px bars. Dragging uses measured cell widths, so one column still means one day. The parent subtask panel also keeps mounted rows bounded through pagination. Client and dashboard filters operate on the loaded snapshot without additional server requests. Notifications identify affected tasks and remain visible until clicked or keyboard-dismissed.

A failed refresh keeps the last loaded data and displays Retry. After a write failure, a reconciliation read runs without automatically retrying the write. Further writes remain blocked until that read succeeds or Retry reconnects. A request may have partially succeeded before its failure was reported: Google Sheets does not provide transactional rollback, and locks do not prevent manual spreadsheet edits.

The target workload is 200-1,000 tasks. Local browser checks with 1,000 synthetic tasks mounted 21-29 timeline rows rather than all 1,000. Ten desktop runs at 1440 x 1000 measured timeline rendering at 14 ms median / 27 ms slowest, and task-list rendering at 17 ms / 23 ms. These are local mock-data observations, not before/after benchmarks or live Apps Script latency guarantees.

## Verification
## Development and verification

### Unit tests

The regression suite uses Node's built-in `node:test` runner, `assert`, and VM-based mocks; no test framework or package install is required. `client()` exercises pure frontend logic with a small DOM mock, while the spreadsheet harnesses exercise backend normalization, sheet isolation, locking, revisions, and writes. Keep tests focused on one observable behavior, deterministic, and independent of a live spreadsheet or network service.

The suite covers boundary and invalid inputs, stale revisions, lazy sheet creation, daily FX caching/fallback, zero-decimal currencies, recurring forecast dates, and Finance refresh fan-out. Use descriptive test names and rerun the full suite after changes. To run one area while iterating:

```sh
node --test --test-name-pattern="daily FX rates|recurring monthly and weekly forecasts" tests/task-tracker.test.cjs
```

Mocked tests do not replace integration checks. Verify Apps Script authorization, Frankfurter access, date/time-zone behavior, and persistence on a copy of the workbook before production deployment.

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

Enhanced timeline navigation, activity history, and dependencies/milestones are outside the current release.
