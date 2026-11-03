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

### Dashboard

Get an overview of task progress, workload, and current task statuses.

<img width="1860" height="852" alt="image" src="https://github.com/user-attachments/assets/5ecb103f-3962-4354-bfc9-26ee6585b20e" />

### Timeline

Visualize task schedules using an interactive Gantt-style timeline. Navigate across dates and reschedule individual tasks by dragging their timeline bars.

<img width="1837" height="950" alt="image" src="https://github.com/user-attachments/assets/58271b09-a81e-4ae6-8778-f0c61714633a" />


### Task Management

Create, update, search, and filter tasks while keeping important task information organized.

Work in Progress!!

### Parent Tasks and Subtasks

Organize complex work into smaller tasks. Expand or collapse subtasks to keep the timeline organized.

Work in Progress!!

---

## Features

| Feature | Description |
|---|---|
| Task Management | Create, edit, update, and delete tasks |
| Grouped Task List | Sort and paginate parent groups, with separate pages for large child lists |
| Bulk Actions | Update selected statuses or explicitly selected tasks together |
| Gantt Timeline | Visualize tasks against a calendar |
| Drag Scheduling | Reschedule individual tasks through drag-and-drop |
| Task Hierarchy | Organize work using parent tasks and subtasks |
| Collapse / Expand | Show or hide subtasks in the timeline |
| Progress Tracking | Monitor task completion and status |
| Search and Filters | Find tasks based on available criteria |
| Dashboard | View task statistics and progress summaries |

## Task Hierarchy

The application supports a parent-child task structure.

- Root tasks have no parent identifier.
- Subtasks reference their parent using the Parent Task ID.
- Parent and subtask schedules are independent; changing a child does not change its parent's dates.
- Parent progress is calculated using the proportion of completed subtasks.
- Subtasks can be collapsed or expanded in the timeline.

**Current hierarchy depth:** One subtask level.

## All Tasks

- Search by task ID, name, category, or description. Filter by status, category, priority, and date range.
- Date filters include tasks overlapping the range, including boundary dates. Undated tasks are excluded only when a date filter is active.
- Sort by task ID, name, category, priority, status, start, or end date. Undated tasks sort last in either direction.
- Pages contain 25 parent groups by default (25/50/100 options). Each expanded parent shows up to 25 matching children, with its own child-page controls.
- A matching child keeps its parent visible as context without including nonmatching siblings. Context-only parents cannot be selected or updated inline.
- Parent checkboxes select only that task. The header checkbox selects only the matching rows currently displayed, never collapsed children or other pages.
- Selection persists across pages and collapse changes, clears when filters change, and removes deleted IDs after refresh. The selected count includes selections on other pages.
- Inline status changes and bulk status updates do not cascade through the hierarchy.
- Bulk deletion requires explicit selection of every existing subtask before selecting a parent for deletion. No children are automatically included. The server rechecks this rule before writing, and deletion requires confirmation.

## Loading and Performance

The frontend shares one task snapshot and renders only the active view. Searches are debounced by 200 ms; filtering, sorting, paging, and switching views do not fetch tasks. The timeline mounts only viewport rows plus an eight-row buffer on each side, and batches geometry reads before inserting bars.

Saving task details and status uses one write request. Each action performs at most one follow-up task refresh. Mutations are serialized in the browser, and stale responses from earlier reads are ignored. Server mutations use a document lock, with a script-lock fallback when no document lock is available.

A failed refresh keeps the last loaded data and displays Retry. After a write failure, a reconciliation read runs without automatically retrying the write. Further writes remain blocked until that read succeeds or Retry reconnects. A request may have partially succeeded before its failure was reported: Google Sheets does not provide transactional rollback, and locks do not prevent manual spreadsheet edits.

The target workload is 200-1,000 tasks. Local browser checks with 1,000 synthetic tasks mounted 21-29 timeline rows rather than all 1,000. Ten desktop runs at 1440 x 1000 measured timeline rendering at 14 ms median / 27 ms slowest, and task-list rendering at 17 ms / 23 ms. These are local mock-data observations, not before/after benchmarks or live Apps Script latency guarantees.

## Verification

Run the dependency-free Node regression suite from the repository root:

```sh
node --test tests/task-tracker.test.cjs
```

Tests cover grouping, overlap filters, sorting, pagination, explicit selection, stale responses, write serialization, bulk validation, status dates, lock release/fallback, formula preservation, and injected partial-write failures. Browser checks use a synthetic Apps Script bridge; they do not prove Google Sheets service behavior.

Before production deployment, use a copy of the spreadsheet to verify:

1. Initial load, failed refresh, Retry, and 200/1,000-task timings against real Apps Script executions.
2. Inline/bulk status updates, parent-plus-children deletion, missing IDs, and concurrent updates from two sessions.
3. Duration formulas and actual start/end dates after saves, reopening, and deletion.
4. Day/week/month alignment, scrolling, dragging/cancellation, collapse, resize, and keyboard controls at desktop and mobile widths.

## Deployment

Update both `App.html` and `code.gs` in the spreadsheet's bound Apps Script project. Keep the existing HTML filename `App`, initialize the task database if needed, then publish a new web-app deployment version. No new sheet columns or third-party packages are required. Do not upload the Node tests to Apps Script or populate production with synthetic test tasks.

The HTML requires the deployed Apps Script web app for real task data. Opening it directly shows a connection error rather than providing a standalone backend.

## Later Releases

Broader hierarchy validation, enhanced timeline navigation, Kanban, activity history, and dependencies/milestones remain outside this release.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Google Apps Script |
| Database | Google Sheets |
