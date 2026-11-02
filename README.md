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
- Parent schedules are derived from the earliest child start date and latest child end date.
- Parent progress is calculated using the proportion of completed subtasks.
- Subtasks can be collapsed or expanded in the timeline.

**Current hierarchy depth:** One subtask level.

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript |
| Backend | Google Apps Script |
| Database | Google Sheets |
