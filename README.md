# Multi Purpose Planner

A planning app built with Google Apps Script and Google Sheets. Manage tasks and schedules, review Metrics, create client invoices, and track expenses, earnings, and recurring forecasts.

Each team deploys its own copy of the spreadsheet and bound Apps Script web app.

![Project status: active development](https://img.shields.io/badge/Status-Active%20Development-blue) ![Backend: Google Apps Script](https://img.shields.io/badge/Backend-Google%20Apps%20Script-orange) ![Frontend: HTML%2C%20CSS%2C%20JavaScript](https://img.shields.io/badge/Frontend-HTML%20%7C%20CSS%20%7C%20JavaScript-yellow) ![Storage: Google Sheets](https://img.shields.io/badge/Storage-Google%20Sheets-green)

## Workspaces

- **Tasks and Timeline:** Create, filter, sort, and bulk-edit tasks. Schedule work on a Gantt-style timeline, drag to reschedule, and organize one level of subtasks under parent tasks.
- **Metrics:** Review completions, scheduled hours, blocked work, overdue tasks, and finish variance. Use daily, weekly, biweekly, monthly, yearly, or custom date ranges; client and date filters carry into task drilldowns.
- **Invoices:** Prepare biweekly or custom-period hourly invoices. Type a client name or choose a suggestion, add lines manually, and save drafts or issue copies for PDF/CSV export. Task duration is calendar time, not billable hours.
- **Finance:** Track expenses and earnings, manage recurring forecasts, and compare income and spending by currency. Optional dashboard conversion uses daily Frankfurter exchange rates.

## Screenshots

### Metrics
<img width="1815" height="953" alt="Metrics workspace" src="https://github.com/user-attachments/assets/17b155ca-0ef9-4aee-87f6-caccfcc6a2fc" />

### Timeline
<img width="1846" height="932" alt="Timeline workspace" src="https://github.com/user-attachments/assets/4386db74-e671-4de9-9a4d-62ad5db8a24f" />

## Setup

1. Create or choose a Google spreadsheet and open its bound Apps Script project.
2. Add `App.html` and `code.gs` to the project. Keep the HTML file named `App`.
3. For a new spreadsheet, run **Initialize Task Database**. For an existing spreadsheet, use **Task Manager > Upgrade Categories, Clients and Hours (with backup)**.
4. Review the upgrade backup and verify the data on a copy of the spreadsheet.
5. Deploy the Apps Script project as a web app and open its URL.

Existing task sheets need the upgrade before recording hours. It adds Clients in column O and Hours in column P, backs up `Task_Master`, and maps the legacy `Graphics` category to `Graphic Design`. Do not run upgrades directly on production data before checking a copy.

Opening `App.html` directly does not connect to Apps Script. No local build step or package installation is required.

## Data Notes

- Task, invoice, expense, earning, and recurring records use separate spreadsheet tabs. Finance tabs are created on the first successful save; simply opening a Finance workspace does not create them.
- Tasks support multiple clients and one subtask level. Logged hours belong to subtasks; parent hours are calculated from direct children. Planned duration remains separate from logged and billable hours.
- JPY and KRW use whole-unit precision; other supported currencies use two decimal places. Currency conversion is for display and planning, not accounting valuation. If rate lookup fails, native-currency totals remain available.
- Recurring rules produce forecasts, not transactions. The app does not process payments, upload receipts, calculate tax, or automatically send invoices.
- Google Sheets writes are not transactional. A failed operation may have partially completed; the app reloads data for reconciliation but does not retry the write automatically.

## Tests

Run the dependency-free regression suite from the repository root:

```sh
node --test tests/task-tracker.test.cjs
```

The tests use Node's built-in test runner and mocked spreadsheet/browser APIs. They do not replace integration checks. Verify persistence, date/time-zone behavior, Apps Script permissions, PDF export, and external rate access on a copy of the spreadsheet.

## GitHub Deployment

The workflow in `.github/workflows/deploy-apps-script.yml` runs tests and updates the existing Apps Script deployment on pushes to `main` or `v.9`. Configure these GitHub Actions secrets:

- `CLASP_CREDENTIALS`: authorized clasp credentials JSON.
- `APPS_SCRIPT_ID`: the Apps Script project ID.
- `APPS_SCRIPT_DEPLOYMENT_ID`: the existing web-app deployment ID.

Enable the Google Apps Script API for the authorized account. Treat credentials as secrets; never commit them. Other branches do not deploy automatically.

## Limits

This is a planning prototype, not accounting, tax, payment-processing, or time-tracking software. Frankfurter rates are daily reference rates, not historical transaction rates. Test changes and data upgrades on a workbook copy before production use.