const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const backend = fs.readFileSync(path.join(root, 'code.gs'), 'utf8');
const html = fs.readFileSync(path.join(root, 'App.html'), 'utf8');

function client() {
  const elements = new Map();
  const context = vm.createContext({
    document: {
      querySelectorAll: () => [], addEventListener() {},
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, { innerHTML: '', value: '', addEventListener() {} });
        return elements.get(id);
      }
    },
    window: { addEventListener() {} },
    console, setTimeout, clearTimeout
  });
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1].replace(/\s*loadTasks\(\);\s*$/, '');
  vm.runInContext(script, context);
  vm.runInContext('getState = () => state;', context);
  context.elements = elements;
  return context;
}

function loadingClient() {
  const context = client();
  context.calls = [];
  context.renders = [];
  vm.runInContext(`
    updateDataNotice = () => {};
    updateCategories = () => {};
    renderStats = () => {};
    renderActiveView = () => renders.push(state.activeView);
    renderTaskTable = () => {};
    google = { script: { get run() {
      let success, failure;
      const runner = new Proxy({}, { get(target, method) {
        if (method === 'withSuccessHandler') return callback => { success = callback; return runner; };
        if (method === 'withFailureHandler') return callback => { failure = callback; return runner; };
        return (...args) => calls.push({ method, args, success, failure });
      }});
      return runner;
    }}};
    getState = () => state;
  `, context);
  return context;
}

test('refresh failure keeps last data and renders only the active view', () => {
  const app = loadingClient();
  const state = app.getState();
  state.activeView = 'tasks';
  app.loadTasks();
  app.calls[0].success({ success: true, tasks: [{ taskId: 'VID-1', taskName: 'First' }] });
  assert.equal(state.tasks.length, 1);
  app.loadTasks();
  app.calls[1].failure(new Error('Offline'));
  assert.equal(state.tasks[0].name, 'First');
  assert.equal(state.error, 'Offline');
  assert.ok(app.renders.every(view => view === 'tasks'));
});

test('opening outside Apps Script produces a recoverable connection error', () => {
  const app = loadingClient();
  vm.runInContext('google = undefined;', app);
  app.loadTasks();
  assert.equal(app.getState().loading, false);
  assert.match(app.getState().error, /Apps Script connection unavailable/);
});

test('mutation invalidates prior read, blocks concurrent writes, reconciles after failure without retrying writes', () => {
  const app = loadingClient();
  const state = app.getState();
  state.loaded = true;
  app.loadTasks();
  let failures = 0;
  const run = () => app.mutationRunner().withFailureHandler(() => failures++).updateTaskStatuses(['VID-1'], 'Done');
  run();
  run();
  assert.equal(app.calls.length, 2);
  assert.equal(failures, 1);
  app.calls[0].success({ success: true, tasks: [{ taskId: 'OLD' }] });
  assert.equal(state.tasks.length, 0);
  app.calls[1].failure(new Error('Write timed out'));
  assert.equal(app.calls[2].method, 'getTasks');
  assert.equal(state.syncing, true);
  app.calls[2].success({ success: true, tasks: [{ taskId: 'VID-1' }] });
  assert.equal(state.syncing, false);
  assert.equal(state.tasks[0].id, 'VID-1');
  assert.equal(failures, 2);
});

function listTask(id, parentTaskId = '', overrides = {}) {
  return { id, name: id, parentTaskId, category: 'Editing', priority: 'Medium', status: 'To Do', description: '', ...overrides };
}

test('toast labels identify tasks and keep bulk summaries bounded', () => {
  const app = client();
  const tasks = [listTask('VID-001', '', { name: 'Opening sequence' }), listTask('VID-002'), listTask('VID-003')];
  assert.equal(app.taskLabel(tasks[0]), '"Opening sequence" (VID-001)');
  assert.equal(app.taskSummary(tasks.slice(0, 1)), '"Opening sequence" (VID-001)');
  assert.equal(app.taskSummary(tasks), '3 tasks: "Opening sequence" (VID-001), "VID-002" (VID-002) and 1 more');
  assert.equal(app.taskLabel({ id: 'VID-004' }), '"Untitled task" (VID-004)');
});

test('toast persists without timers, fades only after dismissal, and preserves a newer message', () => {
  const app = client();
  const classes = new Set();
  const toast = {
    style: {},
    classList: {
      add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name)
    }
  };
  app.elements.set('toast', toast);
  let timers = 0;
  app.setTimeout = () => { timers++; };
  app.showToast('First change');
  assert.equal(timers, 0);
  assert.equal(toast.style.display, 'block');
  app.dismissToast();
  assert.equal(classes.has('dismissing'), true);
  assert.equal(toast.style.display, 'block');
  app.finishToastDismiss({ animationName: 'toast-out' });
  assert.equal(toast.style.display, 'none');
  app.showToast('Second change');
  app.dismissToast();
  app.showToast('Newest change');
  app.finishToastDismiss({ animationName: 'toast-out' });
  assert.equal(toast.style.display, 'block');
  assert.equal(app.elements.get('toastMessage').textContent, 'Newest change');
  assert.equal(classes.has('dismissing'), false);
});

test('status and deletion toasts capture task identity before asynchronous changes', () => {
  const app = loadingClient();
  app.messages = [];
  vm.runInContext('showToast = message => messages.push(message); confirm = () => true;', app);
  const state = app.getState();
  state.loaded = true;
  const task = listTask('VID-001', '', { name: 'Opening sequence' });
  state.tasks = [task];
  state.taskById.set(task.id, task);
  app.updateSelectedStatuses([task.id], 'Done');
  task.name = 'Renamed during request';
  app.calls[0].success({ success: true, changed: 1 });
  assert.equal(app.messages[0], 'Status set to Done: "Opening sequence" (VID-001).');
  app.calls[1].success({ success: true, tasks: [{ taskId: 'VID-001', taskName: 'Opening sequence' }] });
  state.list.selected.add('VID-001');
  app.deleteSelectedTasks();
  state.taskById.clear();
  app.calls[2].success({ success: true });
  assert.equal(app.messages[1], 'Deleted "Opening sequence" (VID-001).');
});

test('date filters include overlap and boundaries, exclude missing or inverted dates', () => {
  const app = client();
  const task = listTask('VID-001', '', { start: new Date(2026, 10, 1), end: new Date(2026, 10, 5) });
  assert.equal(app.taskMatches(task, { from: '2026-11-05', to: '2026-11-06' }), true);
  assert.equal(app.taskMatches(task, { from: '2026-11-06' }), false);
  assert.equal(app.taskMatches(listTask('missing'), { to: '2026-11-06' }), false);
  assert.equal(app.taskMatches(listTask('missing'), {}), true);
  assert.equal(app.taskMatches({ ...task, end: new Date(2026, 9, 1) }, { to: '2026-11-06' }), false);
  assert.equal(app.taskMatches(task, { from: '2026-11-05', to: '2026-11-01' }), false);
});

test('sorting is natural, rank-based, stable and puts missing dates last in both directions', () => {
  const app = client();
  assert.ok(app.compareTasks(listTask('VID-2'), listTask('VID-10'), 'id', 1) < 0);
  assert.ok(app.compareTasks(listTask('VID-1', '', { priority: 'High' }), listTask('VID-2', '', { priority: 'Low' }), 'priority', -1) < 0);
  for (const direction of [1, -1]) {
    assert.ok(app.compareTasks(listTask('VID-1'), listTask('VID-2', '', { start: new Date() }), 'start', direction) > 0);
    assert.ok(app.compareTasks(listTask('VID-2'), listTask('VID-10'), 'category', direction) < 0);
  }
});

test('matching children include parent context but not unmatched siblings; orphans remain visible', () => {
  const app = client();
  const tasks = [listTask('VID-1'), listTask('VID-2', 'VID-1', { status: 'Done' }), listTask('VID-3', 'VID-1'), listTask('VID-4', 'missing', { status: 'Done' })];
  const result = app.taskGroups(tasks, { status: 'Done' }, 'id', 1);
  assert.equal(result.matchingCount, 2);
  assert.equal(result.groups.length, 2);
  assert.equal(result.groups[0].contextOnly, true);
  assert.equal(result.groups[0].children.length, 1);
  assert.equal(result.groups[1].root.id, 'VID-4');
});

test('bulk deletion eligibility never implicitly selects children', () => {
  const app = client();
  const tasks = [listTask('VID-1'), listTask('VID-2', 'VID-1'), listTask('VID-3', 'VID-1')];
  assert.equal(app.deletionBlocker(['VID-1', 'VID-2'], tasks).id, 'VID-3');
  assert.equal(app.deletionBlocker(['VID-1', 'VID-2', 'VID-3'], tasks), undefined);
  assert.equal(app.deletionBlocker(['VID-2'], tasks), undefined);
});

test('timeline window is bounded for 1,000 tasks and clamps empty and final rows', () => {
  const app = client();
  for (const height of [54, 70]) {
    for (const scroll of [0, 10000, 54000, 70000]) {
      const window = app.timelineWindow(1000, scroll, 500, height, 59);
      assert.ok(window.start >= 0 && window.end <= 1000);
      assert.ok(window.end - window.start <= Math.ceil(500 / height) + 16);
    }
  }
  assert.equal(app.timelineWindow(0, 1000, 500, 54, 59).end, 0);
});

test('flat grouped pagination clamps after removal and selection persists across pages', () => {
  const app = client();
  const state = app.getState();
  state.loaded = true;
  state.activeView = 'tasks';
  state.tasks = Array.from({ length: 1000 }, (_, index) => listTask('VID-' + (index + 1)));
  state.taskById = new Map(state.tasks.map(task => [task.id, task]));
  app.renderTaskTable();
  assert.equal(state.list.visibleIds.length, 25);
  app.selectVisibleTasks(true);
  state.list.page = 2;
  app.renderTaskTable();
  assert.equal(state.list.selected.size, 25);
  app.selectVisibleTasks(true);
  assert.equal(state.list.selected.size, 50);
  state.list.page = 999;
  app.renderTaskTable();
  assert.equal(state.list.page, 40);
  state.tasks = state.tasks.slice(0, 10);
  app.renderTaskTable();
  assert.equal(state.list.page, 1);
});

test('large child groups have independent pages; context and collapsed rows are not selected implicitly', () => {
  const app = client();
  const state = app.getState();
  state.loaded = true;
  state.activeView = 'tasks';
  state.tasks = [listTask('VID-1'), ...Array.from({ length: 999 }, (_, index) => listTask('VID-' + (index + 2), 'VID-1', { status: 'Done' }))];
  state.taskById = new Map(state.tasks.map(task => [task.id, task]));
  state.list.filters.status = 'Done';
  app.renderTaskTable();
  assert.equal(state.list.visibleIds.length, 25);
  assert.equal(state.list.visibleIds.includes('VID-1'), false);
  app.selectVisibleTasks(true);
  app.changeChildPage('VID-1', 1);
  assert.equal(state.list.selected.size, 25);
  assert.equal(state.list.visibleIds[0], 'VID-27');
  app.toggleListGroup('VID-1');
  assert.equal(state.list.visibleIds.length, 0);
  app.selectVisibleTasks(true);
  assert.equal(state.list.selected.size, 25);
  app.changeTaskFilters();
  assert.equal(state.list.selected.size, 0);
  assert.equal(state.list.childPages.get('VID-1'), undefined);
});

function taskRow(id, parent = '', status = 'To Do') {
  return [id, id, 'Video editing', 'Medium', status, '', '', '=G2-F2+1', '', '', '', '', '', parent, '[]'];
}

function server(records, missingSheet = false, failAfter = Infinity, documentLock = true) {
  const headers = ['Task ID', 'Task Name', 'Category', 'Priority', 'Status', 'Start Date', 'End Date', 'Duration', 'Description', 'Actual Start', 'Actual End', 'Created At', 'Updated At', 'Parent Task ID', 'Clients'];
  const rows = [headers, ...records.map(row => row.slice())];
  let maxColumns = 15;
  const writes = [];
  const backups = [];
  let releases = 0;
  const sheet = {
    getLastRow: () => rows.length,
    getMaxColumns: () => maxColumns,
    getMaxRows: () => 10000,
    insertColumnsAfter(column, count) { maxColumns += count; },
    copyTo() { backups.push(rows.map(row => row.slice())); return { setName() {} }; },
    getRange(row, column, height = 1, width = 1) {
      return {
        getValues: () => Array.from({ length: height }, (_, offset) => Array.from({ length: width }, (_, index) => rows[row - 1 + offset]?.[column - 1 + index] ?? '')),
        getValue: () => rows[row - 1]?.[column - 1] ?? '',
        getDisplayValues: () => rows.slice(row - 1, row - 1 + height).map(values => values.slice(column - 1, column - 1 + width).map(String)),
        setValues(values) {
          if (writes.length === failAfter) throw new Error('Injected write failure');
          writes.push({ row, column, values });
          values.forEach((valuesRow, offset) => valuesRow.forEach((value, index) => {
            if (!rows[row - 1 + offset]) rows[row - 1 + offset] = Array(15).fill('');
            rows[row - 1 + offset][column - 1 + index] = value;
          }));
          return this;
        },
        setValue(value) { return this.setValues([[value]]); },
        setNumberFormat() { return this; }
      };
    },
    deleteRows(row, count) {
      if (writes.length === failAfter) throw new Error('Injected write failure');
      writes.push({ delete: row, count }); rows.splice(row - 1, count);
    }
  };
  const ui = { answer: 'YES', Button: { YES: 'YES' }, ButtonSet: { YES_NO: 'YES_NO' }, alert() { return this.answer; } };
  const spreadsheet = { getSheetByName: () => missingSheet ? null : sheet, getSpreadsheetTimeZone: () => 'UTC', toast() {} };
  const context = vm.createContext({
    Date,
    Utilities: { formatDate: date => date.toISOString().slice(0, 10) },
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, getUi: () => ui, flush() {} },
    LockService: {
      getDocumentLock: () => documentLock ? { waitLock() {}, releaseLock() { releases++; } } : null,
      getScriptLock: () => ({ waitLock() {}, releaseLock() { releases++; } })
    }
  });
  vm.runInContext(backend, context);
  return { context, rows, writes, backups, ui, sheet, setMaxColumns: count => { maxColumns = count; }, releases: () => releases };
}

test('backend and frontend scripts parse', () => {
  new vm.Script(backend);
  new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
});

test('bulk deletion requires explicitly selected children before any write', () => {
  const app = server([taskRow('VID-001'), taskRow('VID-002', 'VID-001')]);
  assert.throws(() => app.context.deleteTasks(['VID-001']), /every subtask/);
  assert.equal(app.writes.length, 0);
  assert.equal(app.releases(), 1);
  app.context.deleteTasks(['VID-001', 'VID-002', 'VID-002']);
  assert.equal(app.rows.length, 1);
  assert.equal(app.writes.length, 1);
});

test('deletion removes noncontiguous ranges from bottom upward', () => {
  const app = server([taskRow('VID-001'), taskRow('VID-002'), taskRow('VID-003')]);
  app.context.deleteTasks(['VID-001', 'VID-003']);
  assert.deepEqual(app.writes.map(write => write.delete), [4, 2]);
  assert.equal(app.rows[1][0], 'VID-002');
});

test('missing IDs, invalid statuses, empty selection, duplicates and missing sheet write nothing', () => {
  for (const [records, missing, action, error] of [
    [[taskRow('VID-001')], false, context => context.updateTaskStatuses(['missing'], 'Done'), /not found/],
    [[taskRow('VID-001')], false, context => context.updateTaskStatuses(['VID-001'], 'Invalid'), /Invalid status/],
    [[], false, context => context.deleteTasks([]), /at least one/],
    [[taskRow('VID-001'), taskRow('VID-001')], false, context => context.deleteTasks(['VID-001']), /Duplicate/],
    [[], true, context => context.deleteTasks(['VID-001']), /sheet not found/]
  ]) {
    const app = server(records, missing);
    assert.throws(() => action(app.context), error);
    assert.equal(app.writes.length, 0);
    assert.equal(app.releases(), 1);
  }
});

test('status transitions preserve start and completion on no-op, clear completion on reopen, preserve formulas', () => {
  const app = server([taskRow('VID-001'), taskRow('VID-002')]);
  app.context.updateTaskStatuses(['VID-001', 'VID-002'], 'Done');
  assert.equal(app.writes.length, 3);
  const started = app.rows[1][9];
  const completed = app.rows[1][10];
  app.context.updateTaskStatus('VID-001', 'Done');
  assert.equal(app.writes.length, 3);
  assert.equal(app.rows[1][10], completed);
  app.context.updateTaskStatus('VID-001', 'In Progress');
  assert.equal(app.rows[1][9], started);
  assert.equal(app.rows[1][10], '');
  assert.equal(app.rows[1][7], '=G2-F2+1');
});

test('modal detail save accepts optional status and validates it before writing', () => {
  const app = server([taskRow('VID-001')]);
  const payload = { taskId: 'VID-001', taskName: 'Updated', category: 'Video editing', priority: 'High', startDate: '2026-11-03', endDate: '2026-11-05', status: 'Invalid' };
  assert.throws(() => app.context.updateTask(payload), /Invalid status/);
  assert.equal(app.writes.length, 0);
  app.context.updateTask({ ...payload, status: 'Done' });
  assert.equal(app.rows[1][1], 'Updated');
  assert.equal(app.rows[1][4], 'Done');
  assert.equal(app.rows[1][7], '=G2-F2+1');
});

test('partial write failures are errors, never successes, and release the lock for reconciliation', () => {
  const status = server([taskRow('VID-001')], false, 1);
  assert.throws(() => status.context.updateTaskStatuses(['VID-001'], 'Done'), /Injected write failure/);
  assert.equal(status.rows[1][4], 'Done');
  assert.equal(status.rows[1][10], '');
  assert.equal(status.releases(), 1);
  const deletion = server([taskRow('VID-001'), taskRow('VID-002'), taskRow('VID-003')], false, 1);
  assert.throws(() => deletion.context.deleteTasks(['VID-001', 'VID-003']), /Injected write failure/);
  assert.deepEqual(deletion.rows.slice(1).map(row => row[0]), ['VID-001', 'VID-002']);
  assert.equal(deletion.releases(), 1);
});

test('script lock is used when document lock is unavailable', () => {
  const app = server([taskRow('VID-001')], false, Infinity, false);
  app.context.updateTaskStatus('VID-001', 'Done');
  assert.equal(app.rows[1][4], 'Done');
  assert.equal(app.releases(), 1);
});

test('clients JSON round-trips punctuation, normalizes duplicates and rejects malformed data', () => {
  const app = server([]);
  assert.deepEqual(Array.from(app.context.normalizeClients_([' Zebra ', 'Acme, Inc.', 'zebra'])), ['Acme, Inc.', 'Zebra']);
  assert.deepEqual(Array.from(app.context.readClients_('["Acme, Inc.","Client \\"A\\""]', 'VID-1')), ['Acme, Inc.', 'Client "A"']);
  assert.throws(() => app.context.readClients_('not JSON', 'VID-1'), /Invalid Clients data for VID-1/);
  assert.throws(() => app.context.normalizeClients_('Acme'), /list/);
});

test('header upgrade preserves original fields and rejects occupied column O before writing', () => {
  const app = server([]);
  app.setMaxColumns(14);
  app.rows[0] = app.rows[0].slice(0, 14);
  app.context.initializeTaskHeaders_(app.sheet);
  assert.equal(app.rows[0][13], 'Parent Task ID');
  assert.equal(app.rows[0][14], 'Clients');
  app.rows[0][14] = 'Unrelated data';
  const count = app.writes.length;
  assert.throws(() => app.context.initializeTaskHeaders_(app.sheet), /Column O/);
  assert.equal(app.writes.length, count);
});

test('category upgrade is explicit and deterministic, and detail edits preserve or clear clients', () => {
  const app = server([taskRow('VID-001')]);
  assert.equal(app.context.categoryForUpgrade_('Graphics'), 'Graphic Design');
  assert.equal(app.context.categoryForUpgrade_('Editing'), 'Video editing');
  assert.equal(app.context.categoryForUpgrade_('Scheduling'), 'Scheduling');
  assert.throws(() => app.context.categoryForUpgrade_('Unknown'), /Unknown category/);
  app.rows[1][14] = '["Client A"]';
  const payload = { taskId: 'VID-001', taskName: 'Updated', category: 'Scheduling', priority: 'High', startDate: '2026-11-03', endDate: '2026-11-05' };
  app.context.updateTask(payload);
  assert.equal(app.rows[1][14], '["Client A"]');
  app.context.updateTask({ ...payload, clients: [] });
  assert.equal(app.rows[1][14], '[]');
  assert.equal(app.rows[1][7], '=G2-F2+1');
});

test('batch creation inherits saved defaults and clients, allocates unique IDs and literal names', () => {
  const parent = taskRow('VID-009');
  parent[5] = new Date(2026, 10, 1); parent[6] = new Date(2026, 10, 10); parent[14] = '["Acme"]';
  const app = server([parent]);
  const result = app.context.createSubtasks('VID-009', [' First ', '', 'First', '=SUM(A1:A2)']);
  assert.deepEqual(Array.from(result.taskIds), ['VID-010', 'VID-011', 'VID-012']);
  assert.equal(app.rows[2][1], 'First');
  assert.equal(app.rows[4][1], "'=SUM(A1:A2)");
  assert.equal(app.rows[2][14], '["Acme"]');
  assert.equal(app.rows[2][13], 'VID-009');
  assert.match(app.rows[2][7], /G3-F3\+1/);
  assert.equal(app.writes.length, 1);
  assert.throws(() => app.context.createSubtasks('VID-009', Array(101).fill('Name')), /1-100/);
});

test('bulk subtask patches validate every merged date and parent scope before writing', () => {
  const parent = taskRow('VID-001');
  const child = taskRow('VID-002', 'VID-001');
  child[5] = new Date(2026, 10, 1); child[6] = new Date(2026, 10, 5); child[14] = '["Acme"]';
  const app = server([parent, child, taskRow('VID-003')]);
  assert.throws(() => app.context.updateSubtasks('VID-001', ['VID-002'], { startDate: '2026-11-06' }), /End date/);
  assert.throws(() => app.context.updateSubtasks('VID-001', ['VID-002', 'VID-003'], { priority: 'High' }), /no longer direct/);
  assert.throws(() => app.context.updateTaskStatuses(['VID-003'], 'Done', 'VID-001'), /no longer direct/);
  assert.throws(() => app.context.deleteTasks(['VID-003'], 'VID-001'), /no longer direct/);
  assert.equal(app.writes.length, 0);
  app.context.updateSubtasks('VID-001', ['VID-002'], { priority: 'High', clients: [] });
  assert.equal(app.rows[2][3], 'High');
  assert.equal(app.rows[2][14], '[]');
  assert.equal(app.rows[2][7], '=G2-F2+1');
  assert.equal(app.rows[2][5], child[5]);
  assert.throws(() => app.context.updateSubtasks('VID-001', ['VID-002'], {}), /at least one/);
});

test('client filters are independent and client sorting uses the first alphabetical name with unassigned last', () => {
  const app = client();
  const task = listTask('VID-1', '', { clients: ['Zebra', 'Acme'], category: 'Scheduling' });
  assert.equal(app.clientMatches(task, 'client:ACME'), true);
  assert.equal(app.taskMatches(task, { client: 'client:Zebra', category: 'Graphic Design' }), false);
  assert.equal(app.clientMatches(task, 'unassigned'), false);
  assert.equal(app.clientMatches(listTask('VID-2'), 'unassigned'), true);
  assert.ok(app.compareTasks(task, listTask('VID-2', '', { clients: ['Beta'] }), 'clients', 1) < 0);
  assert.ok(app.compareTasks(task, listTask('VID-2'), 'clients', -1) < 0);
});

test('dashboard calendar periods cover leap months, Monday-Sunday weeks and year boundaries', () => {
  const app = client();
  for (const [period, anchor, start, end] of [
    ['daily', '2026-11-03', '2026-11-03', '2026-11-03'],
    ['weekly', '2026-11-01', '2026-10-26', '2026-11-01'],
    ['weekly', '2026-11-02', '2026-11-02', '2026-11-08'],
    ['monthly', '2024-02-29', '2024-02-01', '2024-02-29'],
    ['yearly', '2026-12-31', '2026-01-01', '2026-12-31']
  ]) {
    const range = app.dashboardRange(period, app.parseDate(anchor));
    assert.equal(app.dateKey(range.start), start);
    assert.equal(app.dateKey(range.end), end);
  }
});

test('dashboard counts scheduled overlap once per multi-client task and excludes invalid dates', () => {
  const app = client();
  const range = app.dashboardRange('daily', app.parseDate('2026-11-03'));
  const task = listTask('VID-1', '', { start: app.parseDate('2026-11-01'), end: app.parseDate('2026-11-03'), clients: ['Acme', 'Beta'] });
  assert.equal(app.dashboardTasks([task], range, '').length, 1);
  assert.equal(app.dashboardTasks([task], range, 'client:Beta').length, 1);
  assert.equal(app.dashboardTasks([task], range, 'unassigned').length, 0);
  assert.equal(app.dashboardTasks([listTask('undated'), { ...task, end: app.parseDate('2026-10-31') }], range, '').length, 0);
});

test('subtask panel selects only visible children and keeps selection separate from All tasks', () => {
  const app = client();
  const state = app.getState();
  state.tasks = [listTask('VID-1'), ...Array.from({ length: 60 }, (_, index) => listTask('VID-' + (index + 2), 'VID-1'))];
  app.resetSubtaskPanel('VID-1');
  app.selectPanelPage(true);
  assert.equal(state.subtaskPanel.selected.size, 25);
  assert.equal(state.list.selected.size, 0);
  state.subtaskPanel.page = 2;
  app.selectPanelPage(true);
  assert.equal(state.subtaskPanel.selected.size, 50);
  app.resetSubtaskPanel('VID-9');
  assert.equal(state.subtaskPanel.selected.size, 0);
  assert.deepEqual(Array.from(app.subtaskNames(' One\n\nTwo\r\n One ')), ['One', 'Two', 'One']);
});

test('administrator upgrade creates a backup before migration and is safe to rerun', () => {
  const row = taskRow('VID-001'); row[2] = 'Graphics'; row[14] = '';
  const app = server([row]);
  app.rows[0] = app.rows[0].slice(0, 14); app.setMaxColumns(14);
  app.context.upgradeTaskDatabase();
  assert.equal(app.backups.length, 1);
  assert.equal(app.backups[0][1][2], 'Graphics');
  assert.equal(app.rows[0][14], 'Clients');
  assert.equal(app.rows[1][2], 'Graphic Design');
  assert.equal(app.rows[1][7], '=G2-F2+1');
  const writes = app.writes.length;
  app.context.upgradeTaskDatabase();
  assert.equal(app.writes.length, writes);
  assert.equal(app.backups.length, 1);
});

test('upgrade cancellation and unknown categories cannot partially migrate data', () => {
  const legacy = taskRow('VID-001'); legacy[2] = 'Editing';
  const unknown = taskRow('VID-002'); unknown[2] = 'Unexpected';
  const app = server([legacy, unknown]);
  assert.throws(() => app.context.upgradeTaskDatabase(), /Unknown category/);
  assert.equal(app.writes.length, 0);
  assert.equal(app.backups.length, 0);
  app.ui.answer = 'NO';
  app.context.upgradeTaskDatabase();
  assert.equal(app.writes.length, 0);
});

test('legacy getTasks returns empty clients without altering the sheet and includes calendar metadata', () => {
  const row = taskRow('VID-001'); row[14] = '';
  const app = server([row]);
  app.rows[0] = app.rows[0].slice(0, 14); app.setMaxColumns(14);
  const response = app.context.getTasks();
  assert.equal(response.tasks[0].clients.length, 0);
  assert.match(response.spreadsheetToday, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(app.writes.length, 0);
});

test('active category validation and errors only list the new categories; legacy names are migration-only', () => {
  const app = server([taskRow('VID-001')]);
  for (const category of ['Graphic Design', 'Video editing', 'Scheduling']) {
    assert.doesNotThrow(() => app.context.validateCategory_(category));
    assert.equal(app.context.categoryForUpgrade_(category), category);
  }
  const message = 'Invalid task category. Allowed categories: Graphic Design, Video editing, Scheduling.';
  for (const category of ['Graphics', 'Pre-production', 'Editing', 'Post-production', 'Subtitles', 'Review', 'Delivery']) {
    assert.throws(() => app.context.validateCategory_(category), error => error.message === message);
    assert.equal(app.context.categoryForUpgrade_(category), category === 'Graphics' ? 'Graphic Design' : 'Video editing');
  }
  const payload = { taskId: 'VID-001', taskName: 'Name', category: 'Editing', priority: 'High', startDate: '2026-11-03', endDate: '2026-11-05' };
  assert.throws(() => app.context.createTask(payload), error => error.message === message);
  assert.throws(() => app.context.updateTask(payload), error => error.message === message);
  assert.throws(() => app.context.updateSubtasks('VID-001', ['VID-001'], { category: 'Editing' }), error => error.message === message);
  app.rows[1][2] = 'Editing';
  assert.throws(() => app.context.createSubtasks('VID-001', ['Child']), error => error.message === message);
  assert.throws(() => app.context.categoryForUpgrade_('Unknown'), /Graphic Design, Video editing, Scheduling/);
  assert.throws(() => app.context.categoryForUpgrade_('__proto__'), /Unknown category/);
  assert.equal(app.writes.length, 0);
});

test('quantity multiplier previews the exact total and rejects invalid or oversized batches', () => {
  const app = client();
  const batch = app.subtaskBatch('Edit video\nSchedule review', 3);
  assert.equal(batch.total, 6);
  assert.equal(batch.error, '');
  for (const quantity of [0, -1, 1.5, NaN, 101]) assert.match(app.subtaskBatch('Task', quantity).error, /whole number/);
  assert.match(app.subtaskBatch('One\nTwo', 51).error, /100-subtask limit/);
  assert.match(app.subtaskBatch('', 1).error, /at least one/);
});

test('server applies quantity multiplier with distinct IDs and validates the expanded total before writes', () => {
  const parent = taskRow('VID-001');
  parent[5] = new Date(2026, 10, 1); parent[6] = new Date(2026, 10, 10);
  const app = server([parent]);
  const result = app.context.createSubtasks('VID-001', ['Edit', 'Schedule'], 3);
  assert.equal(result.created, 6);
  assert.equal(new Set(result.taskIds).size, 6);
  assert.deepEqual(app.rows.slice(2).map(row => row[1]), ['Edit', 'Edit', 'Edit', 'Schedule', 'Schedule', 'Schedule']);
  const count = app.writes.length;
  assert.throws(() => app.context.createSubtasks('VID-001', ['One', 'Two'], 51), /1-100/);
  assert.throws(() => app.context.createSubtasks('VID-001', ['One'], 1.5), /whole number/);
  assert.equal(app.writes.length, count);
});

test('bulk edit field toggles preserve the panel and draft while making selected changes explicit', () => {
  const app = client();
  const state = app.getState();
  const parent = listTask('VID-1', '', { category: 'Scheduling' });
  state.taskById.set(parent.id, parent);
  app.resetSubtaskPanel(parent.id);
  state.subtaskPanel.draft = 'Draft task';
  state.subtaskPanel.quantity = 3;
  state.subtaskPanel.selected.add('VID-2');
  app.toggleSubtaskField('category', true);
  assert.equal(state.subtaskPanel.patch.category, 'Scheduling');
  assert.equal(app.elements.get('bulkValuecategory').disabled, false);
  assert.equal(app.elements.get('bulkApplyBtn').textContent, 'Apply 1 fields to 1 subtasks');
  app.setSubtaskPatch('category', 'Graphic Design');
  app.toggleSubtaskField('category', false);
  assert.equal(state.subtaskPanel.draft, 'Draft task');
  assert.equal(state.subtaskPanel.quantity, 3);
  assert.equal(app.elements.get('bulkApplyBtn').disabled, true);
});