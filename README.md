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

Broader hierarchy validation, enhanced timeline navigation, Kanban, activity history, and dependencies/milestones are outside the current release.
