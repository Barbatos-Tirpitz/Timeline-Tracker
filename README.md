
  # Task Timeline Tracker


<p align="center">
  A lightweight, self-hosted task management and timeline tracking application powered by Google Sheets and Google Apps Script.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Active%20Development-blue" alt="Project Status">
  <img src="https://img.shields.io/badge/Backend-Google%20Apps%20Script-orange" alt="Backend">
  <img src="https://img.shields.io/badge/Frontend-HTML%20%7C%20CSS%20%7C%20JavaScript-yellow" alt="Frontend">
  <img src="https://img.shields.io/badge/Storage-Google%20Sheets-green" alt="Storage">
</p>

---

## Overview

Task Timeline Tracker is a general-purpose task management application inspired by project management tools such as Jira.

It combines a spreadsheet-based backend with an interactive web interface, allowing users to organize tasks, monitor progress, manage subtasks, and visualize schedules through a Gantt-style timeline.

The application is designed to be deployed independently. Each user or team can create their own copy of the spreadsheet and deploy their own Google Apps Script web application.

## Preview

<!-- Replace these image paths after adding your screenshots to assets/screenshots/ -->

### Metrics

Get an overview of task progress, workload, and current task statuses.

<img width="1854" height="938" alt="image" src="https://github.com/user-attachments/assets/e8a5142d-3c24-41bf-b427-b7ff01c157bd" />


### Timeline

Visualize task schedules using an interactive Gantt-style timeline. Navigate across dates and reschedule individual tasks by dragging their timeline bars.

<img width="1856" height="932" alt="image" src="https://github.com/user-attachments/assets/5c76a682-3cf7-4688-8d5b-f3cde6056f27" />



### Task Management

Create, update, search, and filter tasks while keeping important task information organized.

<img width="705" height="855" alt="image" src="https://github.com/user-attachments/assets/86b1b19c-f20e-4fdb-8eb9-9cb663323813" />
<img width="704" height="805" alt="image" src="https://github.com/user-attachments/assets/c88d465a-ff1f-47a1-a8a4-b712bf5acd64" />
<img width="698" height="672" alt="image" src="https://github.com/user-attachments/assets/cb00ecea-3017-4c64-a177-4e33eeeafa06" />



### Parent Tasks and Subtasks

Organize complex work into smaller tasks. Expand or collapse subtasks to keep the timeline organized.

---

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

## Hours and Hours Progress

Each subtask stores its own Hours, separate from planned start/end, actual work dates and the calendar-day Duration formula. Enter 0-10,000 hours with up to two decimals. A standalone task can also store its own hours. New subtasks start at zero rather than copying the parent's accumulated hours.

A parent with children shows a read-only sum of all direct subtask hours, even when children are collapsed or filtered out. Timeline labels/tooltips, task details, subtask rows and the sortable Hours column display this total. An existing standalone hours value is retained if that task becomes a parent, but is excluded from its child rollup; it becomes visible again if the task has no children.

**Hours progress** is the hours on Done subtasks divided by total subtask hours, not the percentage of subtask counts. For example, a Done 3-hour child and an unfinished 2-hour child produce 3 / 5 hours and 60%. Zero total hours produces 0%, never a divide-by-zero value. Reopening a child reduces completed hours without erasing its recorded hours. Accessible progress bars appear in the parent details, frozen timeline labels and Hours logged metric. Existing task-count progress remains separate.

Global and dashboard hour metrics sum leaf-task hours once, never both parent rollups and their children. Dashboard date/client filters apply to the leaf records and use the full hierarchy to avoid double counting context parents. These are stored task totals for the selected schedule range, not dated work-session logs or prorated hours.

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

**Due vs Completed** compares leaf-task planned deadlines with actual completion dates. Daily/weekly/biweekly views use day buckets, Monthly uses 7-day buckets, and Yearly uses calendar months. Counts appear as text on keyboard-operable bars; dense charts scroll within their container on mobile. Completion events can be included even when their planned dates were outside the period. Parent containers are excluded from this chart to avoid counting the same work twice.

**Hours by Parent Task** shows the five largest parent/standalone groups by recorded leaf-task hours in the schedule window, with a View work shortcut for the full set. Shared-client tasks count once for the selected client filter; hours are not split or added again for parent rollups. These are stored task totals, not hours worked on each calendar day. Accurate daily time-spent charts require dated time entries, which are not implemented.

**Needs Attention** prioritizes current overdue tasks, blocked work in the schedule window, work due today, and completed scheduled videos with zero recorded hours. It shows at most eight rows, with View all, edit links, quick status changes and leaf-hour saves. Parent totals remain read-only. Actions use the existing write/cooldown guards and one follow-up task refresh.

Tiles and chart bars open All tasks with an explicit Metrics filter and the relevant client/date context. Parent context is retained without including unrelated siblings. The filter reevaluates task changes, can be cleared explicitly, and is removed when ordinary task filters are changed. Returning to Metrics preserves its period/client selection. Review for invoicing carries a selected client and period into an empty invoice draft; it does not mark anything billed or overwrite an unsaved invoice without confirmation.

The task-summary tiles appear only on Timeline. They follow its selected calendar period and task/status/category/client filters, and collapsing subtasks does not change totals. All tasks has no repeated task-summary tiles; Invoices keeps only its separate financial totals. Timeline scrolling does not rebuild summary tiles.

All tasks also offers Weekly/Biweekly/Monthly date presets, a reference date, previous/next period, All dates, and Custom dates. Timeline offers Weekly, Biweekly, and Monthly alongside Day. These are date-window filters; task-field sorting remains available separately.

Biweekly explicitly means 14 days (the requested bi-monthly mode is interpreted as every two weeks, matching the payment cycle), not twice per month or every two months. Weekly and biweekly views start on Monday of the reference week; navigation advances 7 or 14 days respectively. Months and years use calendar boundaries. The default/reset date comes from the spreadsheet timezone. Manual All tasks From/Through edits switch its period to Custom dates. Period changes do not modify task dates, tracked hours or schedules.

The scheduled-scope caption and recorded-hour/blocked metrics use planned-date overlap, including boundaries; invalid or missing planned dates are excluded from that scope. Actual completions use Done status plus the actual completion date. Parents and subtasks are counted separately where shown; a multi-client task counts once. Current status/hour values are not historical snapshots. Changing Metrics periods does not alter Timeline's summary scope, task schedules, or saved invoice copies.

## Date Display

Dates use named English months in task tables, timeline/dashboard ranges, invoice previews/history, and client copies. Wider areas show full names such as January and November; compact areas use Jan, Feb, March, April, May, June, July, Aug, Sep, Oct, Nov, Dec. Narrow timeline columns use compact labels, and printed invoices always use full month names. Full dates remain available in date tooltips.

Native date pickers retain the browser/operating system format, with a readable month-name label alongside the chosen value. Storage, date inputs, filtering and billing calculations continue to use ISO calendar dates internally. This presentation change does not migrate or rewrite saved task/invoice dates.

## Bulk Subtasks

Inside a parent task, enter one subtask name per line to create 1-100 subtasks together (200 characters per name). Empty lines are ignored; repeated names create distinct IDs. New children copy saved parent category, priority, planned dates, and clients, with To Do status. Save pending parent edits before creating children.

Quantity per name multiplies each entered name: two names at quantity three create six subtasks with distinct IDs. The preview and create button show the exact total; the expanded batch cannot exceed 100. Names and quantity remain after creation so another click appends another batch without replacing existing children. Clear names explicitly clears the draft. The panel opens the page containing the first new subtask in status order and reports the resulting total.

Creation, existing subtasks, bulk editing, and collapsed Parent management have separate sections. Bulk-field toggles preserve the creation draft and field focus; the apply action shows the number of fields and selected subtasks.

The subtask panel displays 25 children per page. Selection persists across its pages, is separate from All tasks selection, and resets when changing the selected task or closing the dialog. Select visible never includes another page automatically.

Edit-panel subtasks always sort **To Do > In Progress > Blocked > Done**, with natural task-ID ordering within a status, before pagination. Status updates refresh that order without changing task details. The visible-page checkbox follows the same sorted slice.

Selection checkboxes are 22px with 40px label hit areas. The Select subtasks control offers All subtasks, To Do, In Progress, Blocked and Done; Select matching replaces the selection with every matching child of that parent across all pages. The separate Select visible checkbox selects only the current page. Selection counts explicitly include other pages, and backend scope/deletion checks still apply.

Selected children support status updates, confirmed deletion, and bulk edits to category, priority, clients, hours per subtask, and planned dates. Each edit field has an explicit Apply switch: unchecked fields remain unchanged. Applying Clients replaces assignments; applying an empty selection clears them. A single planned-date edit preserves the other date and is validated against every selected task before writes.

The server checks that every selected task still belongs directly to the chosen parent under the same lock as the write. Bulk transfer is not included. Spreadsheet runtime failures can still leave partial writes; reconciliation reloads data without retrying a mutation.

## Biweekly Invoices

Open **Invoices** in the sidebar or **Open invoices** in Metrics. The invoice workspace is separate from task scheduling: the task Duration column is calendar days and is never treated as billable hours.

### First Setup

1. Open Billing defaults and set your name/business, contact details, currency, hourly rate, payment instructions, and the first date of a 14-day billing cycle.
2. Save the defaults. Initial defaults are USD, a zero hourly rate, and today's spreadsheet date as the cycle anchor; these are placeholders, not an assumed billing agreement.
3. Create a new invoice and choose/type one client. Billing timeline offers Two weeks (start date plus 13 days, inclusive) or Custom dates (your own start/end). The period arrows move by the selected range's length. The default biweekly period is anchored to Billing cycle starts, not twice per calendar month.
4. The app counts matching videos for the client and timeline. Choose Scheduled overlap or Completed in range, select the video source, then Add matching videos to load them together. Enter hours and an hourly rate for each video; the total is the sum of each video's hours multiplied by its hourly rate. Rates default from the most recent saved invoice for that client/currency, or the global default; every line can be overridden. Use up to two decimals for hours and rates. A task may have several clients, but each invoice is explicitly for one client; hours are not automatically allocated, duplicated, or inferred from task dates/status.
5. Set an optional Invoice number and Invoice name, save draft, review the client preview, then Issue invoice when ready. A blank number is allocated automatically. Custom numbers are unique across saved invoices (case-insensitive) and editable while Draft; issued copies remain immutable. Names appear in the client preview, generated PDF, CSV/text copies and export filenames. Positive hours/rates and sender/client details are required for client copies and issuance.

Use **Download PDF** for a client copy without a script link. The PDF is generated directly from invoice data, with page numbering but no app URL or browser header/footer. The app lazily loads integrity-pinned jsPDF 3.0.4 over HTTPS from cdnjs; invoice data is processed locally, not uploaded to that CDN. If loading fails, use Print instead. The separate **Print** command still uses the browser dialog: turn off its **Headers and footers** option to suppress browser-added dates/URLs. Page CSS cannot reliably disable that browser setting. Download CSV and Copy text remain available. Verify the resulting file in your deployed browser before sending it.

The video count/picker uses Video editing tasks for the selected client and timeline. Scheduled overlap includes boundary dates; Completed in range requires Done status and an actual completion date within the range. Unassigned videos are excluded unless Include unassigned is checked. The default source is individual tasks without subtasks, avoiding counting a container parent and its children together; Top-level tasks and All video tasks are explicit alternatives when your records represent videos differently.

Add matching videos preserves existing lines and never duplicates a task already present. New lines have blank hours, not assumed one-hour charges. Changing the timeline or filters confirms before clearing entered lines; cancelling preserves hours/rates. The 100-line limit applies to the resulting invoice. Individual/manual additions remain available. Client copies include the number of video lines and total hours. A video can appear in another period when it has additional billable work; choosing dates does not automatically issue or send an invoice.

### Saved Copies and Status

Invoice readiness is shown above the editor and beside individual line fields. Missing client/sender/dates, missing or invalid descriptions/hours/rates, duplicate video lines, duplicate invoice numbers and an already issued/paid client-period are identified before issuing. Checklist items focus the affected field; duplicate warnings can open the saved invoice after confirmation. Issue invoice is disabled until checks pass, while Save draft remains available for incomplete drafts supported by the backend. The backend still revalidates every save/issue under its lock. Corrected fields update readiness without clearing entries, and existing issued/paid/void copies are labelled as saved copies rather than editable drafts.

Invoices are snapshots of client details, descriptions, hours, rates, currency, and payment notes. Later task edits/deletion and changed defaults do not alter saved copies. Drafts remain editable or deletable. Issued invoices are read-only and can be marked Paid or Void; paid/void snapshots remain in history. Voiding preserves the original and permits a replacement for the same client/period. Only one issued/paid invoice is permitted per client and period. Mark paid records your manual confirmation; the app does not collect or transfer money.

History can be filtered by client and is paginated. Outstanding and paid totals are shown separately by currency, without conversion. Stale invoice/default revisions are rejected rather than silently overwriting another session's changes. Unsaved editors are retained after failures, and ambiguous writes reconcile history without automatic retries. Reopen the saved invoice to resolve a revision conflict; use Reload saved defaults to discard stale default edits explicitly.

The backend lazily creates **Invoice_Master** on the first invoice save and **Invoice_Settings** on the first defaults save. Viewing invoices does not create sheets. These sheets do not modify Task_Master or require extra task columns. Invoice IDs persist across draft retries, invoice numbers are allocated under a script lock, and totals are recalculated server-side with per-line minor-unit rounding. Conflicting sheet headers or malformed snapshots produce errors instead of overwriting data.

This is simple hourly invoicing, not a tax/accounting or automatic time-tracking system. There are no tax/VAT calculations, discounts, foreign-exchange conversion, automatic sending, reminders, or payment processing. The spreadsheet/deployment access controls also govern billing data. Test real Sheets persistence and the deployed browser's print/download permissions before using client copies.

## All Tasks

Leaf tasks/subtasks have inline Hours inputs with explicit Save (or Enter), Unsaved/Check hours state, and disabled unchanged saves. Parent hours remain calculated/read-only. Unsaved inline values survive paging, sorting, filter changes and refreshes until saved; missing tasks or tasks that become parents are pruned. Failed writes retain the draft value, then reconcile task data. Closing/reloading the page warns when unsaved inline values remain.

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

Run the dependency-free Node regression suite from the repository root:

```sh
node --test tests/task-tracker.test.cjs
```

Tests cover grouping, overlap filters, client sorting/serialization, calendar periods, pagination, explicit selection, stale responses, write serialization, scoped bulk validation, inherited batch creation, category migration/backup/rerun safety, status dates, lock release, formula preservation, and injected partial-write failures. Browser checks use a synthetic Apps Script bridge; they do not prove Google Sheets service behavior.

Invoice tests additionally cover 14-day/custom boundaries, client/timeline video counts, source/completion filters, matching-video import, retained manual hours, hourly rounding, invalid amounts, draft/issue validation, immutable snapshots, revision conflicts, duplicate client-period issuance, void/replacement, independent storage/defaults and formula-safe CSV cells. Browser checks exercise draft-to-issued-to-paid, print-only client content and mobile layout using a mock bridge; they do not substitute for live billing verification.

Before production deployment, use a copy of the spreadsheet to verify:

1. Initial load, failed refresh, Retry, and 200/1,000-task timings against real Apps Script executions.
2. Inline/bulk status updates, parent-plus-children deletion, missing IDs, and concurrent updates from two sessions.
3. Duration formulas and actual start/end dates after saves, reopening, and deletion.
4. Day/week/month alignment, scrolling, dragging/cancellation, collapse, resize, and keyboard controls at desktop and mobile widths.
5. The category/client upgrade, legacy sheets, client JSON, parent-scoped batches, and date/client filtering across timezone and calendar boundaries.
6. First invoice/default saves, draft reopening, issued/paid/void copies, concurrent revision conflicts, real PDF printing and CSV downloads. Do not populate production with synthetic invoices.

## Deployment

Update both [App.html](App.html) and [code.gs](code.gs) in the spreadsheet's bound Apps Script project; keep the HTML filename `App`. Test on a spreadsheet copy first and pause normal writes during the production upgrade.

1. For a fresh spreadsheet, run Initialize Task Database. For existing data, use Task Manager > Upgrade Categories, Clients and Hours (with backup) from the spreadsheet menu (reload the spreadsheet to refresh the menu).
2. Confirm the upgrade. It preflights headers/categories/clients/hours, copies Task_Master to a timestamped backup, adds Clients in column O and Hours in P, and maps Graphics to Graphic Design and the other six known legacy categories to Video editing. Existing new-category values remain unchanged. Unknown/blank categories, invalid stored hours or occupied O/P stop the upgrade before migration writes; resolve them explicitly and retry.
3. Check the backup, new headers, migrated categories, formulas, and existing client data. Re-running an already completed upgrade makes no further category changes or backups.
4. Publish a new web-app deployment version with the updated backend and frontend together, then perform the live checks above.

No build-tool packages are required. Generated PDF export uses the lazy-loaded jsPDF CDN dependency described above; task tracking and other exports do not require it. Do not upload the Node tests to Apps Script or populate production with synthetic test tasks. Existing clients remain empty until assigned; no client names are inferred from old task categories.

The HTML requires the deployed Apps Script web app for real task data. Opening it directly shows a connection error rather than providing a standalone backend.

## Later Releases

Broader hierarchy validation, enhanced timeline navigation, Kanban, activity history, and dependencies/milestones remain outside this release.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Google Apps Script |
| Database | Google Sheets |
