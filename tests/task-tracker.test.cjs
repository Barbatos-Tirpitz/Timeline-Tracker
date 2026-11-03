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
      if (typeof row === 'string') return { setNumberFormat() { return this; } };
      return {
        getValues: () => Array.from({ length: height }, (_, offset) => Array.from({ length: width }, (_, index) => rows[row - 1 + offset]?.[column - 1 + index] ?? '')),
        getValue: () => rows[row - 1]?.[column - 1] ?? '',
        getDisplayValues: () => rows.slice(row - 1, row - 1 + height).map(values => values.slice(column - 1, column - 1 + width).map(String)),
        setValues(values) {
          assert.equal(values.length, height);
          values.forEach(valuesRow => assert.equal(valuesRow.length, width));
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
  assert.equal(app.elements.get('bulkApplyBtn').textContent, 'Apply 1 field to 1 subtask');
  app.setSubtaskPatch('category', 'Graphic Design');
  app.toggleSubtaskField('category', false);
  assert.equal(state.subtaskPanel.draft, 'Draft task');
  assert.equal(state.subtaskPanel.quantity, 3);
  assert.equal(app.elements.get('bulkApplyBtn').disabled, true);
});

test('adding subtasks retains names and quantity for further additions instead of clearing the draft', () => {
  const app = loadingClient();
  const state = app.getState();
  const parent = listTask('VID-1');
  state.loaded = true;
  state.editId = parent.id;
  state.tasks = [parent];
  state.taskById.set(parent.id, parent);
  state.childrenByParent.set(parent.id, Array.from({ length: 24 }, (_, index) => listTask('VID-' + (index + 2), parent.id)));
  app.resetSubtaskPanel(parent.id);
  state.subtaskPanel.quantity = 3;
  app.elements.set('newSubtaskName', { value: 'Edit\nSchedule' });
  vm.runInContext('Date.now=()=>1000; parentHasUnsavedChanges=()=>false; showToast=()=>{}; loadTasks=()=>{state.syncing=false;};', app);
  app.createSubtask();
  app.calls[0].success({ success: true, created: 6 });
  assert.equal(state.subtaskPanel.draft, 'Edit\nSchedule');
  assert.equal(state.subtaskPanel.quantity, 3);
  assert.equal(state.subtaskPanel.lastCreated, 6);
  assert.equal(state.subtaskPanel.page, 2);
  vm.runInContext('Date.now=()=>1800;', app);
  app.createSubtask();
  assert.equal(app.calls.length, 2);
  assert.equal(app.calls[1].args[2], 3);
  assert.deepEqual(Array.from(app.calls[1].args[1]), ['Edit', 'Schedule']);
});

test('repeated creation appends without removing existing subtasks', () => {
  const parent = taskRow('VID-001');
  parent[5] = new Date(2026, 10, 1); parent[6] = new Date(2026, 10, 10);
  const app = server([parent]);
  app.context.createSubtasks('VID-001', ['Edit'], 3);
  const firstIds = app.rows.slice(2).map(row => row[0]);
  app.context.createSubtasks('VID-001', ['Schedule'], 2);
  assert.equal(app.rows.length, 7);
  assert.deepEqual(app.rows.slice(2, 5).map(row => row[0]), firstIds);
  assert.equal(new Set(app.rows.slice(1).map(row => row[0])).size, 6);
});

test('subtask client tags use each child assignment, show Unassigned, and escape all names', () => {
  const app = client();
  assert.match(app.renderSubtaskClientTags(listTask('VID-1')), /Unassigned/);
  const child = listTask('VID-2', 'VID-1', { clients: ['Client <One>', 'Acme, Inc.', 'Client "Three"', 'Delta'] });
  const markup = app.renderSubtaskClientTags(child);
  assert.equal((markup.match(/class="subtask-client-tag"/g) || []).length, 2);
  assert.match(markup, /2 more clients/);
  assert.match(markup, /Client &lt;One&gt;/);
  assert.match(markup, /Client &quot;Three&quot;/);
  assert.doesNotMatch(markup, /Client <One>/);
  app.getState().taskById.set('VID-1', listTask('VID-1', '', { clients: ['Parent only'] }));
  assert.doesNotMatch(app.renderSubtaskClientTags(child), /Parent only/);
  assert.doesNotMatch(app.renderSubtaskClientTags({ ...child, clients: [] }), /more clients/);
});

test('duplicate commands stay blocked after a fast refresh, while new payloads and deliberate repeats work', () => {
  const app = loadingClient();
  const state = app.getState();
  state.loaded = true;
  app.clock = 1000;
  app.messages = [];
  vm.runInContext('Date.now=()=>clock; showToast=message=>messages.push(message);', app);
  let rejections = 0;
  let failures = 0;
  const run = name => app.mutationRunner().withSuccessHandler(() => app.loadTasks())
    .withRejectionHandler(() => rejections++).withFailureHandler(() => failures++)
    .createSubtasks('VID-1', [name], 2);
  run('Edit');
  run('Edit');
  assert.equal(app.calls.length, 1);
  assert.equal(failures, 1);
  app.calls[0].success({ success: true });
  app.calls[1].success({ success: true, tasks: [] });
  app.clock = 1100;
  run('Edit');
  assert.equal(app.calls.length, 2);
  assert.equal(rejections, 1);
  assert.equal(failures, 1);
  assert.equal(state.writing, false);
  run('Schedule');
  assert.equal(app.calls.length, 3);
  app.calls[2].success({ success: true });
  app.calls[3].success({ success: true, tasks: [] });
  app.clock = 1700;
  run('Edit');
  assert.equal(app.calls.length, 5);
  assert.equal(app.calls[4].method, 'createSubtasks');
});

test('duplicate command keys ignore object field order and restore caller busy state without an RPC', () => {
  const app = loadingClient();
  const state = app.getState();
  state.loaded = true;
  vm.runInContext('Date.now=()=>1000; showToast=()=>{};', app);
  const first = { taskName: 'Edit', category: 'Scheduling' };
  app.mutationRunner().withSuccessHandler(() => app.loadTasks()).createTask(first);
  app.calls[0].success({ success: true });
  app.calls[1].success({ success: true, tasks: [] });
  app.elements.set('saveBtn', { disabled: true, textContent: 'Saving...' });
  app.mutationRunner().withRejectionHandler(() => app.setSaving(false))
    .createTask({ category: 'Scheduling', taskName: 'Edit' });
  assert.equal(app.calls.length, 2);
  assert.equal(app.elements.get('saveBtn').disabled, false);
  assert.equal(app.elements.get('saveBtn').textContent, 'Create task');
});

test('failed commands reconcile without retrying and become available again after the cooldown', () => {
  const app = loadingClient();
  const state = app.getState();
  state.loaded = true;
  app.clock = 1000;
  vm.runInContext('Date.now=()=>clock; showToast=()=>{};', app);
  state.subtaskPanel.draft = 'Keep draft';
  state.subtaskPanel.quantity = 3;
  const run = () => app.mutationRunner().withFailureHandler(() => {}).createSubtasks('VID-1', ['Keep draft'], 3);
  run();
  app.calls[0].failure(new Error('Network failed'));
  assert.equal(app.calls[1].method, 'getTasks');
  app.calls[1].success({ success: true, tasks: [] });
  run();
  assert.equal(app.calls.length, 2);
  app.clock = 1800;
  run();
  assert.equal(app.calls.length, 3);
  assert.equal(state.subtaskPanel.draft, 'Keep draft');
  assert.equal(state.subtaskPanel.quantity, 3);
});

test('duplicate modal submission restores Save without reporting a server failure', () => {
  const app = loadingClient();
  const state = app.getState();
  state.loaded = true;
  app.messages = [];
  vm.runInContext('Date.now=()=>1000; showToast=message=>messages.push(message);', app);
  const payload = { taskName: 'Campaign', category: 'Scheduling', priority: 'Medium', startDate: '2026-11-01', endDate: '2026-11-15', description: '', parentTaskId: '', clients: [], hours: '' };
  app.mutationRunner().withSuccessHandler(() => app.loadTasks()).createTask(payload);
  app.calls[0].success({ success: true });
  app.calls[1].success({ success: true, tasks: [] });
  for (const [id, value] of Object.entries({ taskName: payload.taskName, category: payload.category, priority: payload.priority, startDate: payload.startDate, endDate: payload.endDate, description: '', parentTaskId: '' })) {
    app.elements.set(id, { value });
  }
  app.elements.set('formError', { style: { display: 'none' } });
  app.elements.set('saveBtn', { disabled: false, textContent: 'Create task' });
  app.saveTask({ preventDefault() {} });
  assert.equal(app.calls.length, 2);
  assert.equal(app.elements.get('saveBtn').disabled, false);
  assert.equal(app.elements.get('saveBtn').textContent, 'Create task');
  assert.equal(app.elements.get('formError').style.display, 'none');
  assert.match(app.messages[0], /already submitted/);
});

function invoiceDraft(overrides = {}) {
  return {
    id: 'INV-test-invoice-001', client: 'Acme', currency: 'USD', status: 'Draft',
    periodStart: '2026-11-03', periodEnd: '2026-11-16', issueDate: '2026-11-16', dueDate: '2026-11-16',
    senderName: 'Video Studio', defaultRate: 25,
    lines: [{ taskId: 'VID-001', description: 'Opening video', hours: 3.5, rate: 25 }], ...overrides
  };
}

test('invoice calculations use billable hours and rounded minor units, never schedule duration', () => {
  const app = server([]);
  const invoice = app.context.normalizeInvoice_(invoiceDraft());
  assert.equal(invoice.totalMinor, 8750);
  assert.equal(invoice.lines[0].hours, 3.5);
  const rounding = app.context.normalizeInvoice_(invoiceDraft({ lines: [{ description: 'Video', hours: 0.01, rate: 0.5 }] }));
  assert.equal(rounding.totalMinor, 1);
  assert.throws(() => app.context.normalizeInvoice_(invoiceDraft({ periodEnd: '2026-11-17' })), /14 calendar days/);
  assert.throws(() => app.context.normalizeInvoice_(invoiceDraft({ lines: [{ description: 'Video', hours: -1, rate: 25 }] })), /nonnegative/);
  assert.throws(() => app.context.normalizeInvoice_(invoiceDraft({ lines: [{ description: 'Video', hours: 1.111, rate: 25 }] })), /two decimal/);
});

test('invoice drafts may be incomplete but issuing requires sender, lines, positive hours and rates', () => {
  const app = server([]);
  assert.equal(app.context.normalizeInvoice_(invoiceDraft({ senderName: '', lines: [] })).status, 'Draft');
  assert.throws(() => app.context.normalizeInvoice_(invoiceDraft({ status: 'Issued', senderName: '' })), /name or business/);
  assert.throws(() => app.context.normalizeInvoice_(invoiceDraft({ status: 'Issued', lines: [{ description: 'Video', hours: 0, rate: 25 }] })), /positive hours/);
  const line = invoiceDraft().lines[0];
  assert.throws(() => app.context.normalizeInvoice_(invoiceDraft({ lines: [line, line] })), /more than once/);
  assert.throws(() => app.context.normalizeInvoice_(invoiceDraft({ currency: 'INVALID' })), /supported/);
});

function invoiceServer() {
  const sheets = new Map();
  let releases = 0;
  function makeSheet() {
    const rows = [];
    return {
      rows, getLastRow: () => rows.length, getMaxRows: () => 10000,
      getRange(row, column, height = 1, width = 1) {
        return {
          getValues: () => Array.from({ length: height }, (_, offset) => Array.from({ length: width }, (_, index) => rows[row - 1 + offset]?.[column - 1 + index] ?? '')),
          setValues(values) { values.forEach((valuesRow, offset) => {
            if (!rows[row - 1 + offset]) rows[row - 1 + offset] = [];
            valuesRow.forEach((value, index) => { rows[row - 1 + offset][column - 1 + index] = value; });
          }); return this; }
        };
      },
      deleteRows(row, count) { rows.splice(row - 1, count); }
    };
  }
  const spreadsheet = {
    getSheetByName: name => sheets.get(name) || null,
    insertSheet(name) { const sheet = makeSheet(); sheets.set(name, sheet); return sheet; },
    getSpreadsheetTimeZone: () => 'UTC'
  };
  const context = vm.createContext({ Date,
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    Utilities: { formatDate: date => date.toISOString().slice(0, 10) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() { releases++; } }) }
  });
  vm.runInContext(backend, context);
  return { context, sheets, releases: () => releases };
}

test('invoice workspace reads create no sheets; saves preserve snapshots and detect stale revisions', () => {
  const app = invoiceServer();
  const workspace = app.context.getInvoiceWorkspace();
  assert.equal(workspace.invoices.length, 0);
  assert.equal(app.sheets.size, 0);
  const first = app.context.saveInvoice(invoiceDraft()).invoice;
  assert.equal(first.number, 'INV-00001');
  assert.equal(first.revision, 1);
  assert.equal(app.sheets.get('Invoice_Master').rows.length, 2);
  assert.throws(() => app.context.saveInvoice(invoiceDraft()), /another session/);
  const issued = app.context.saveInvoice({ ...first, status: 'Issued' }).invoice;
  assert.equal(issued.totalMinor, 8750);
  assert.throws(() => app.context.saveInvoice({ ...issued, senderName: 'Changed' }), /cannot be edited/);
  assert.throws(() => app.context.saveInvoice(invoiceDraft({ id: 'INV-second-invoice', status: 'Issued' })), /already exists/);
  const paid = app.context.changeInvoiceStatus(issued.id, issued.revision, 'Paid').invoice;
  assert.equal(paid.status, 'Paid');
  assert.ok(paid.paidAt);
  assert.throws(() => app.context.deleteInvoiceDraft(paid.id, paid.revision), /unchanged draft/);
  assert.equal(app.context.getInvoice(paid.id).invoice.lines[0].description, 'Opening video');
});

test('invoice defaults save independently, detect conflicts and drafts can be deleted without touching tasks', () => {
  const app = invoiceServer();
  const settings = { anchor: '2026-11-03', currency: 'PHP', defaultRate: 500, senderName: 'Studio', senderDetails: '', paymentNotes: '' };
  app.context.saveInvoiceSettings(settings, 0);
  assert.equal(app.context.getInvoiceWorkspace().settings.defaultRate, 500);
  assert.throws(() => app.context.saveInvoiceSettings(settings, 0), /changed/);
  const invoice = app.context.saveInvoice(invoiceDraft()).invoice;
  app.context.deleteInvoiceDraft(invoice.id, invoice.revision);
  assert.equal(app.context.getInvoiceWorkspace().invoices.length, 0);
  assert.equal(app.sheets.has('Task_Master'), false);
});

test('invoice cycles use anchored calendar fortnights and client totals match server rounding', () => {
  const app = client();
  const anchor = app.parseDate('2026-11-03');
  assert.equal(app.invoicePeriod(anchor, app.parseDate('2026-11-16')).start, '2026-11-03');
  assert.equal(app.invoicePeriod(anchor, app.parseDate('2026-11-17')).start, '2026-11-17');
  assert.equal(app.invoicePeriod(anchor, app.parseDate('2026-11-02')).start, '2026-10-20');
  assert.equal(app.invoiceAmount(3.5, 25), 8750);
  assert.equal(app.invoiceAmount(0.01, 0.5), 1);
  assert.equal(app.invoiceAmount(-1, 25), null);
  assert.equal(app.invoiceCsvCell('=SUM(A1:A2)'), '"\'=SUM(A1:A2)"');
  assert.equal(app.invoiceCsvCell('Client, "A"'), '"Client, ""A"""');
  assert.equal(app.invoiceCsvCell('  =HYPERLINK("bad")').startsWith('"\'  ='), true);
  assert.equal(app.invoiceAmount(true, 25), null);
  assert.equal(app.invoiceAmount(10001, 25), null);
});

test('invoice writes reconcile invoice history, not task data, and can operate without a task snapshot', () => {
  const app = loadingClient();
  const state = app.getState();
  state.loaded = false;
  state.invoices.loaded = true;
  let invoiceRefreshes = 0;
  app.mutationRunner().withFailureHandler(() => {})
    .withReconciliationHandler(() => invoiceRefreshes++)
    .saveInvoice(invoiceDraft());
  assert.equal(app.calls[0].method, 'saveInvoice');
  app.calls[0].failure(new Error('Timed out'));
  assert.equal(invoiceRefreshes, 1);
  assert.equal(app.calls.length, 1);
  assert.equal(state.syncing, true);
});

test('voiding preserves the snapshot and allows a replacement invoice for the same client period', () => {
  const app = invoiceServer();
  const issued = app.context.saveInvoice(invoiceDraft({ status: 'Issued' })).invoice;
  const voided = app.context.changeInvoiceStatus(issued.id, issued.revision, 'Void').invoice;
  assert.equal(voided.status, 'Void');
  assert.equal(voided.lines[0].description, 'Opening video');
  const replacement = app.context.saveInvoice(invoiceDraft({ id: 'INV-replacement-001', status: 'Issued' })).invoice;
  assert.equal(replacement.number, 'INV-00002');
  assert.throws(() => app.context.changeInvoiceStatus(replacement.id, 0, 'Paid'), /changed/);
  assert.throws(() => app.context.normalizeInvoice_(invoiceDraft({ lines: [{ description: 'Video', hours: true, rate: 25 }] })), /must be a number/);
});

test('invoice header conflicts write nothing and partial default initialization can be recovered', () => {
  const app = invoiceServer();
  app.context.saveInvoice(invoiceDraft());
  const sheet = app.sheets.get('Invoice_Master');
  sheet.rows[0][0] = 'Unrelated header';
  assert.throws(() => app.context.saveInvoice(invoiceDraft({ id: 'INV-another-invoice' })), /headers do not match/);
  assert.equal(sheet.rows.length, 2);
  sheet.rows[0][0] = 'Invoice ID';
  const settings = { anchor: '2026-11-03', currency: 'USD', defaultRate: 30, senderName: 'Studio' };
  app.context.saveInvoiceSettings(settings, 0);
  app.sheets.get('Invoice_Settings').rows.pop();
  assert.equal(app.context.getInvoiceWorkspace().settingsRevision, 0);
  app.context.saveInvoiceSettings(settings, 0);
  assert.equal(app.context.getInvoiceWorkspace().settings.defaultRate, 30);
});

test('refreshing invoice history preserves unsaved billing defaults and their original revision', () => {
  const app = loadingClient();
  const workspace = app.getState().invoices;
  workspace.settingsRevision = 2;
  workspace.billingDirty = true;
  workspace.settingsDraft = { senderName: 'Unsaved name' };
  app.loadInvoiceWorkspace();
  app.calls[0].success({ success: true, invoices: [], settingsRevision: 3, today: '2026-11-03',
    settings: { anchor: '2026-11-03', currency: 'USD', defaultRate: 25, senderName: 'Other session' } });
  assert.equal(workspace.settingsRevision, 2);
  assert.equal(workspace.settingsDraft.senderName, 'Unsaved name');
  assert.equal(workspace.settings.senderName, 'Other session');
});

test('invoice workspace has a recoverable error when the Apps Script bridge is unavailable', () => {
  const app = client();
  app.loadInvoiceWorkspace();
  assert.equal(app.getState().invoices.loading, false);
  assert.match(app.getState().invoices.error, /Apps Script connection unavailable/);
});

test('invoice periods support a custom timeline while preserving strict two-week presets', () => {
  const app = server([]);
  const custom = app.context.normalizeInvoice_(invoiceDraft({ periodMode: 'custom', periodStart: '2026-11-01', periodEnd: '2026-11-30', videoDateBasis: 'completed', videoScope: 'topLevel' }));
  assert.equal(custom.periodMode, 'custom');
  assert.equal(custom.periodEnd, '2026-11-30');
  assert.equal(custom.videoDateBasis, 'completed');
  assert.throws(() => app.context.normalizeInvoice_(invoiceDraft({ periodEnd: '2026-11-30' })), /14 calendar days/);
  assert.throws(() => app.context.normalizeInvoice_(invoiceDraft({ periodMode: 'custom', periodEnd: '2026-11-01' })), /cannot precede/);
  assert.throws(() => app.context.normalizeInvoice_(invoiceDraft({ periodMode: 'custom', videoDateBasis: 'unknown' })), /valid invoice timeline/);
});

test('invoice counts match client and timeline, with explicit parent/subtask and completion rules', () => {
  const app = client();
  const video = (id, overrides = {}) => listTask(id, '', { category: 'Video editing', clients: ['Acme'], start: app.parseDate('2026-11-01'), end: app.parseDate('2026-11-05'), ...overrides });
  const tasks = [video('VID-1'), video('VID-2', { parentTaskId: 'VID-1' }), video('VID-3', { clients: ['Other'] }),
    video('VID-4', { clients: [] }), video('VID-5', { end: app.parseDate('2026-10-31') }), video('VID-6', { category: 'Scheduling' })];
  const invoice = invoiceDraft({ periodStart: '2026-11-05', periodEnd: '2026-11-18' });
  assert.deepEqual(Array.from(app.invoiceVideoCandidates(tasks, invoice), task => task.id), ['VID-2']);
  assert.deepEqual(Array.from(app.invoiceVideoCandidates(tasks, { ...invoice, videoScope: 'topLevel' }), task => task.id), ['VID-1']);
  assert.deepEqual(Array.from(app.invoiceVideoCandidates(tasks, { ...invoice, includeUnassigned: true }), task => task.id), ['VID-2', 'VID-4']);
  tasks[1].status = 'Done'; tasks[1].actualEndDate = app.parseDate('2026-11-06');
  assert.equal(app.invoiceVideoCandidates(tasks, { ...invoice, videoDateBasis: 'completed' }).length, 1);
  assert.equal(app.invoiceVideoCandidates(tasks, { ...invoice, client: '' }).length, 0);
});

test('adding all matching invoice videos preserves hours, avoids duplicates and never infers hours from task duration', () => {
  const app = client();
  const state = app.getState();
  state.invoices.editor = invoiceDraft({ lines: [], defaultRate: 30 });
  state.tasks = [listTask('VID-1', '', { category: 'Video editing', clients: ['Acme'], start: app.parseDate('2026-11-03'), end: app.parseDate('2026-11-16'), duration: 14 })];
  app.addMatchingInvoiceVideos();
  assert.equal(state.invoices.editor.lines.length, 1);
  assert.equal(state.invoices.editor.lines[0].hours, '');
  assert.equal(state.invoices.editor.lines[0].rate, 30);
  state.invoices.editor.lines[0].hours = 3.5;
  app.addMatchingInvoiceVideos();
  assert.equal(state.invoices.editor.lines.length, 1);
  assert.equal(app.invoiceTotals(state.invoices.editor).minor, 10500);
});

test('changing invoice timelines requires confirmation before discarding entered video hours', () => {
  const app = client();
  const state = app.getState();
  state.invoices.editor = invoiceDraft();
  app.confirm = () => false;
  app.setInvoiceRange('periodMode', 'custom');
  assert.equal(state.invoices.editor.lines[0].hours, 3.5);
  app.setInvoiceRange('periodEnd', '2026-11-30');
  assert.equal(state.invoices.editor.periodEnd, '2026-11-16');
  assert.equal(state.invoices.editor.lines.length, 1);
  app.confirm = () => true;
  app.setInvoiceRange('periodEnd', '2026-11-30');
  assert.equal(state.invoices.editor.periodEnd, '2026-11-30');
  assert.equal(state.invoices.editor.dueDate, '2026-11-30');
  assert.equal(state.invoices.editor.lines.length, 0);
  app.setInvoiceRange('periodMode', 'fortnight');
  assert.equal(state.invoices.editor.periodEnd, '2026-11-16');
});

test('saved custom invoices retain their selection rules and hourly totals', () => {
  const app = invoiceServer();
  const saved = app.context.saveInvoice(invoiceDraft({ periodMode: 'custom', periodStart: '2026-11-01', periodEnd: '2026-11-30', videoDateBasis: 'completed', videoScope: 'topLevel', includeUnassigned: true })).invoice;
  const reopened = app.context.getInvoice(saved.id).invoice;
  assert.equal(reopened.periodMode, 'custom');
  assert.equal(reopened.videoDateBasis, 'completed');
  assert.equal(reopened.videoScope, 'topLevel');
  assert.equal(reopened.includeUnassigned, true);
  assert.equal(reopened.totalMinor, 8750);
});

test('task hours roll up direct children exactly without rewriting dates or formulas', () => {
  const parent = taskRow('VID-001'); parent[15] = 9;
  const first = taskRow('VID-002', 'VID-001'); first[15] = 2.25;
  const second = taskRow('VID-003', 'VID-001'); second[15] = 3.5;
  const app = server([parent, first, second]);
  app.context.initializeTaskHeaders_(app.sheet);
  const writes = app.writes.length;
  const tasks = app.context.getTasks().tasks;
  assert.equal(tasks[0].hours, 9);
  assert.equal(tasks[0].subtaskHours, 5.75);
  assert.equal(tasks[0].totalHours, 5.75);
  assert.equal(tasks[1].totalHours, 2.25);
  assert.equal(app.writes.length, writes);
  assert.equal(app.rows[1][7], '=G2-F2+1');
});

test('Hours upgrade safely appends P, rejects occupied P, and legacy reads stay zero', () => {
  const app = server([taskRow('VID-001')]);
  assert.equal(app.context.getTasks().tasks[0].hours, 0);
  assert.equal(app.writes.length, 0);
  app.context.upgradeTaskDatabase();
  assert.equal(app.rows[0][15], 'Hours');
  assert.equal(app.backups.length, 1);
  const writes = app.writes.length;
  app.context.upgradeTaskDatabase();
  assert.equal(app.writes.length, writes);
  app.rows[0][15] = 'Other';
  assert.throws(() => app.context.initializeTaskHeaders_(app.sheet), /Column P/);
  assert.equal(app.writes.length, writes);
  for (const value of [-1, Infinity, NaN, 1.111, 10001, true]) assert.throws(() => app.context.normalizeTaskHours_(value), /Hours/);
  assert.equal(app.context.normalizeTaskHours_(''), 0);
});

test('single and bulk hours-only writes never touch schedule, actual dates or Duration formulas', () => {
  const parent = taskRow('VID-001');
  const first = taskRow('VID-002', 'VID-001'); first[5] = new Date(2026, 10, 3); first[6] = new Date(2026, 10, 7);
  const second = taskRow('VID-003', 'VID-001'); second[5] = new Date(2026, 10, 5); second[6] = new Date(2026, 10, 9);
  const app = server([parent, first, second]);
  app.context.initializeTaskHeaders_(app.sheet);
  app.writes.length = 0;
  app.context.updateTaskHours('VID-002', 2.25);
  assert.deepEqual(app.writes.map(write => write.column), [16, 13]);
  assert.equal(app.context.getTasks().tasks[0].totalHours, 2.25);
  app.writes.length = 0;
  app.context.updateSubtasks('VID-001', ['VID-002', 'VID-003'], { hours: 3.5 });
  assert.deepEqual(app.writes.map(write => write.column), [16, 13]);
  assert.equal(app.context.getTasks().tasks[0].totalHours, 7);
  assert.equal(app.rows[2][5], first[5]);
  assert.equal(app.rows[2][6], first[6]);
  assert.equal(app.rows[2][7], '=G2-F2+1');
  const count = app.writes.length;
  assert.throws(() => app.context.updateTaskHours('VID-001', 10), /calculated from subtasks/);
  assert.equal(app.writes.length, count);
  app.context.updateTaskHours('VID-002', 0);
  assert.equal(app.rows[2][15], 0);
});

test('normal detail/drag updates preserve omitted hours and new subtasks start at zero', () => {
  const parent = taskRow('VID-001'); parent[5] = new Date(2026, 10, 1); parent[6] = new Date(2026, 10, 10);
  const app = server([parent]);
  app.context.initializeTaskHeaders_(app.sheet);
  app.context.updateTaskHours('VID-001', 9);
  app.context.updateTask({ taskId: 'VID-001', taskName: 'Moved', category: 'Video editing', priority: 'High', startDate: '2026-11-02', endDate: '2026-11-11' });
  assert.equal(app.rows[1][15], 9);
  app.context.createSubtasks('VID-001', ['Step'], 2);
  assert.equal(app.rows[2][15], 0);
  assert.equal(app.rows[3][15], 0);
  assert.equal(app.context.getTasks().tasks[0].totalHours, 0);
  assert.equal(app.context.getTasks().tasks[0].hours, 9);
});

test('hour metrics and progress weight child hours and do not count parent totals twice', () => {
  const app = client();
  const tasks = [listTask('VID-1', '', { hours: 9 }), listTask('VID-2', 'VID-1', { hours: 3, status: 'Done' }), listTask('VID-3', 'VID-1', { hours: 2 }), listTask('VID-4', '', { hours: 1.5, status: 'Done' })];
  app.applyTaskHourRollups(tasks);
  assert.equal(tasks[0].totalHours, 5);
  assert.equal(tasks[0].completedHours, 3);
  const summary = app.taskHourMetrics(tasks, tasks);
  assert.equal(summary.total, 6.5);
  assert.equal(summary.completed, 4.5);
  assert.equal(app.taskHourMetrics([tasks[0]], tasks).total, 0);
  assert.equal(app.taskHourMetrics([tasks[0], tasks[1]], tasks).total, 3);
  assert.match(app.renderHoursProgress(3, 5), /value="60"/);
  assert.match(app.renderHoursProgress(0, 0), /value="0"/);
  assert.match(app.renderHoursProgress(3, 5), /3 \/ 5 hours/);
});

test('editing only a subtask hours value routes through the hours-only endpoint', () => {
  const app = loadingClient();
  const state = app.getState();
  const child = listTask('VID-2', 'VID-1', { hours: 2, totalHours: 2, category: 'Video editing', start: app.parseDate('2026-11-03'), end: app.parseDate('2026-11-07') });
  state.loaded = true;
  state.editId = child.id;
  state.taskById.set(child.id, child);
  state.tasks = [child];
  for (const [id, value] of Object.entries({ taskName: child.name, category: child.category, priority: child.priority, startDate: '2026-11-03', endDate: '2026-11-07', description: '', parentTaskId: '', taskStatus: child.status, taskHours: '3.5' })) app.elements.set(id, { value });
  app.elements.set('formError', { style: {} });
  app.elements.set('saveBtn', {});
  app.saveTask({ preventDefault() {} });
  assert.equal(app.calls[0].method, 'updateTaskHours');
  assert.deepEqual(Array.from(app.calls[0].args), ['VID-2', '3.5']);
});

test('completed hours and parent totals update on reopening, transfer and deletion without changing planned dates', () => {
  const first = taskRow('VID-002', 'VID-001', 'Done'); first[15] = 2.25; first[5] = new Date(2026, 10, 3); first[6] = new Date(2026, 10, 7);
  const second = taskRow('VID-003', 'VID-001', 'To Do'); second[15] = 3.5;
  const app = server([taskRow('VID-001'), first, second, taskRow('VID-004')]);
  app.context.initializeTaskHeaders_(app.sheet);
  assert.equal(app.context.getTasks().tasks[0].completedHours, 2.25);
  app.context.updateTaskStatus('VID-003', 'Done');
  assert.equal(app.context.getTasks().tasks[0].completedHours, 5.75);
  app.context.updateTaskStatus('VID-003', 'To Do');
  assert.equal(app.context.getTasks().tasks[0].completedHours, 2.25);
  app.context.setTaskParent('VID-002', 'VID-004');
  const moved = app.context.getTasks().tasks;
  assert.equal(moved.find(task => task.taskId === 'VID-001').totalHours, 3.5);
  assert.equal(moved.find(task => task.taskId === 'VID-004').totalHours, 2.25);
  assert.equal(app.rows[2][15], 2.25);
  assert.equal(app.rows[2][5], first[5]);
  assert.equal(app.rows[2][6], first[6]);
  app.context.deleteTask('VID-002');
  assert.equal(app.context.getTasks().tasks.find(task => task.taskId === 'VID-004').totalHours, 0);
});

test('display dates use readable full and compact English months without changing stored date keys', () => {
  const app = client();
  const compact = ['Jan', 'Feb', 'March', 'April', 'May', 'June', 'July', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  compact.forEach((month, index) => {
    const key = '2026-' + String(index + 1).padStart(2, '0') + '-03';
    assert.equal(app.formatDisplayDate(key, true), month + ' 3, 2026');
    assert.equal(app.dateKey(app.parseDate(key)), key);
  });
  assert.equal(app.formatDisplayDate('2026-01-03'), 'January 3, 2026');
  assert.equal(app.formatDisplayDate('2026-11-03'), 'November 3, 2026');
  assert.equal(app.formatDisplayDate('2024-02-29', true, false), 'Feb 29');
  assert.equal(app.formatDisplayDate('invalid'), '');
  assert.match(app.displayDate('2026-11-03'), /datetime="2026-11-03"/);
  assert.match(app.displayDate('2026-11-03'), /November 3, 2026/);
  assert.match(app.displayDate('2026-11-03'), /Nov 3, 2026/);
});

test('invoice preview and client text use named months while invoice dates remain ISO', async () => {
  const app = client();
  const invoice = invoiceDraft();
  app.getState().invoices.editor = invoice;
  app.updateInvoicePreview();
  const markup = app.elements.get('invoicePrintable').innerHTML;
  assert.match(markup, /November 3, 2026/);
  assert.match(markup, /November 16, 2026/);
  app.copiedText = '';
  vm.runInContext('navigator={clipboard:{writeText:async text=>{copiedText=text;}}};showToast=()=>{};', app);
  await app.copyInvoiceText();
  assert.match(app.copiedText, /November 3, 2026 - November 16, 2026/);
  assert.equal(invoice.periodStart, '2026-11-03');
  assert.equal(invoice.dueDate, '2026-11-16');
});