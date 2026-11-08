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
  const listeners = new Map();
  const context = vm.createContext({
    document: {
      querySelectorAll: () => [],
      addEventListener(type, handler) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(handler);
      },
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, {
          innerHTML: '', value: '', validationMessage: '', addEventListener() {},
          setCustomValidity(message) { this.validationMessage = message; },
          setAttribute() {}, removeAttribute() {},
          checkValidity() { return !this.validationMessage; },
          reportValidity() { return this.checkValidity(); }
        });
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
  context.listeners = listeners;
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

function zonedParts(date, timezone) {
  return Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
}

function parseZonedDate(value, timezone) {
  const [year, month, day] = value.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day);
  let timestamp = target;
  for (let attempt = 0; attempt < 3; attempt++) {
    const parts = zonedParts(new Date(timestamp), timezone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    timestamp += target - represented;
  }
  return new Date(timestamp);
}

function server(records, missingSheet = false, failAfter = Infinity, documentLock = true, timezone = 'UTC') {
  const headers = ['Task ID', 'Task Name', 'Category', 'Priority', 'Status', 'Start Date', 'End Date', 'Duration', 'Description', 'Actual Start', 'Actual End', 'Created At', 'Updated At', 'Parent Task ID', 'Clients'];
  const rows = [headers, ...records.map(row => row.slice())];
  const ledgers = new Map();
  let maxColumns = 15;
  const writes = [];
  const backups = [];
  let releases = 0;
  let uuidCounter = 0;
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
        getFormulas: () => Array.from({ length: height }, (_, offset) => Array.from({ length: width }, (_, index) => {
          const value = rows[row - 1 + offset]?.[column - 1 + index];
          return typeof value === 'string' && value.startsWith('=') ? value : '';
        })),
        getValue: () => rows[row - 1]?.[column - 1] ?? '',
        getDisplayValues: () => rows.slice(row - 1, row - 1 + height).map(values => values.slice(column - 1, column - 1 + width).map(String)),
        setValues(values) {
          assert.equal(values.length, height);
          values.forEach(valuesRow => assert.equal(valuesRow.length, width));
          if (writes.length === failAfter) throw new Error('Injected write failure');
          writes.push({ row, column, height, width, values });
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
  function makeLedgerSheet() {
    const ledgerRows = [];
    const deletions = [];
    return {
      rows: ledgerRows, deletions,
      getLastRow: () => ledgerRows.length,
      getMaxRows: () => 10000,
      getRange(row, column, height = 1, width = 1) {
        return {
          getValues: () => Array.from({ length: height }, (_, offset) => Array.from({ length: width }, (_, index) => ledgerRows[row - 1 + offset]?.[column - 1 + index] ?? '')),
          setValues(values) {
            values.forEach((valuesRow, offset) => {
              if (!ledgerRows[row - 1 + offset]) ledgerRows[row - 1 + offset] = [];
              valuesRow.forEach((value, index) => { ledgerRows[row - 1 + offset][column - 1 + index] = value; });
            });
            return this;
          },
          setNumberFormat() { return this; }
        };
      },
      deleteRows(row, count) { deletions.push([row, count]); ledgerRows.splice(row - 1, count); }
    };
  }
  const spreadsheet = {
    getSheetByName: name => missingSheet ? null : name === 'Task_Master' ? sheet : ledgers.get(name) || null,
    insertSheet(name) { const result = makeLedgerSheet(); ledgers.set(name, result); return result; },
    getSpreadsheetTimeZone: () => timezone,
    toast() {}
  };
  const context = vm.createContext({
    Date,
    Utilities: {
      parseDate: (value, zone) => parseZonedDate(value, zone),
      formatDate(date, zone, format) {
        const parts = zonedParts(date, zone);
        if (format === 'yyyy-MM-dd') return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
        return date.toISOString().slice(0, 10);
      },
      getUuid: () => 'time-entry-test-id-' + (++uuidCounter)
    },
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet, getUi: () => ui, flush() {} },
    LockService: {
      getDocumentLock: () => documentLock ? { waitLock() {}, releaseLock() { releases++; } } : null,
      getScriptLock: () => ({ waitLock() {}, releaseLock() { releases++; } })
    }
  });
  vm.runInContext(backend, context);
  return { context, rows, writes, backups, ui, sheet, ledgers, setMaxColumns: count => { maxColumns = count; }, releases: () => releases };
}

test('backend and frontend scripts parse', () => {
  assert.doesNotMatch(backend, /\|\|=|&&=|\?\?=/);
  new vm.Script(backend);
  new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
});

test('task date inputs round-trip in the spreadsheet time zone', () => {
  const app = server([], false, Infinity, true, 'Asia/Manila');
  const parsed = app.context.parseTaskDate_('2026-11-04');
  assert.equal(app.context.Utilities.formatDate(parsed, 'Asia/Manila', 'yyyy-MM-dd'), '2026-11-04');
  assert.equal(app.context.parseTaskDate_('2026-02-30'), null);
});

test('task version tokens use spreadsheet-stable second precision', () => {
  const child = taskRow('VID-002', 'VID-001');
  child[12] = new Date('2026-11-04T12:34:56.789Z');
  const app = server([taskRow('VID-001'), child]);
  app.context.initializeTaskHeaders_(app.sheet);
  const timestamp = new Date('2026-11-04T12:34:56.789Z');
  const loadedVersion = app.context.getTasks().tasks[1].updatedAt;
  assert.equal(loadedVersion, Date.parse('2026-11-04T12:34:56Z'));
  app.rows[2][12] = new Date(loadedVersion);
  assert.doesNotThrow(() => app.context.updateTaskHours('VID-002', 1, loadedVersion));
  const nextVersion = app.context.getTasks().tasks[1].updatedAt;
  assert.ok(nextVersion > loadedVersion);
  assert.throws(() => app.context.updateTaskHours('VID-002', 2, loadedVersion), /changed since it was loaded/);
  assert.equal(app.context.nextTaskUpdatedAt_(timestamp, timestamp).getTime(), loadedVersion + 1000);
});

test('dated time entries use a separate lazy ledger and validate dates, hours, tasks and deletes', () => {
  const app = server([taskRow('VID-000'), taskRow('VID-001', 'VID-000')], false, Infinity, true, 'Asia/Manila');
  assert.deepEqual(Array.from(app.context.getTaskTimeEntries('VID-001').entries), []);
  assert.equal(app.ledgers.has('Time_Entry_Master'), false);
  assert.throws(() => app.context.saveTaskTimeEntry('VID-000', '2026-11-05', 1, 'Parent log'), /only be logged on subtasks/);
  assert.equal(app.ledgers.has('Time_Entry_Master'), false);

  const saved = app.context.saveTaskTimeEntry('VID-001', '2026-11-05', 2.5, 'Opening edit');
  assert.equal(saved.success, true);
  assert.equal(saved.entry.date, '2026-11-05');
  assert.equal(saved.entry.hours, 2.5);
  assert.equal(app.rows[1][15], undefined);
  assert.equal(app.rows[2][15], undefined);
  app.rows[2][14] = '["Acme"]';
  const listed = app.context.getTaskTimeEntries('VID-001').entries;
  assert.deepEqual(Array.from(listed, entry => [entry.date, entry.hours, entry.note]), [['2026-11-05', 2.5, 'Opening edit']]);
  const report = app.context.getTimeEntrySummary('2026-11-05', '2026-11-05', 'client:Acme');
  assert.equal(report.totalHours, 2.5);
  assert.deepEqual(Array.from(report.entries, entry => [entry.taskName, entry.date]), [['VID-001', '2026-11-05']]);
  assert.equal(app.context.getTimeEntrySummary('2026-11-04', '2026-11-04', 'client:Acme').entries.length, 0);
  assert.equal(app.context.getTimeEntrySummary('2026-11-05', '2026-11-05', 'unassigned').entries.length, 0);

  assert.throws(() => app.context.saveTaskTimeEntry('VID-001', '2026-02-30', 1, ''), /valid work date/);
  assert.throws(() => app.context.saveTaskTimeEntry('VID-001', '2026-11-05', 24.01, ''), /no more than 24 hours/);
  assert.throws(() => app.context.saveTaskTimeEntry('MISSING', '2026-11-05', 1, ''), /Task ID not found/);
  assert.throws(() => app.context.deleteTaskTimeEntry('VID-001', 'TE-missing'), /Time entry not found/);
  assert.equal(app.context.deleteTaskTimeEntry('VID-001', saved.entry.id).success, true);
  assert.deepEqual(Array.from(app.context.getTaskTimeEntries('VID-001').entries), []);
  const afterEntryDelete = app.context.getTasks().tasks;
  assert.equal(afterEntryDelete.find(task => task.taskId === 'VID-001').totalHours, 0);
  assert.equal(afterEntryDelete.find(task => task.taskId === 'VID-000').totalHours, 0);
  app.context.saveTaskTimeEntry('VID-001', '2026-11-04', 1, 'First');
  app.context.saveTaskTimeEntry('VID-001', '2026-11-05', 2, 'Second');
  assert.equal(app.context.deleteTasks(['VID-001']).success, true);
  assert.equal(app.ledgers.get('Time_Entry_Master').rows.length, 1);
  assert.deepEqual(Array.from(app.ledgers.get('Time_Entry_Master').deletions.at(-1)), [2, 2]);
});

test('bulk time entries validate every direct leaf subtask before one ledger write', () => {
  const app = server([
    taskRow('VID-000'), taskRow('VID-001', 'VID-000'), taskRow('VID-002', 'VID-000'),
    taskRow('VID-010'), taskRow('VID-011', 'VID-010')
  ]);
  const saved = app.context.saveTaskTimeEntries('VID-000', '2026-11-06', [
    { taskId: 'VID-001', hours: 1.25, note: 'Review' },
    { taskId: 'VID-002', hours: 0.5, note: 'Polish' }
  ]);
  assert.deepEqual(Array.from(saved.entries, entry => [entry.taskId, entry.date, entry.hours, entry.note]), [
    ['VID-001', '2026-11-06', 1.25, 'Review'], ['VID-002', '2026-11-06', 0.5, 'Polish']
  ]);
  assert.equal(app.ledgers.get('Time_Entry_Master').rows.length, 3);
  assert.equal(app.ledgers.get('Time_Entry_Master').rows[1][0] === app.ledgers.get('Time_Entry_Master').rows[2][0], false);
  assert.equal(app.rows[2][15], undefined);
  assert.equal(app.rows[3][15], undefined);

  assert.throws(() => app.context.saveTaskTimeEntries('VID-000', '2026-11-06', [
    { taskId: 'VID-001', hours: 1, note: '' }, { taskId: 'VID-011', hours: 1, note: '' }
  ]), /direct subtask/);
  assert.throws(() => app.context.saveTaskTimeEntries('VID-000', '2026-11-06', [
    { taskId: 'VID-001', hours: 1, note: '' }, { taskId: 'VID-001', hours: 1, note: '' }
  ]), /Duplicate/);
  assert.throws(() => app.context.saveTaskTimeEntries('VID-000', '2026-11-06', [
    { taskId: 'VID-001', hours: 1, note: '' }, { taskId: 'MISSING', hours: 1, note: '' }
  ]), /not found/);
  assert.equal(app.ledgers.get('Time_Entry_Master').rows.length, 3);
});

test('dated subtask entries feed task and parent progress without writing Task_Master Hours', () => {
  const parent = taskRow('VID-000');
  const completedChild = taskRow('VID-001', 'VID-000', 'Done');
  const app = server([parent, completedChild]);
  app.context.initializeTaskHeaders_(app.sheet);
  app.rows[2][15] = 1.25;

  app.context.saveTaskTimeEntry('VID-001', '2026-11-05', 0.5, 'Final review');
  const updatedAt = app.context.getTasks().tasks.find(task => task.taskId === 'VID-001').updatedAt;
  assert.throws(() => app.context.setTaskParent('VID-001', ''), /dated entries/);

  const tasks = app.context.getTasks().tasks;
  const loadedParent = tasks.find(task => task.taskId === 'VID-000');
  const loadedChild = tasks.find(task => task.taskId === 'VID-001');
  assert.equal(loadedChild.hours, 1.25);
  assert.equal(loadedChild.timeEntryHours, 0.5);
  assert.equal(loadedChild.totalHours, 1.25);
  assert.equal(loadedChild.completedHours, 0.5);
  assert.equal(loadedParent.totalHours, 1.25);
  assert.equal(loadedParent.completedHours, 0.5);
  assert.equal(app.rows[2][15], 1.25);
  app.context.updateTaskHours('VID-001', 2, updatedAt);
  assert.equal(app.context.getTasks().tasks.find(task => task.taskId === 'VID-001').totalHours, 2);
  const revisedAt = app.context.getTasks().tasks.find(task => task.taskId === 'VID-001').updatedAt;
  app.context.updateSubtasks('VID-000', ['VID-001'], { hours: 1.25 });
  const revised = app.context.getTasks().tasks;
  assert.equal(revised.find(task => task.taskId === 'VID-001').totalHours, 1.25);
  assert.equal(revised.find(task => task.taskId === 'VID-001').completedHours, 0.5);
  assert.notEqual(revised.find(task => task.taskId === 'VID-001').updatedAt, revisedAt);
  app.context.updateTaskStatus('VID-001', 'In Progress');
  const activeTasks = app.context.getTasks().tasks;
  assert.equal(activeTasks.find(task => task.taskId === 'VID-001').totalHours, 1.25);
  assert.equal(activeTasks.find(task => task.taskId === 'VID-001').completedHours, 0.5);
  assert.equal(activeTasks.find(task => task.taskId === 'VID-000').totalHours, 1.25);
  assert.equal(activeTasks.find(task => task.taskId === 'VID-000').completedHours, 0.5);
});

test('one logged hour against one expected hour remains one of one when Done', () => {
  const app = server([taskRow('VID-000'), taskRow('VID-001', 'VID-000', 'Done')]);
  app.context.initializeTaskHeaders_(app.sheet);
  app.rows[2][15] = 1;
  app.context.saveTaskTimeEntry('VID-001', '2026-11-05', 1, 'Completed review');

  const tasks = app.context.getTasks().tasks;
  const parent = tasks.find(task => task.taskId === 'VID-000');
  const child = tasks.find(task => task.taskId === 'VID-001');
  assert.equal(child.totalHours, 1);
  assert.equal(child.completedHours, 1);
  assert.equal(parent.totalHours, 1);
  assert.equal(parent.completedHours, 1);
  assert.equal(app.rows[2][15], 1);
});

test('Done status does not count a manual estimate as actual logged time', () => {
  const app = server([taskRow('VID-000'), taskRow('VID-001', 'VID-000', 'Done')]);
  app.context.initializeTaskHeaders_(app.sheet);
  app.rows[2][15] = 2;

  const tasks = app.context.getTasks().tasks;
  const parent = tasks.find(task => task.taskId === 'VID-000');
  const child = tasks.find(task => task.taskId === 'VID-001');
  assert.equal(child.totalHours, 2);
  assert.equal(child.completedHours, 0);
  assert.equal(parent.totalHours, 2);
  assert.equal(parent.completedHours, 0);
});

test('dated entries feed progress bars while expected Hours remain editable', () => {
  const app = client();
  const state = app.getState();
  const parent = app.normalizeTask({ taskId: 'VID-PARENT', taskName: 'Project', status: 'To Do' });
  const child = app.normalizeTask({ taskId: 'VID-CHILD', taskName: 'Review', parentTaskId: 'VID-PARENT', status: 'Done', hours: 1, timeEntryHours: 1, hasTimeEntries: true });
  state.tasks = [parent, child];
  state.childrenByParent.set(parent.id, [child]);
  app.applyTaskHourRollups(state.tasks);
  assert.equal(child.totalHours, 1);
  assert.equal(child.completedHours, 1);
  assert.equal(parent.totalHours, 1);
  assert.equal(parent.completedHours, 1);

  app.elements.set('taskHours', { value: '', readOnly: false, removeAttribute() {} });
  app.elements.set('taskHoursLabel', { textContent: '' });
  app.elements.set('taskHoursProgress', { innerHTML: '' });
  app.updateTaskHoursControl(child, true);
  assert.equal(app.elements.get('taskHours').readOnly, false);
  assert.equal(app.elements.get('taskHours').value, '1');
  assert.equal(app.elements.get('taskHoursLabel').textContent, 'Expected hours');
  assert.match(app.elements.get('taskHoursProgress').innerHTML, /1 hour logged \/ 1 hour expected/);

  child.status = 'In Progress';
  app.applyTaskHourRollups(state.tasks);
  assert.equal(child.totalHours, 1);
  assert.equal(child.completedHours, 1);
  assert.equal(parent.completedHours, 1);
});

test('bulk expected-Hours edits remain available for selected tasks with dated entries', () => {
  const app = client();
  const state = app.getState();
  const parent = listTask('VID-PARENT');
  const child = listTask('VID-CHILD', parent.id, { hours: 0, timeEntryHours: 0.5, hasTimeEntries: true });
  state.taskById.set(parent.id, parent);
  state.taskById.set(child.id, child);
  state.subtaskPanel.parentId = parent.id;
  state.subtaskPanel.selected.add(child.id);
  state.subtaskPanel.patch.hours = 1;
  app.elements.set('panelBulkStatus', { value: 'To Do' });
  app.elements.set('formError', { textContent: '', style: {} });
  app.showToast = () => {};
  let request;
  let success;
  const runner = {
    withSuccessHandler(callback) { success = callback; return this; },
    withFailureHandler() { return this; },
    updateSubtasks(...args) { request = args; success({ success: true }); }
  };
  app.mutationRunner = () => runner;
  app.loadTasks = () => {};

  app.runPanelSubtaskAction('edit');

  assert.equal(request[0], parent.id);
  assert.deepEqual(Array.from(request[1]), [child.id]);
  assert.deepEqual(JSON.parse(JSON.stringify(request[2])), { hours: 1 });
});

test('parent subtask panel logs distinct entries for selected leaf subtasks in one request', () => {
  const app = client();
  const state = app.getState();
  const parent = listTask('VID-PARENT', '', { name: 'Project' });
  const first = listTask('VID-CHILD-1', parent.id, { name: 'Review' });
  const second = listTask('VID-CHILD-2', parent.id, { name: 'Polish' });
  state.tasks = [parent, first, second];
  state.taskById = new Map(state.tasks.map(task => [task.id, task]));
  app.resetSubtaskPanel(parent.id);
  state.subtaskPanel.selected.add(first.id);
  state.subtaskPanel.selected.add(second.id);
  state.subtaskPanel.timeEntryDate = '2026-11-06';
  app.setPanelTimeEntryDraft(first.id, 'hours', '1.25');
  app.setPanelTimeEntryDraft(first.id, 'note', 'Review');
  app.setPanelTimeEntryDraft(second.id, 'hours', '0.5');
  app.setPanelTimeEntryDraft(second.id, 'note', 'Polish');
  app.renderPanelTimeEntryRows();
  const rows = app.elements.get('panelTimeEntryRows').innerHTML;
  assert.match(rows, /Review/);
  assert.match(rows, /Polish/);
  assert.match(rows, /value="1\.25"/);
  assert.match(rows, /value="0\.5"/);

  let success;
  let request;
  let refreshed = false;
  const runner = {
    withSuccessHandler(callback) { success = callback; return this; },
    withFailureHandler() { return this; },
    saveTaskTimeEntries(...args) { request = args; success({ success: true, entries: [{}, {}] }); }
  };
  app.mutationRunner = () => runner;
  app.showToast = () => {};
  app.loadTasks = () => { refreshed = true; };
  app.savePanelTimeEntries();

  assert.equal(request[0], parent.id);
  assert.equal(request[1], '2026-11-06');
  assert.deepEqual(Array.from(request[2], entry => [entry.taskId, entry.hours, entry.note]), [
    ['VID-CHILD-1', 1.25, 'Review'], ['VID-CHILD-2', 0.5, 'Polish']
  ]);
  assert.equal(refreshed, true);
  assert.equal(Object.keys(state.subtaskPanel.timeEntryDrafts).length, 0);
});

test('task editor exposes dated time entry controls and renders a separate logged-hours list', () => {
  assert.match(html, /\.form-field\[hidden\], \.form-grid\[hidden\] \{ display: none; \}/);
  assert.match(html, /<fieldset id="taskTimeEntryForm" class="task-time-entry-form" disabled>/);
  assert.match(html, /id="timeEntryDate" type="date" required/);
  assert.match(html, /id="timeEntryHours" type="number" min="0\.01" max="24" step="0\.01" placeholder="e.g. 1\.5" required/);
  assert.match(html, /Entry hours \*<input class="field-control" id="timeEntryHours"/);
  assert.match(html, /class="task-recurrence-toggle" for="repeatTask"/);
  assert.match(html, /class="task-time-entry-actions"/);
  assert.match(html, /id="timeEntryNote" maxlength="200"/);
  assert.match(html, /id="taskTimeEntryParentNotice" class="task-meta" hidden/);
  const app = client();
  const state = app.getState();
  state.editId = 'VID-001';
  state.timeEntries.items = [
    { id: 'TE-1', date: '2026-11-05', hours: 2.5, note: '<script>unsafe</script>' },
    { id: 'TE-2', date: '2026-11-04', hours: 1, note: '' }
  ];
  app.elements.set('taskTimeEntriesList', { innerHTML: '' });
  app.elements.set('taskTimeEntriesTotal', { textContent: '' });
  app.elements.set('timeEntryError', { textContent: '' });
  app.elements.set('saveTimeEntryBtn', { disabled: false });
  app.renderTaskTimeEntries();
  assert.equal(app.elements.get('taskTimeEntriesTotal').textContent, '3.5 hours logged');
  assert.match(app.elements.get('taskTimeEntriesList').innerHTML, /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.match(app.elements.get('taskTimeEntriesList').innerHTML, /deleteTaskTimeEntry/);
});

test('only leaf subtasks can show the task time-entry form', () => {
  const app = client();
  const state = app.getState();
  state.childrenByParent.set('VID-PARENT', []);
  state.childrenByParent.set('VID-SUBTASK', ['VID-CHILD']);
  assert.equal(app.taskCanLogTime(listTask('VID-PARENT')), false);
  assert.equal(app.taskCanLogTime(listTask('VID-SUBTASK', 'VID-PARENT')), false);
  assert.equal(app.taskCanLogTime(listTask('VID-LEAF', 'VID-PARENT')), true);
});

test('Metrics renders dated actual entries separately from task Hours totals', () => {
  assert.match(html, /id="metricsTimeEntryReport"/);
  const app = client();
  app.getState().timeEntryReport = {
    key: '2026-11-01|2026-11-30|client:Acme', loading: false, error: '', totalHours: 6.5,
    entries: [
      { id: 'TE-1', taskId: 'VID-001', taskName: 'Opening edit', date: '2026-11-05', hours: 2.5, note: 'Cut review' },
      { id: 'TE-2', taskId: 'VID-001', taskName: 'Opening edit', date: '2026-11-05', hours: 1.5, note: 'Second pass' },
      { id: 'TE-3', taskId: 'VID-001', taskName: 'Opening edit', date: '2026-11-04', hours: 2.5, note: 'Review' }
    ]
  };
  app.elements.set('metricsTimeEntryReport', { innerHTML: '' });
  app.renderDashboardTimeEntryReport();
  const report = app.elements.get('metricsTimeEntryReport').innerHTML;
  assert.match(report, /6\.5 hours logged/);
  assert.match(report, /4 h/);
  assert.match(report, /2\.5 h/);
  assert.match(report, /class="time-entry-day-fill" style="width:100%"/);
  assert.match(report, /Opening edit/);
  assert.match(report, /Cut review/);
});

test('dated entries feed subtask and parent progress while expected Hours stay editable', () => {
  const app = client();
  const state = app.getState();
  const parent = app.normalizeTask({ taskId: 'VID-PARENT', taskName: 'Project', status: 'To Do' });
  const child = app.normalizeTask({
    taskId: 'VID-CHILD', taskName: 'Review', parentTaskId: 'VID-PARENT', status: 'Done',
    hours: 1, timeEntryHours: 1, hasTimeEntries: true
  });
  state.tasks = [parent, child];
  state.childrenByParent.set(parent.id, [child]);
  app.applyTaskHourRollups(state.tasks);
  assert.equal(child.totalHours, 1);
  assert.equal(child.completedHours, 1);
  assert.equal(parent.totalHours, 1);
  assert.equal(parent.completedHours, 1);

  app.elements.set('taskHours', { value: '', readOnly: false, removeAttribute() {} });
  app.elements.set('taskHoursLabel', { textContent: '' });
  app.elements.set('taskHoursProgress', { innerHTML: '' });
  app.updateTaskHoursControl(child, true);
  assert.equal(app.elements.get('taskHours').readOnly, false);
  assert.equal(app.elements.get('taskHours').value, '1');
  assert.equal(app.elements.get('taskHoursLabel').textContent, 'Expected hours');
  assert.match(app.elements.get('taskHoursProgress').innerHTML, /1 hour logged \/ 1 hour expected/);
});

test('task time-entry form submits its task, date, hours and note then clears the draft fields', () => {
  const app = client();
  const state = app.getState();
  state.loaded = true;
  state.editId = 'VID-001';
  state.timeEntries.taskId = 'VID-001';
  let success;
  const calls = [];
  const runner = {
    withSuccessHandler(callback) { success = callback; return runner; },
    withFailureHandler() { return runner; },
    saveTaskTimeEntry(...args) {
      calls.push(args);
      success({ success: true, entry: { id: 'TE-new', taskId: 'VID-001', date: '2026-11-08', hours: 1.5, note: 'Cut review', createdAt: '2026-11-08T10:00:00Z' } });
    }
  };
  app.google = { script: { run: runner } };
  app.updateDataNotice = () => {};
  app.showToast = () => {};
  let taskRefreshes = 0;
  app.loadTasks = () => { taskRefreshes++; };
  app.elements.set('timeEntryDate', { value: '2026-11-08', checkValidity: () => true, reportValidity() {} });
  app.elements.set('timeEntryHours', { value: '1.5', checkValidity: () => true, reportValidity() {} });
  app.elements.set('timeEntryNote', { value: 'Cut review' });
  app.elements.set('taskTimeEntriesList', { innerHTML: '' });
  app.elements.set('taskTimeEntriesTotal', { textContent: '' });
  app.elements.set('timeEntryError', { textContent: '' });
  app.elements.set('saveTimeEntryBtn', { disabled: false });

  app.saveTaskTimeEntry();

  assert.deepEqual(calls, [['VID-001', '2026-11-08', '1.5', 'Cut review']]);
  assert.equal(state.timeEntries.items.length, 1);
  assert.equal(taskRefreshes, 1);
  assert.equal(app.elements.get('timeEntryHours').value, '');
  assert.equal(app.elements.get('timeEntryNote').value, '');
  assert.match(app.elements.get('taskTimeEntriesList').innerHTML, /Cut review/);
});

test('current date rolls over in the spreadsheet time zone and refreshes Metrics attention', () => {
  const app = client();
  const state = app.getState();
  state.loaded = true;
  state.activeView = 'dashboard';
  state.spreadsheetTimeZone = 'America/Los_Angeles';
  state.spreadsheetToday = '2026-11-03';
  let dashboardRenders = 0;
  let statsRenders = 0;
  app.renderDashboard = () => { dashboardRenders++; };
  app.renderStats = () => { statsRenders++; };
  assert.equal(app.dateKeyInTimeZone(new Date('2026-11-04T07:30:00Z'), state.spreadsheetTimeZone), '2026-11-03');
  assert.equal(app.refreshSpreadsheetToday(new Date('2026-11-04T08:01:00Z')), true);
  assert.equal(state.spreadsheetToday, '2026-11-04');
  assert.equal(dashboardRenders, 1);
  assert.equal(statsRenders, 1);
  assert.equal(app.refreshSpreadsheetToday(new Date('2026-11-04T08:02:00Z')), false);
  assert.equal(dashboardRenders, 1);
});

test('spreadsheet Timeline sizing expands a fresh sheet to its date span', () => {
  const app = server([]);
  let columns = 26;
  app.context.ensureTimelineColumns_({
    getMaxColumns: () => columns,
    insertColumnsAfter(after, count) {
      assert.equal(after, 26);
      columns += count;
    }
  }, 95);
  assert.equal(columns, 95);
  const timezone = 'UTC';
  assert.equal(app.context.timelineDayCount_([
    [new Date('2026-01-01T00:00:00Z'), new Date('2028-12-31T00:00:00Z')]
  ], timezone), 1096);
  assert.equal(app.context.timelineDayCount_([], timezone), 90);
  assert.match(backend, /const timelineLastColumn = 5 \+ timelineDays/);
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
  const payload = { taskId: 'VID-001', taskName: 'Updated', category: 'Video editing', priority: 'High', startDate: '2026-11-03', endDate: '2026-11-05', status: 'Invalid', expectedUpdatedAt: 0 };
  assert.throws(() => app.context.updateTask(payload), /Invalid status/);
  assert.equal(app.writes.length, 0);
  app.context.updateTask({ ...payload, status: 'Done' });
  assert.equal(app.rows[1][1], 'Updated');
  assert.equal(app.rows[1][4], 'Done');
  assert.equal(app.rows[1][7], '=G2-F2+1');
});

test('task detail updates reject stale revisions without overwriting newer fields', () => {
  const app = server([taskRow('VID-001')]);
  const stale = { taskId: 'VID-001', taskName: 'Stale name', category: 'Video editing', priority: 'High', startDate: '2026-11-03', endDate: '2026-11-05', expectedUpdatedAt: 0 };
  app.context.updateTask({ ...stale, taskName: 'First save' });
  const writes = app.writes.length;
  assert.throws(() => app.context.updateTask(stale), /changed since it was loaded/);
  assert.equal(app.rows[1][1], 'First save');
  assert.equal(app.writes.length, writes);
});

test('status, bulk edits, and transfers advance task versions and invalidate stale hours forms', () => {
  const parent = taskRow('VID-001');
  const child = taskRow('VID-002', 'VID-001');
  const otherParent = taskRow('VID-003');
  const app = server([parent, child, otherParent]);
  app.context.initializeTaskHeaders_(app.sheet);
  let version = app.context.getTasks().tasks[1].updatedAt;
  app.context.updateTaskStatus('VID-002', 'In Progress');
  let nextVersion = app.context.getTasks().tasks[1].updatedAt;
  assert.ok(nextVersion > version);
  assert.throws(() => app.context.updateTaskHours('VID-002', 1, version), /changed since it was loaded/);
  version = nextVersion;
  app.context.updateSubtasks('VID-001', ['VID-002'], { priority: 'High' });
  nextVersion = app.context.getTasks().tasks[1].updatedAt;
  assert.ok(nextVersion > version);
  assert.throws(() => app.context.updateTaskHours('VID-002', 1, version), /changed since it was loaded/);
  version = nextVersion;
  app.context.setTaskParent('VID-002', 'VID-003');
  nextVersion = app.context.getTasks().tasks[1].updatedAt;
  assert.ok(nextVersion > version);
  assert.throws(() => app.context.updateTaskHours('VID-002', 1, version), /changed since it was loaded/);
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

test('hierarchy header upgrade rejects occupied column N without a parent header', () => {
  const app = server([taskRow('VID-001')]);
  app.rows[0][13] = '';
  app.rows[1][13] = 'Existing unrelated value';
  const writes = app.writes.length;
  assert.throws(() => app.context.initializeTaskHeaders_(app.sheet), /Column N contains data without a Parent Task ID header/);
  assert.equal(app.writes.length, writes);
  assert.equal(app.rows[0][13], '');
});

test('category upgrade is explicit and deterministic, and detail edits preserve or clear clients', () => {
  const app = server([taskRow('VID-001')]);
  assert.equal(app.context.categoryForUpgrade_('Graphics'), 'Graphic Design');
  assert.equal(app.context.categoryForUpgrade_('Editing'), 'Video editing');
  assert.equal(app.context.categoryForUpgrade_('Scheduling'), 'Scheduling');
  assert.throws(() => app.context.categoryForUpgrade_('Unknown'), /Unknown category/);
  app.rows[1][14] = '["Client A"]';
  const payload = { taskId: 'VID-001', taskName: 'Updated', category: 'Scheduling', priority: 'High', startDate: '2026-11-03', endDate: '2026-11-05', expectedUpdatedAt: 0 };
  app.context.updateTask(payload);
  assert.equal(app.rows[1][14], '["Client A"]');
  app.context.updateTask({ ...payload, clients: [], expectedUpdatedAt: app.context.getTasks().tasks[0].updatedAt });
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

test('hierarchy mutations reject duplicate IDs and protect logged or legacy hours', () => {
  const duplicates = server([taskRow('VID-001'), taskRow('VID-001')]);
  assert.throws(() => duplicates.context.findTaskRow(duplicates.sheet, 'VID-001'), /Duplicate task ID/);

  const parent = taskRow('VID-001');
  const child = taskRow('VID-002', 'VID-001'); child[15] = 4;
  const legacyRoot = taskRow('VID-003'); legacyRoot[15] = 9;
  const destination = taskRow('VID-004');
  const app = server([parent, child, legacyRoot, destination]);
  app.context.initializeTaskHeaders_(app.sheet);
  const writes = app.writes.length;
  assert.throws(() => app.context.setTaskParent('VID-002', ''), /logged hours/);
  assert.throws(() => app.context.setTaskParent('VID-003', 'VID-001'), /stored Hours/);
  assert.equal(app.rows[2][13], 'VID-001');
  assert.equal(app.rows[2][15], 4);
  assert.equal(app.rows[3][13], '');
  assert.equal(app.rows[3][15], 9);
  assert.equal(app.writes.length, writes);
  app.context.setTaskParent('VID-002', 'VID-004');
  assert.equal(app.rows[2][13], 'VID-004');
  assert.equal(app.rows[2][15], 4);
});

test('multi-field bulk subtask patch commits selected rows in one write and preserves intervening rows', () => {
  const parent = taskRow('VID-001');
  const first = taskRow('VID-002', 'VID-001');
  const untouched = taskRow('VID-003');
  const last = taskRow('VID-004', 'VID-001');
  const app = server([parent, first, untouched, last], false, 1);
  app.context.initializeTaskHeaders_(app.sheet);
  app.writes.length = 0;
  app.context.updateSubtasks('VID-001', ['VID-002', 'VID-004'], { category: 'Revision', priority: 'High', hours: 2 });
  assert.equal(app.writes.length, 1);
  assert.equal(app.rows[2][2], 'Revision');
  assert.equal(app.rows[2][3], 'High');
  assert.equal(app.rows[2][15], 2);
  assert.equal(app.rows[3][2], 'Video editing');
  assert.equal(app.rows[3][7], untouched[7]);
  assert.equal(app.rows[4][2], 'Revision');
  assert.equal(app.rows[4][7], last[7]);
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

test('Metrics custom ranges validate inclusive dates, navigate by their length and drill down with exact bounds', () => {
  const app = client();
  const state = app.getState();
  const messages = [];
  app.renderDashboard = () => {};
  app.showToast = message => messages.push(message);
  state.dashboard = { period: 'custom', anchor: app.parseDate('2026-11-04'), customStart: '2026-11-03', customEnd: '2026-11-06', client: 'client:Acme' };
  let range = app.dashboardRange('custom', state.dashboard.anchor);
  assert.equal(app.dateKey(range.start), '2026-11-03');
  assert.equal(app.dateKey(range.end), '2026-11-06');
  app.setDashboardCustomDate('customEnd', '2026-11-02');
  assert.equal(state.dashboard.customEnd, '2026-11-06');
  assert.match(messages[0], /through date must be on or after/);
  app.moveDashboardPeriod(1);
  assert.equal(state.dashboard.customStart, '2026-11-07');
  assert.equal(state.dashboard.customEnd, '2026-11-10');
  app.switchView = () => {};
  app.openMetricTasks('hours');
  assert.equal(state.list.metricFocus.start, '2026-11-07');
  assert.equal(state.list.metricFocus.end, '2026-11-10');
});

test('Metrics custom mode starts from the selected preset and Today resets its full range', () => {
  const app = client();
  const state = app.getState();
  app.renderDashboard = () => {};
  state.dashboard = { period: 'fortnightly', anchor: app.parseDate('2026-11-04'), customStart: '', customEnd: '', client: '' };
  app.setDashboardPeriod('custom');
  assert.equal(state.dashboard.customStart, '2026-11-02');
  assert.equal(state.dashboard.customEnd, '2026-11-15');
  state.spreadsheetToday = '2026-12-09';
  app.setDashboardToday();
  assert.equal(state.dashboard.customStart, '2026-12-09');
  assert.equal(state.dashboard.customEnd, '2026-12-09');
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

test('Metrics labels spreadsheet today separately from its selected reporting period', () => {
  const app = client();
  const state = app.getState();
  state.loaded = true;
  state.activeView = 'dashboard';
  state.spreadsheetToday = '2026-11-04';
  state.dashboard.period = 'daily';
  state.dashboard.anchor = app.parseDate('2026-10-04');
  app.renderDashboard();
  const markup = app.elements.get('dashboardContent').innerHTML;
  assert.match(markup, /Today:<\/strong>.*November 4, 2026/);
  assert.match(markup, /Selected period:<\/strong>.*October 4, 2026/);
  state.dashboard.period = 'custom';
  state.dashboard.customStart = '2026-10-28';
  state.dashboard.customEnd = '2026-11-04';
  app.renderDashboard();
  assert.match(app.elements.get('dashboardContent').innerHTML, /Selected period:<\/strong>.* · 8 days · /);
  state.dashboard.customStart = '2026-10-28';
  state.dashboard.customEnd = '2026-10-28';
  app.renderDashboard();
  assert.match(app.elements.get('dashboardContent').innerHTML, /Selected period:<\/strong>.* · 1 day · /);
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
  assert.equal(response.spreadsheetTimeZone, 'UTC');
  assert.equal(app.writes.length, 0);
});

test('active category validation and errors only list the new categories; legacy names are migration-only', () => {
  const app = server([taskRow('VID-001')]);
  for (const category of ['Graphic Design', 'Video editing', 'Scheduling']) {
    assert.doesNotThrow(() => app.context.validateCategory_(category));
    assert.equal(app.context.categoryForUpgrade_(category), category);
  }
  const message = 'Invalid task category. Allowed categories: Graphic Design, Video editing, Scheduling, Revision.';
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

test('recurring task creation generates independent monthly occurrences with anchored dates and duration', () => {
  const app = server([]);
  const result = app.context.createTask({
    taskName: 'Monthly review', category: 'Scheduling', priority: 'High',
    startDate: '2024-01-31', endDate: '2024-02-02', description: 'Review project', clients: ['Acme'],
    recurrence: { frequency: 'Monthly', throughDate: '2024-04-30' }
  });
  assert.equal(result.created, 4);
  assert.equal(result.taskIds.length, 4);
  assert.deepEqual(app.rows.slice(1).map(row => app.context.Utilities.formatDate(row[5], 'UTC', 'yyyy-MM-dd')),
    ['2024-01-31', '2024-02-29', '2024-03-31', '2024-04-30']);
  assert.deepEqual(app.rows.slice(1).map(row => app.context.Utilities.formatDate(row[6], 'UTC', 'yyyy-MM-dd')),
    ['2024-02-02', '2024-03-02', '2024-04-02', '2024-05-02']);
  assert.deepEqual(app.rows.slice(1).map(row => row[0]), Array.from(result.taskIds));
  assert.ok(app.rows.slice(1).every(row => row[1] === 'Monthly review' && row[13] === ''));
});

test('recurring task generation supports weekly and biweekly intervals', () => {
  for (const [frequency, throughDate, expected] of [
    ['Weekly', '2026-01-16', ['2026-01-01', '2026-01-08', '2026-01-15']],
    ['Biweekly', '2026-01-16', ['2026-01-01', '2026-01-15']]
  ]) {
    const app = server([]);
    app.context.createTask({
      taskName: 'Recurring review', category: 'Scheduling', priority: 'Medium',
      startDate: '2026-01-01', endDate: '2026-01-02', description: '', clients: [],
      recurrence: { frequency, throughDate }
    });
    assert.deepEqual(app.rows.slice(1).map(row => app.context.Utilities.formatDate(row[5], 'UTC', 'yyyy-MM-dd')), expected);
  }
});

test('recurring task validation rejects unsupported, inverted, nested, and oversized series before writing', () => {
  const app = server([]);
  const base = {
    taskName: 'Weekly review', category: 'Scheduling', priority: 'Medium',
    startDate: '2026-01-01', endDate: '2026-01-01', description: '', clients: []
  };
  assert.throws(() => app.context.createTask({ ...base, recurrence: { frequency: 'Daily', throughDate: '2026-01-10' } }), /weekly, biweekly, or monthly/);
  assert.throws(() => app.context.createTask({ ...base, recurrence: { frequency: 'Weekly', throughDate: '2025-12-31' } }), /must be after/);
  assert.throws(() => app.context.createTask({ ...base, recurrence: { frequency: 'Weekly', throughDate: '2026-01-01' } }), /must be after/);
  const nested = server([taskRow('VID-001')]);
  assert.throws(() => nested.context.createTask({ ...base, parentTaskId: 'VID-001', recurrence: { frequency: 'Weekly', throughDate: '2026-01-10' } }), /standalone/);
  assert.throws(() => app.context.createTask({ ...base, recurrence: { frequency: 'Weekly', throughDate: '2028-01-01' } }), /at most 100 occurrences/);
  assert.equal(app.rows.length, 1);
});

test('ordinary task creation persists standalone tasks and inherited subtask defaults', () => {
  const app = server([taskRow('VID-001')]);
  app.context.initializeTaskHeaders_(app.sheet);
  app.rows[1][14] = '["Acme"]';
  const common = {
    taskName: 'Prepare review', category: 'Scheduling', priority: 'High',
    startDate: '2026-11-09', endDate: '2026-11-10', description: 'Review work'
  };
  const standalone = app.context.createTask({ ...common, clients: ['Beta'] });
  assert.equal(standalone.success, true);
  assert.equal(standalone.created, 1);
  assert.equal(app.rows[2][0], standalone.taskId);
  assert.equal(app.rows[2][13], '');
  assert.equal(app.rows[2][14], '["Beta"]');

  const child = app.context.createTask({ ...common, taskName: 'Review pass', parentTaskId: 'VID-001', hours: 2.5 });
  assert.equal(child.success, true);
  assert.equal(app.rows[3][13], 'VID-001');
  assert.equal(app.rows[3][14], '["Acme"]');
  assert.equal(app.rows[3][15], 2.5);
});

test('recurrence controls enable only for standalone task creation', () => {
  assert.match(html, /id="repeatTask" type="checkbox" onchange="updateTaskRecurrenceControl\(\)"/);
  assert.match(html, /id="taskRecurrenceThrough" type="date" required/);
  const app = client();
  const state = app.getState();
  const control = { hidden: false };
  const checkbox = { checked: false };
  const fields = { hidden: false, disabled: false };
  const parent = { value: '' };
  const save = { textContent: '' };
  app.elements.set('taskRecurrenceControl', control);
  app.elements.set('repeatTask', checkbox);
  app.elements.set('taskRecurrenceFields', fields);
  app.elements.set('parentTaskId', parent);
  app.elements.set('saveBtn', save);

  app.updateTaskRecurrenceControl();
  assert.equal(fields.hidden, true);
  assert.equal(fields.disabled, true);
  checkbox.checked = true;
  app.updateTaskRecurrenceControl();
  assert.equal(fields.hidden, false);
  assert.equal(fields.disabled, false);
  assert.equal(save.textContent, 'Create recurring tasks');
  parent.value = 'VID-001';
  app.updateTaskRecurrenceControl();
  assert.equal(checkbox.checked, false);
  assert.equal(fields.disabled, true);
  assert.equal(save.textContent, 'Create task');
  state.editId = 'VID-002';
  checkbox.checked = true;
  app.updateTaskRecurrenceControl();
  assert.equal(control.hidden, true);
  assert.equal(checkbox.checked, false);
  assert.equal(fields.disabled, true);
});

test('new task form submits the selected recurrence frequency and through date', () => {
  const app = client();
  const state = app.getState();
  let submitted;
  const runner = {
    withRejectionHandler() { return runner; },
    withSuccessHandler() { return runner; },
    withFailureHandler() { return runner; },
    createTask(data) { submitted = data; }
  };
  app.mutationRunner = () => runner;
  const fields = {
    taskName: { value: 'Weekly review' }, category: { value: 'Scheduling' }, priority: { value: 'Medium' },
    startDate: { value: '2026-01-05' }, endDate: { value: '2026-01-06' }, description: { value: 'Review progress' },
    parentTaskId: { value: '' }, taskHours: { value: '0', readOnly: true }, repeatTask: { checked: true },
    taskRecurrenceThrough: { value: '2026-02-02' }, taskRecurrenceFrequency: { value: 'Weekly' },
    saveBtn: { disabled: false, textContent: '' }, formError: { style: {}, textContent: '' }
  };
  Object.entries(fields).forEach(([id, element]) => app.elements.set(id, element));
  app.saveTask({ preventDefault() {} });
  assert.equal(submitted.taskName, 'Weekly review');
  assert.deepEqual({ ...submitted.recurrence }, { frequency: 'Weekly', throughDate: '2026-02-02' });
  assert.equal(state.writing, false);
});

test('ordinary task form submits through createTask without recurrence', () => {
  const app = client();
  const state = app.getState();
  let submitted;
  let prevented = false;
  const runner = {
    withRejectionHandler() { return runner; },
    withSuccessHandler() { return runner; },
    withFailureHandler() { return runner; },
    createTask(data) { submitted = data; }
  };
  app.mutationRunner = () => runner;
  state.loaded = true;
  state.clientSelections.taskClients = ['Acme'];
  const fields = {
    taskName: { value: 'Design review' }, category: { value: 'Graphic Design' }, priority: { value: 'High' },
    startDate: { value: '2026-11-09' }, endDate: { value: '2026-11-10' }, description: { value: 'Review draft' },
    parentTaskId: { value: '' }, taskHours: { value: '0', readOnly: true }, repeatTask: { checked: false },
    saveBtn: { disabled: false, textContent: 'Create task' }, formError: { style: { display: 'none' }, textContent: '' }
  };
  Object.entries(fields).forEach(([id, element]) => app.elements.set(id, element));

  app.saveTask({ preventDefault() { prevented = true; } });

  assert.equal(prevented, true);
  assert.equal(submitted.taskName, 'Design review');
  assert.equal(submitted.startDate, '2026-11-09');
  assert.equal(submitted.endDate, '2026-11-10');
  assert.equal(submitted.parentTaskId, '');
  assert.deepEqual(Array.from(submitted.clients), ['Acme']);
  assert.equal(submitted.recurrence, undefined);
  assert.equal(fields.saveBtn.disabled, true);
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
  const payload = { taskName: 'Campaign', category: 'Scheduling', priority: 'Medium', startDate: '2026-11-01', endDate: '2026-11-15', description: '', parentTaskId: '', clients: [] };
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
  const properties = new Map();
  let releases = 0;
  let fetchCount = 0;
  let failFxFetch = false;
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
          }); return this; },
          setNumberFormat() { return this; }
        };
      },
      deleteRows(row, count) { rows.splice(row - 1, count); },
      setFrozenRows() {}
    };
  }
  const spreadsheet = {
    getSheetByName: name => sheets.get(name) || null,
    insertSheet(name) { const sheet = makeSheet(); sheets.set(name, sheet); return sheet; },
    getSpreadsheetTimeZone: () => 'UTC'
  };
  const context = vm.createContext({ Date,
    SpreadsheetApp: { getActiveSpreadsheet: () => spreadsheet },
    Utilities: {
      formatDate: date => date.toISOString().slice(0, 10),
      parseDate: value => new Date(value + 'T00:00:00.000Z'),
      getUuid: () => 'new-expense-001'
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: key => properties.get(key) || null, setProperty: (key, value) => properties.set(key, value) }) },
    UrlFetchApp: { fetch(url) {
      fetchCount++;
      if (failFxFetch) throw new Error('Offline');
      const request = new URL(url);
      const base = request.searchParams.get('base');
      const quotes = request.searchParams.get('quotes').split(',');
      const usdRates = { EUR: 0.9, GBP: 0.8, CAD: 1.4, AUD: 1.5, JPY: 158.31, KRW: 1341.25, PHP: 63.295 };
      const rows = quotes.map(quote => ({ date: '2026-11-05', base, quote, rate: base === 'USD' ? usdRates[quote] : 1 / usdRates[base] }));
      return { getResponseCode: () => 200, getContentText: () => JSON.stringify(rows) };
    } },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() { releases++; } }) }
  });
  vm.runInContext(backend, context);
  return { context, sheets, properties, releases: () => releases, fetchCount: () => fetchCount, failFxFetch: value => { failFxFetch = value; } };
}

function expenseDraft(overrides = {}) {
  return {
    date: '2026-11-05', merchant: 'Metro Market', category: 'Meals', description: 'Lunch', amount: 12.34,
    currency: 'USD', paymentMethod: 'Card', status: 'Pending', notes: '', receiptUrl: '', revision: 0, ...overrides
  };
}

test('expense workspace reads without creating sheets and saves isolated, revisioned minor-unit records', () => {
  const app = invoiceServer();
  const empty = app.context.getExpenses();
  assert.deepEqual(Array.from(empty.expenses), []);
  assert.equal(app.sheets.size, 0);
  const first = app.context.saveExpense(expenseDraft()).expense;
  assert.equal(first.id, 'EXP-new-expense-001');
  assert.equal(first.amountMinor, 1234);
  assert.equal(first.revision, 1);
  assert.deepEqual([...app.sheets.keys()], ['Expense_Master']);
  assert.equal(app.sheets.get('Expense_Master').rows.length, 2);
  assert.ok(app.sheets.get('Expense_Master').rows[1][1] instanceof Date);
  assert.equal(app.context.getExpenses().expenses[0].date, '2026-11-05');
  assert.throws(() => app.context.saveExpense(expenseDraft({ id: first.id, revision: 0 })), /another session/);
  const updated = app.context.saveExpense({ ...first, amount: 14.25, revision: 1 }).expense;
  assert.equal(updated.amountMinor, 1425);
  assert.equal(updated.revision, 2);
  assert.equal(app.context.getExpenses().expenses[0].amountMinor, 1425);
  assert.throws(() => app.context.deleteExpense(first.id, 1), /changed in another session/);
  assert.equal(app.context.deleteExpense(first.id, 2).success, true);
  assert.equal(app.context.getExpenses().expenses.length, 0);
  assert.equal(app.sheets.has('Task_Master'), false);
  assert.equal(app.sheets.has('Invoice_Master'), false);
  app.context.expenseSheet_(true);
  app.sheets.get('Expense_Master').rows.length = 0;
  const initialized = app.context.saveExpense(expenseDraft()).expense;
  assert.ok(initialized.id);
  assert.equal(app.sheets.get('Expense_Master').rows[0][0], 'Expense ID');
});

test('expense validation and header conflicts fail before changing stored records', () => {
  const app = invoiceServer();
  for (const overrides of [
    { date: '2026-02-30' }, { merchant: '' }, { category: 'Unlisted' }, { amount: 0 },
    { amount: 1.001 }, { currency: 'XXX' }, { paymentMethod: 'Cheque' }, { status: 'Reimbursed' },
    { receiptUrl: 'javascript:alert(1)' }
  ]) assert.throws(() => app.context.normalizeExpense_(expenseDraft(overrides)));
  const saved = app.context.saveExpense(expenseDraft()).expense;
  const sheet = app.sheets.get('Expense_Master');
  sheet.rows[0][0] = 'Unrelated header';
  assert.throws(() => app.context.saveExpense({ ...saved, amount: 13, revision: 1 }), /headers do not match/);
  assert.equal(sheet.rows.length, 2);
});

test('JPY and KRW use whole-unit storage while EUR retains two-decimal precision', () => {
  const app = invoiceServer();
  const yenInvoice = app.context.normalizeInvoice_(invoiceDraft({
    id: 'INV-yen-invoice-001', currency: 'JPY',
    lines: [{ taskId: 'VID-001', description: 'Video', hours: 2, rate: 125 }]
  }));
  assert.equal(yenInvoice.lines[0].rate, 125);
  assert.equal(yenInvoice.totalMinor, 250);
  assert.throws(() => app.context.normalizeInvoice_(invoiceDraft({ currency: 'JPY', lines: [{ description: 'Video', hours: 1, rate: 125.5 }] })), /whole number/);
  const euroInvoice = app.context.normalizeInvoice_(invoiceDraft({ currency: 'EUR', lines: [{ description: 'Video', hours: 1, rate: 12.34 }] }));
  assert.equal(euroInvoice.lines[0].rate, 12.34);
  const yenExpense = app.context.normalizeExpense_(expenseDraft({ currency: 'JPY', amount: 1250 }));
  assert.equal(yenExpense.amountMinor, 1250);
  assert.throws(() => app.context.normalizeExpense_(expenseDraft({ currency: 'KRW', amount: 1250.5 })), /whole number/);
  assert.equal(app.context.normalizeExpense_(expenseDraft({ currency: 'KRW', amount: 8000 })).amountMinor, 8000);
});

test('earnings and recurring rules use separate lazy sheets and revision-protected records', () => {
  const app = invoiceServer();
  assert.deepEqual(Array.from(app.context.getEarnings().earnings), []);
  assert.deepEqual(Array.from(app.context.getRecurringRules().rules), []);
  assert.equal(app.sheets.size, 0);
  const earning = app.context.saveEarning({ date: '2026-11-05', payer: 'Studio', category: 'Freelance', description: 'November editing', amount: 850, currency: 'EUR', status: 'Pending', notes: '', revision: 0 }).earning;
  assert.equal(earning.amountMinor, 85000);
  assert.equal(app.sheets.has('Earning_Master'), true);
  assert.equal(app.sheets.has('Task_Master'), false);
  assert.throws(() => app.context.saveEarning({ ...earning, amount: 900, revision: 0 }), /another session/);
  assert.equal(app.context.deleteEarning(earning.id, earning.revision).success, true);
  const rule = app.context.saveRecurringRule({ type: 'Expense', name: 'Rent', category: 'Utilities', description: '', amount: 1200, currency: 'JPY', frequency: 'Monthly', startDate: '2026-11-01', endDate: '', status: 'Active', notes: '', revision: 0 }).rule;
  assert.equal(rule.amountMinor, 1200);
  assert.equal(app.context.getRecurringRules('Expense').rules[0].frequency, 'Monthly');
  assert.equal(app.context.getRecurringRules('Earning').rules.length, 0);
  assert.throws(() => app.context.saveRecurringRule({ ...rule, amount: 1300, revision: 0 }), /another session/);
  assert.equal(app.context.deleteRecurringRule(rule.id, rule.revision).success, true);
});

test('daily FX rates normalize provider quotes, cache once per day, and fall back stale when offline', () => {
  const app = invoiceServer();
  const rates = app.context.getFinanceExchangeRates('USD');
  assert.equal(rates.rates.USD, 1);
  assert.equal(rates.rates.JPY, 158.31);
  assert.equal(rates.rates.KRW, 1341.25);
  assert.equal(rates.rateDate, '2026-11-05');
  assert.equal(rates.cached, false);
  assert.equal(app.context.getFinanceExchangeRates('USD').cached, true);
  assert.equal(app.fetchCount(), 1);
  assert.throws(() => app.context.getFinanceExchangeRates('XYZ'), /supported reporting currency/);
  const saved = JSON.parse(app.properties.get('FINANCE_FX_DAILY_USD'));
  saved.requestedOn = '2099-01-01';
  app.properties.set('FINANCE_FX_DAILY_USD', JSON.stringify(saved));
  app.failFxFetch(true);
  const stale = app.context.getFinanceExchangeRates('USD');
  assert.equal(stale.stale, true);
  assert.match(stale.error, /last saved daily rates/);
  assert.equal(app.sheets.size, 0);
});

test('Refresh Finance reads each finance ledger and FX once, then clears its combined busy state', () => {
  const app = loadingClient();
  const state = app.getState();
  app.renderExpenseWorkspace = () => {};
  app.renderEarnings = () => {};
  app.renderRecurringWorkspace = () => {};
  app.renderExpenseNotice = () => {};
  app.renderEarningNotice = () => {};
  app.renderRecurringNotice = () => {};
  app.updateDataNotice = () => {};
  app.updateFinanceRefreshButton = () => {};
  app.refreshFinanceData();
  assert.deepEqual(app.calls.map(call => call.method), ['getExpenses', 'getEarnings', 'getRecurringRules', 'getFinanceExchangeRates']);
  assert.equal(state.financeRefreshing, true);
  for (const call of app.calls) {
    if (call.method === 'getExpenses') call.success({ success: true, expenses: [], today: '2026-11-05', categories: [], currencies: [], paymentMethods: [], statuses: [] });
    if (call.method === 'getEarnings') call.success({ success: true, earnings: [], today: '2026-11-05', categories: [], currencies: [], statuses: [] });
    if (call.method === 'getRecurringRules') call.success({ success: true, rules: [] });
    if (call.method === 'getFinanceExchangeRates') call.success({ success: true, base: 'USD', rates: { USD: 1, EUR: 0.9 }, rateDate: '2026-11-05', requestedOn: '2026-11-05' });
  }
  assert.equal(state.financeRefreshing, false);
  assert.equal(state.financeRefreshPending.size, 0);
  assert.equal(app.calls.length, 4);
});

test('recurring monthly and weekly forecasts respect currency, type, status and end dates', () => {
  const app = client();
  const rules = [
    { type: 'Expense', currency: 'USD', status: 'Active', frequency: 'Monthly', startDate: '2026-01-31', endDate: '', amountMinor: 1000 },
    { type: 'Expense', currency: 'USD', status: 'Active', frequency: 'Weekly', startDate: '2026-11-02', endDate: '2026-11-23', amountMinor: 200 },
    { type: 'Expense', currency: 'USD', status: 'Paused', frequency: 'Monthly', startDate: '2026-01-01', endDate: '', amountMinor: 9000 },
    { type: 'Earning', currency: 'USD', status: 'Active', frequency: 'Monthly', startDate: '2026-01-01', endDate: '', amountMinor: 5000 },
    { type: 'Expense', currency: 'JPY', status: 'Active', frequency: 'Monthly', startDate: '2026-01-01', endDate: '', amountMinor: 800 }
  ];
  assert.equal(app.recurringMonthTotal(rules, 'Expense', 'USD', '2026-11'), 1800);
  assert.equal(app.recurringMonthTotal(rules, 'Earning', 'USD', '2026-11'), 5000);
  assert.equal(app.recurringMonthTotal(rules, 'Expense', 'JPY', '2026-11'), 800);
  assert.equal(app.recurringMonthTotal(rules, 'Expense', 'USD', '2025-12'), 0);
});

test('expense totals group by currency and selected month without combining unlike amounts', () => {
  const app = client();
  const records = [
    { date: '2026-11-02', currency: 'USD', amountMinor: 1250 },
    { date: '2026-11-08', currency: 'USD', amountMinor: 275 },
    { date: '2026-11-03', currency: 'PHP', amountMinor: 50000 },
    { date: '2026-10-31', currency: 'USD', amountMinor: 900 }
  ];
  assert.equal(app.expenseMonthTotal(records, 'USD', '2026-11'), 1525);
  assert.equal(app.expenseMonthTotal(records, 'PHP', '2026-11'), 50000);
  assert.equal(app.expenseMonthTotal(records, 'CAD', '2026-11'), 0);
});

test('expense line and donut charts label months, currency units and payment values', () => {
  const app = client();
  const line = app.expenseTrendChart([
    { key: '2026-09', expenses: 1250, earnings: 2000 },
    { key: '2026-10', expenses: 0, earnings: 3000 },
    { key: '2026-11', expenses: 275, earnings: 4500 }
  ], 'USD');
  assert.match(line, /<svg viewBox="0 0 390 190" role="img"/);
  assert.match(line, /USD monthly expenses and earnings/);
  assert.match(line, /Sep/);
  assert.match(line, /\$12\.50/);
  assert.match(line, /income-series/);
  assert.match(line, /Out \$2\.75/);
  assert.match(line, /In \$45\.00/);
  const donut = app.expenseStatusDonut(600, 400, 'USD');
  assert.match(donut, /role="img" aria-label="USD: \$6\.00 paid, \$4\.00 pending"/);
  assert.match(donut, /conic-gradient\(var\(--green\) 0 60%/);
  assert.match(donut, /60% paid/);
  const empty = app.expenseStatusDonut(0, 0, 'USD');
  assert.match(empty, /0% paid/);
  assert.match(empty, /#e9edf3/);
});

test('invoice and expense frontend formatting respects zero-decimal currencies', () => {
  const app = client();
  assert.equal(app.invoiceAmount(2, 125, 'JPY'), 250);
  assert.equal(app.invoiceAmount(2, 125.5, 'JPY'), null);
  assert.equal(app.invoiceAmount(1, 12.34, 'EUR'), 1234);
  assert.equal(app.currencyScale('KRW'), 1);
  assert.equal(app.currencyScale('USD'), 100);
  assert.equal(app.expenseMoney(1250, 'JPY'), new Intl.NumberFormat('en-US', { style: 'currency', currency: 'JPY' }).format(1250));
  assert.equal(app.convertMinorToCurrency(15831, 'JPY', 'USD', { USD: 1, JPY: 158.31 }), 10000);
  assert.equal(app.convertMinorToCurrency(10000, 'EUR', 'USD', { USD: 1, EUR: 0.9 }), 11111);
  assert.equal(app.convertMinorToCurrency(10000, 'XYZ', 'USD', { USD: 1 }), null);
  const field = { value: '4000', setCustomValidity(message) { this.error = message; }, setAttribute(name) { this[name] = true; }, removeAttribute(name) { delete this[name]; } };
  assert.equal(app.normalizeMoneyInput(field, 'USD'), true);
  assert.equal(field.value, '4,000.00');
  assert.equal(app.parseMoneyInputValue(field.value), '4000.00');
  assert.equal(app.validateMoneyInput(field, 'USD'), true);
  field.value = '4,00.00';
  assert.equal(app.validateMoneyInput(field, 'USD'), false);
  field.value = '40abc';
  assert.equal(app.validateMoneyInput(field, 'USD'), false);
  assert.match(field.error, /number/);
  field.value = '4000.5';
  assert.equal(app.normalizeMoneyInput(field, 'JPY'), false);
  field.value = '4000';
  assert.equal(app.normalizeMoneyInput(field, 'JPY'), true);
  assert.equal(field.value, '4,000');
  for (const id of ['expenseAmount', 'earningAmount', 'recurringAmount']) {
    assert.match(html, new RegExp(`id="${id}" type="text" inputmode="decimal"`));
    assert.match(html, new RegExp(`id="${id}"[^>]*validateMoneyInput`));
    assert.match(html, new RegExp(`id="${id}"[^>]*normalizeMoneyInput`));
  }
  assert.match(html, /id="invoiceLine-\$\{index\}-rate"[^>]*normalizeMoneyInput/);
  assert.match(html, /id="invoiceField-\$\{key\}"[^>]*normalizeMoneyInput/);
  assert.match(html, /id="billing\$\{key\}"[^>]*normalizeMoneyInput/);
});

test('Multi Purpose Planner nests expense records and dashboard with an expense-specific top action', () => {
  assert.match(html, /<title>Multi Purpose Planner<\/title>/);
  assert.match(html, /id="expenseNav"[^>]*aria-controls="expenseWorkspaceNav"/);
  const financeNavStart = html.indexOf('<nav class="workspace-nav" id="expenseWorkspaceNav" aria-label="Finance workspaces">');
  const financeNavEnd = html.indexOf('</nav>', financeNavStart);
  const financeNav = html.slice(financeNavStart, financeNavEnd);
  for (const view of ['expenses', 'expenseDashboard', 'earnings', 'recurring']) assert.ok(financeNav.includes(`data-view="${view}"`));
  assert.match(html, /<span class="nav-text">Finance<\/span>/);
  assert.match(html, /id="view-expenses"/);
  assert.match(html, /id="view-expenseDashboard"/);
  assert.match(html, /id="expenseForm" onsubmit="saveExpenseForm\(event\)"/);
  assert.match(html, /id="financeTopActions" hidden/);
  assert.match(html, /id="financeRefreshBtn" onclick="refreshFinanceData\(\)"/);
  assert.match(html, /id="addExpenseAction" onclick="focusExpenseForm\(\)" hidden/);
  assert.match(html, /id="addEarningAction" onclick="focusEarningForm\(\)" hidden/);
  assert.match(html, /id="addRecurringAction" onclick="focusRecurringForm\(\)" hidden/);
  assert.match(html, /function refreshFinanceData\(\)[\s\S]*loadExpenseWorkspace\(true\)[\s\S]*loadEarningWorkspace\(true\)[\s\S]*loadRecurringWorkspace\(true\)/);
  assert.match(html, /class="expense-status-chart" role="img"/);
  for (const view of ['timeline', 'tasks', 'dashboard', 'invoices']) assert.match(html, new RegExp(`data-view="${view}"`));
});

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

test('invoice client accepts typed names, canonicalizes suggestions and keeps new lines manual', () => {
  const app = client();
  const state = app.getState();
  state.clientOptions = ['Acme'];
  state.invoices.records = [];
  state.invoices.settings = { defaultRate: 25 };
  state.invoices.editor = invoiceDraft({ client: 'Acme', lines: [], defaultRate: 30 });
  app.renderInvoices = () => {};
  state.tasks = [listTask('VID-1', '', { category: 'Video editing', clients: ['Acme'], start: app.parseDate('2026-11-03'), end: app.parseDate('2026-11-16'), duration: 14 })];
  app.setInvoiceClient(' acme ');
  assert.equal(state.invoices.editor.client, 'Acme');
  app.setInvoiceClient('Unlisted client');
  assert.equal(state.invoices.editor.client, 'Unlisted client');
  app.addInvoiceLine();
  assert.equal(state.invoices.editor.lines.length, 1);
  assert.equal(state.invoices.editor.lines[0].taskId, '');
  assert.equal(state.invoices.editor.lines[0].description, '');
  assert.equal(state.invoices.editor.lines[0].hours, '');
  assert.equal(state.invoices.editor.lines[0].rate, 25);
  state.invoices.editor.lines[0].hours = 3.5;
  app.addInvoiceLine();
  assert.equal(state.invoices.editor.lines.length, 2);
  assert.equal(state.invoices.editor.lines[1].taskId, '');
  assert.equal(state.invoices.editor.lines[1].description, '');
  assert.equal(app.invoiceTotals(state.invoices.editor).minor, 8750);
  assert.match(html, /label class="form-field">Client<input class="field-control" id="invoiceField-client" list="invoiceClientSuggestions" maxlength="100" required/);
  assert.match(html, /key === 'clientDetails' \? 'id="invoiceField-clientDetails"'/);
  assert.match(html, /<datalist id="invoiceClientSuggestions">/);
  assert.doesNotMatch(html, /invoiceVideoPicker|addMatchingVideosBtn|invoiceVideoDateBasis|invoiceVideoScope|Add matching videos/);
  assert.match(html, /id="addManualInvoiceLine" onclick="addInvoiceLine\(\)"/);
  assert.match(html, /Your name \/ business/);
});

test('invoice client edits preserve lines when cleared or canceled and update a confirmed switch in place', () => {
  const app = client();
  const state = app.getState();
  state.clientOptions = ['Acme', 'Beta'];
  state.invoices.records = [];
  state.invoices.settings = { defaultRate: 25 };
  state.invoices.editor = invoiceDraft({ client: 'Acme', clientDetails: 'Existing billing contact' });
  let clientInput;
  app.renderInvoices = () => {
    state.invoiceRenderCount = (state.invoiceRenderCount || 0) + 1;
    if (clientInput) clientInput.value = state.invoices.editor.client;
  };
  app.updateInvoicePreview = () => {};
  app.updateInvoiceReadiness = () => {};
  app.showToast = () => {};
  clientInput = { value: 'Acme' };
  const rateInput = { value: '' };
  const detailsInput = { value: 'Existing billing contact' };
  const currencyInput = { disabled: true };
  const editorStatus = { textContent: 'Draft' };
  const lineCount = { textContent: '1 invoice lines' };
  const linesBody = { innerHTML: '<tr></tr>' };
  app.elements.set('invoiceField-client', clientInput);
  app.elements.set('invoiceField-defaultRate', rateInput);
  app.elements.set('invoiceField-clientDetails', detailsInput);
  app.elements.set('invoiceField-currency', currencyInput);
  app.elements.set('invoiceEditorStatus', editorStatus);
  app.elements.set('invoiceLineCount', lineCount);
  app.elements.set('invoiceLinesBody', linesBody);

  clientInput.value = '';
  app.setInvoiceClient('');
  assert.equal(state.invoices.editor.client, 'Acme');
  assert.equal(state.invoices.editor.lines.length, 1);
  assert.equal(clientInput.value, 'Acme');

  app.confirm = () => false;
  clientInput.value = 'Beta';
  app.setInvoiceClient('Beta');
  assert.equal(state.invoices.editor.client, 'Acme');
  assert.equal(state.invoices.editor.lines.length, 1);
  assert.equal(clientInput.value, 'Acme');

  app.confirm = () => true;
  currencyInput.disabled = true;
  clientInput.value = 'Beta';
  app.setInvoiceClient('Beta');
  assert.equal(state.invoices.editor.client, 'Beta');
  assert.equal(state.invoices.editor.lines.length, 0);
  assert.equal(clientInput.value, 'Beta');
  assert.equal(rateInput.value, '25.00');
  assert.equal(detailsInput.value, '');
  assert.equal(currencyInput.disabled, false);
  assert.equal(editorStatus.textContent, 'Draft · Unsaved changes');
  assert.equal(lineCount.textContent, '0 invoice lines');
  assert.match(linesBody.innerHTML, /No invoice lines/);
  assert.equal(state.invoiceRenderCount || 0, 1);
});

test('invoice draft preview shows only the total label and amount', () => {
  const app = client();
  app.getState().invoices.editor = invoiceDraft({ lines: [{ taskId: '', description: 'Manual work', hours: 2, rate: 30 }] });
  app.updateInvoiceReadiness = () => {};
  app.updateInvoicePreview();
  const preview = app.elements.get('invoicePrintable').innerHTML;
  assert.match(preview, /<span>Total<\/span>/);
  assert.doesNotMatch(preview, /videos? · .* hours · Total/);
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
  assert.equal(tasks[0].hours, 0);
  assert.equal(tasks[0].subtaskHours, 5.75);
  assert.equal(tasks[0].totalHours, 5.75);
  assert.equal(tasks[1].totalHours, 2.25);
  assert.equal(app.rows[1][15], 9);
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
  app.context.updateTaskHours('VID-002', 2.25, 0);
  assert.deepEqual(app.writes.map(write => write.column), [16, 13]);
  assert.equal(app.context.getTasks().tasks[0].totalHours, 2.25);
  app.writes.length = 0;
  app.context.updateSubtasks('VID-001', ['VID-002', 'VID-003'], { hours: 3.5 });
  assert.equal(app.writes.length, 1);
  assert.equal(app.writes[0].column, 1);
  assert.equal(app.writes[0].width, 16);
  assert.equal(app.writes[0].values[0][7], first[7]);
  assert.equal(app.context.getTasks().tasks[0].totalHours, 7);
  assert.equal(app.rows[2][5], first[5]);
  assert.equal(app.rows[2][6], first[6]);
  assert.equal(app.rows[2][7], '=G2-F2+1');
  const count = app.writes.length;
  assert.throws(() => app.context.updateTaskHours('VID-001', 10, 0), /calculated from subtasks/);
  assert.equal(app.writes.length, count);
  const childVersion = app.context.getTasks().tasks[1].updatedAt;
  app.context.updateTaskHours('VID-002', 0, childVersion);
  assert.equal(app.rows[2][15], 0);
  assert.throws(() => app.context.updateTaskHours('VID-002', 4, childVersion), /changed since it was loaded/);
  assert.equal(app.rows[2][15], 0);
});

test('only subtasks can log hours; parent legacy values stay stored but are ignored', () => {
  const parent = taskRow('VID-001'); parent[5] = new Date(2026, 10, 1); parent[6] = new Date(2026, 10, 10); parent[15] = 9;
  const child = taskRow('VID-002', 'VID-001'); child[5] = new Date(2026, 10, 1); child[6] = new Date(2026, 10, 10);
  const standalone = taskRow('VID-003');
  const app = server([parent, child, standalone]);
  app.context.initializeTaskHeaders_(app.sheet);
  assert.equal(app.context.getTasks().tasks[0].hours, 0);
  assert.equal(app.context.getTasks().tasks[0].totalHours, 0);
  assert.throws(() => app.context.updateTaskHours('VID-001', 4, app.context.getTasks().tasks[0].updatedAt), /Parent hours are calculated from subtasks/);
  const standaloneVersion = app.context.getTasks().tasks[2].updatedAt;
  assert.throws(() => app.context.updateTaskHours('VID-003', 4, standaloneVersion), /Only subtasks can have expected hours/);
  assert.throws(() => app.context.updateTask({ taskId: 'VID-003', taskName: 'Standalone', category: 'Video editing', priority: 'High', startDate: '2026-11-02', endDate: '2026-11-03', hours: 4, expectedUpdatedAt: standaloneVersion }), /Only subtasks can have expected hours/);
  assert.throws(() => app.context.createTask({ taskName: 'Standalone', category: 'Video editing', priority: 'High', startDate: '2026-11-02', endDate: '2026-11-03', hours: 4 }), /Only subtasks can have expected hours/);
  const childVersion = app.context.getTasks().tasks[1].updatedAt;
  app.context.updateTaskHours('VID-002', 4, childVersion);
  app.context.updateTask({ taskId: 'VID-002', taskName: 'Moved child', category: 'Video editing', priority: 'High', startDate: '2026-11-02', endDate: '2026-11-11', expectedUpdatedAt: app.context.getTasks().tasks[1].updatedAt });
  assert.equal(app.context.getTasks().tasks[1].hours, 4);
  assert.equal(app.context.getTasks().tasks[0].totalHours, 4);
  assert.equal(app.rows[1][15], 9);
  app.context.createSubtasks('VID-001', ['Step'], 2);
  assert.equal(app.rows[4][15], 0);
  assert.equal(app.rows[5][15], 0);
  assert.equal(app.context.getTasks().tasks[0].totalHours, 4);
});

test('hour metrics compare logged actuals with estimates without treating Done as time spent', () => {
  const app = client();
  const tasks = [listTask('VID-1', '', { hours: 0 }), listTask('VID-2', 'VID-1', { hours: 3, timeEntryHours: 1, hasTimeEntries: true, status: 'Done' }), listTask('VID-3', 'VID-1', { hours: 2, timeEntryHours: 0.5, hasTimeEntries: true }), listTask('VID-4', 'VID-5', { hours: 1.5, status: 'Done' }), listTask('VID-5', '', { hours: 0 })];
  app.applyTaskHourRollups(tasks);
  assert.equal(tasks[0].totalHours, 5);
  assert.equal(tasks[0].completedHours, 1.5);
  const summary = app.taskHourMetrics(tasks, tasks);
  assert.equal(summary.total, 6.5);
  assert.equal(summary.completed, 1.5);
  assert.equal(app.taskHourMetrics([tasks[0]], tasks).total, 0);
  assert.equal(app.taskHourMetrics([tasks[0], tasks[1]], tasks).total, 3);
  assert.match(app.renderHoursProgress(3, 5), /value="60"/);
  assert.match(app.renderHoursProgress(0, 0), /value="0"/);
  assert.match(app.renderHoursProgress(3, 5), /3 hours logged \/ 5 hours expected/);
  assert.equal(tasks[3].completedHours, 0);
});

test('only subtasks expose editable hours and root legacy values are excluded from metrics', () => {
  const app = client();
  const state = app.getState();
  const parent = listTask('VID-PARENT', '', { hours: 90 });
  const child = listTask('VID-CHILD', 'VID-PARENT', { hours: 2 });
  const standalone = listTask('VID-STANDALONE', '', { hours: 40 });
  const tasks = [parent, child, standalone];
  app.applyTaskHourRollups(tasks);
  assert.equal(parent.hours, 0);
  assert.equal(parent.totalHours, 2);
  assert.equal(standalone.totalHours, 0);
  assert.equal(app.taskHourMetrics(tasks, tasks).total, 2);

  const hoursInput = { value: '', readOnly: false, removeAttribute() {} };
  app.elements.set('taskHours', hoursInput);
  app.elements.set('taskHoursLabel', { textContent: '' });
  app.elements.set('taskHoursProgress', { innerHTML: '' });
  app.updateTaskHoursControl(parent, true);
  assert.equal(hoursInput.readOnly, true);
  assert.equal(hoursInput.value, '2');
  assert.equal(app.elements.get('taskHoursLabel').textContent, 'Total expected hours (calculated)');
  app.updateTaskHoursControl(child, true);
  assert.equal(hoursInput.readOnly, false);
  assert.equal(hoursInput.value, '2');

  state.taskById = new Map(tasks.map(task => [task.id, task]));
  state.childrenByParent = new Map([['VID-PARENT', [child]]]);
  const attention = app.renderMetricsAttention({ attention: [
    { task: parent, reason: 'Overdue now' }, { task: child, reason: 'Overdue now' }, { task: standalone, reason: 'Overdue now' }
  ] });
  assert.match(attention, /Add subtasks/);
  assert.match(attention, /Edit subtasks/);
  assert.match(attention, /metricHours-VID-CHILD/);
  assert.doesNotMatch(attention, /metricHours-VID-PARENT|metricHours-VID-STANDALONE/);
});

test('new task hours become editable only after selecting a parent task', () => {
  const app = client();
  const input = { value: '5', readOnly: false, max: '10000' };
  app.elements.set('taskHours', input);
  app.elements.set('parentTaskId', { value: '' });
  app.elements.set('taskHoursLabel', { textContent: '' });
  app.elements.set('taskHoursProgress', { innerHTML: '' });
  app.updateCreateTaskHoursControl(true);
  assert.equal(input.readOnly, true);
  assert.equal(input.value, '0');
  app.elements.get('parentTaskId').value = 'VID-PARENT';
  app.updateCreateTaskHoursControl();
  assert.equal(input.readOnly, false);
  assert.equal(input.value, '0');
  app.elements.get('parentTaskId').value = '';
  app.updateCreateTaskHoursControl();
  assert.equal(input.readOnly, true);
  assert.equal(input.value, '0');
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
  assert.deepEqual(Array.from(app.calls[0].args), ['VID-2', '3.5', child.updatedAt]);
});

test('logged hours stay independent from status through transfer and deletion without changing expected dates', () => {
  const first = taskRow('VID-002', 'VID-001', 'Done'); first[15] = 2.25; first[5] = new Date(2026, 10, 3); first[6] = new Date(2026, 10, 7);
  const second = taskRow('VID-003', 'VID-001', 'To Do'); second[15] = 3.5;
  const app = server([taskRow('VID-001'), first, second, taskRow('VID-004')]);
  app.context.initializeTaskHeaders_(app.sheet);
  app.context.saveTaskTimeEntry('VID-002', '2026-11-05', 2.25, 'Review');
  assert.equal(app.context.getTasks().tasks[0].completedHours, 2.25);
  app.context.updateTaskStatus('VID-003', 'Done');
  assert.equal(app.context.getTasks().tasks[0].completedHours, 2.25);
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
  assert.equal(app.context.getTasks().tasks.find(task => task.taskId === 'VID-004').completedHours, 0);
});

test('Revision is accepted independently of legacy category conversion', () => {
  const app = server([]);
  assert.doesNotThrow(() => app.context.validateCategory_('Revision'));
  assert.equal(app.context.categoryForUpgrade_('Revision'), 'Revision');
  assert.equal(app.context.categoryForUpgrade_('Review'), 'Video editing');
});

test('invoice numbers and names are customizable on drafts and numbers remain unique', () => {
  const app = invoiceServer();
  const first = app.context.saveInvoice(invoiceDraft({ number: 'ACME/2026-01', name: 'November video editing' })).invoice;
  assert.equal(first.number, 'ACME/2026-01');
  assert.equal(first.name, 'November video editing');
  const renamed = app.context.saveInvoice({ ...first, number: 'ACME-2026-02', name: 'Updated editing invoice' }).invoice;
  assert.equal(app.context.getInvoice(renamed.id).invoice.name, 'Updated editing invoice');
  assert.throws(() => app.context.saveInvoice(invoiceDraft({ id: 'INV-another-custom', number: 'acme-2026-02' })), /already exists/);
  assert.throws(() => app.context.saveInvoice(invoiceDraft({ number: '=HYPERLINK("bad")' })), /must start/);
  const issued = app.context.saveInvoice({ ...renamed, status: 'Issued' }).invoice;
  assert.throws(() => app.context.saveInvoice({ ...issued, name: 'Changed' }), /cannot be edited/);
});

test('weekly, fortnightly and monthly task periods use inclusive shared calendar ranges', () => {
  const app = client();
  const state = app.getState();
  state.spreadsheetToday = '2026-11-04';
  for (const [period, start, end] of [['weekly', '2026-11-02', '2026-11-08'], ['fortnightly', '2026-11-02', '2026-11-15'], ['monthly', '2026-11-01', '2026-11-30']]) {
    app.setTaskPeriod(period);
    assert.equal(state.list.filters.from, start);
    assert.equal(state.list.filters.to, end);
    const range = app.dashboardRange(period, app.parseDate('2026-11-04'));
    assert.equal(app.dateKey(range.start), start);
    assert.equal(app.dateKey(range.end), end);
  }
  app.setTaskPeriod('fortnightly');
  app.moveTaskPeriod(1);
  assert.equal(state.list.filters.from, '2026-11-16');
  state.zoom = 'fortnight'; state.anchor = app.parseDate('2026-11-04');
  const visible = app.visibleRange([]);
  assert.equal(app.dayDiff(visible.start, visible.end), 13);
  app.resetTaskFilters();
  assert.equal(state.list.period, 'all');
  assert.equal(state.list.filters.from, '');
});

test('generated PDF uses only invoice data, custom identity, full dates and page numbering without a script URL', () => {
  const app = client();
  const text = [];
  let pages = 1;
  class Pdf {
    constructor() { this.internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } }; }
    setProperties(value) { this.properties = value; }
    setFont() {} setFontSize() {} setDrawColor() {} line() {} setPage() {}
    text(value) { text.push(Array.isArray(value) ? value.join(' ') : value); }
    splitTextToSize(value) { return String(value).split('\n'); }
    addPage() { pages++; }
    getNumberOfPages() { return pages; }
  }
  const invoice = invoiceDraft({ number: 'ACME/2026-01', name: 'November editing' });
  const pdf = app.buildInvoicePdf(invoice, Pdf);
  assert.equal(pdf.properties.title, 'November editing');
  assert.match(text.join('\n'), /ACME\/2026-01/);
  assert.match(text.join('\n'), /November 3, 2026/);
  assert.match(text.join('\n'), /USD 87.50/);
  assert.match(text.join('\n'), /Page 1 of 1/);
  assert.doesNotMatch(text.join('\n'), /script\.google\.com|file:\/\//);
  assert.equal(app.invoiceFilename(invoice, 'pdf'), 'Invoice-ACME-2026-01-November editing.pdf');
});

test('rapid PDF clicks generate one copy and library failures restore the export control', async () => {
  const app = client();
  app.savedFiles = [];
  app.pdfMessages = [];
  app.getState().invoices.editor = invoiceDraft({ number: 'ACME/01', name: 'Editing' });
  vm.runInContext(`updateInvoiceBusy=()=>{};showToast=message=>pdfMessages.push(message);
    loadInvoicePdfLibrary=()=>Promise.resolve(function Pdf(){});
    buildInvoicePdf=()=>({save:async filename=>savedFiles.push(filename)});`, app);
  await Promise.all([app.downloadCurrentInvoicePdf(), app.downloadCurrentInvoicePdf()]);
  assert.equal(app.savedFiles.length, 1);
  assert.equal(app.savedFiles[0], 'Invoice-ACME-01-Editing.pdf');
  assert.equal(app.getState().invoices.pdfBusy, false);
  vm.runInContext('loadInvoicePdfLibrary=()=>Promise.reject(new Error("Library unavailable"));', app);
  await app.downloadCurrentInvoicePdf();
  assert.equal(app.getState().invoices.pdfBusy, false);
  assert.equal(app.pdfMessages.at(-1), 'Library unavailable');
});

test('timeline summary is not repeated in other workspaces and Metrics owns its filtered totals', () => {
  const app = client();
  const state = app.getState();
  state.tasks = [listTask('VID-1', '', { hours: 2, status: 'Done', start: app.parseDate('2026-11-03'), end: app.parseDate('2026-11-03') }),
    listTask('VID-2', '', { hours: 5, start: app.parseDate('2026-11-20'), end: app.parseDate('2026-11-21') })];
  state.loaded = true;
  for (const view of ['tasks', 'dashboard', 'invoices']) {
    state.activeView = view;
    app.renderStats();
    assert.equal(app.elements.get('stats').hidden, true);
  }
  state.activeView = 'dashboard';
  state.dashboard.period = 'daily';
  state.dashboard.anchor = app.parseDate('2026-11-03');
  app.renderDashboard();
  assert.match(app.elements.get('dashboardContent').innerHTML, /id="dashboardMetrics"/);
  assert.match(app.elements.get('dashboardContent').innerHTML, /1 scheduled tasks/);
  assert.equal(app.elements.get('stats').hidden, true);
  state.activeView = 'timeline';
  app.renderStats();
  assert.equal(app.elements.get('stats').hidden, false);
  assert.match(app.elements.get('stats').innerHTML, /Expected hours/);
  state.activeView = 'dashboard';
  state.dashboard.period = 'custom';
  state.dashboard.customStart = '2026-10-28';
  state.dashboard.customEnd = '2026-11-04';
  app.renderDashboard();
  assert.match(app.elements.get('dashboardContent').innerHTML, /id="dashboardCustomStart" type="date"/);
  assert.match(app.elements.get('dashboardContent').innerHTML, /id="dashboardCustomEnd" type="date"/);
  assert.match(app.elements.get('dashboardContent').innerHTML, /Selected period:<\/strong> <time class="date-label" datetime="2026-10-28"/);
  assert.match(app.elements.get('dashboardContent').innerHTML, /<time class="date-label" datetime="2026-11-04"/);
});

test('metrics model separates actual completions from schedules and counts leaf hours by parent once', () => {
  const app = client();
  const date = value => app.parseDate(value);
  const tasks = [
    listTask('VID-1', '', { name: 'Project', hours: 99, start: date('2026-11-01'), end: date('2026-11-30') }),
    listTask('VID-2', 'VID-1', { hours: 3, clients: ['Acme', 'Beta'], status: 'Done', start: date('2026-11-01'), end: date('2026-11-04'), actualEndDate: date('2026-11-03') }),
    listTask('VID-3', 'VID-1', { hours: 2, clients: ['Acme'], status: 'Blocked', start: date('2026-11-02'), end: date('2026-11-03') }),
    listTask('VID-4', '', { hours: 0, category: 'Video editing', clients: ['Acme'], status: 'Done', start: date('2026-10-01'), end: date('2026-10-20'), actualEndDate: date('2026-11-04') })
  ];
  const range = app.dashboardRange('weekly', date('2026-11-04'));
  const model = app.buildMetricsModel(tasks, range, 'client:Acme', date('2026-11-04'), 'weekly');
  assert.equal(model.hours.total, 5);
  assert.equal(model.groups.length, 1);
  assert.equal(model.groups[0].units, 500);
  assert.equal(model.completed.length, 2);
  assert.equal(model.overdue.length, 1);
  assert.equal(model.attention[0].task.id, 'VID-3');
  assert.deepEqual(Array.from(model.finishVariance, item => [item.task.id, item.days]), [['VID-4', 15], ['VID-2', -1]]);
});

test('Needs Attention catches In Progress tasks due yesterday or today outside the selected period', () => {
  const app = client();
  const today = app.parseDate('2026-11-04');
  const yesterday = app.parseDate('2026-11-03');
  const tasks = [
    listTask('VID-YESTERDAY', '', { status: 'In Progress', clients: ['Acme'], end: app.parseDate('2026-12-01') }),
    listTask('VID-TODAY', '', { status: 'In Progress', clients: ['Acme'], end: app.parseDate('2026-12-02') }),
    listTask('VID-OTHER-CLIENT', '', { status: 'In Progress', clients: ['Beta'], end: yesterday }),
    listTask('VID-DONE', '', { status: 'Done', clients: ['Acme'], end: yesterday })
  ];
  const range = app.dashboardRange('daily', today);
  tasks[0].end = yesterday;
  tasks[1].end = today;
  const model = app.buildMetricsModel(tasks, range, 'client:Acme', today, 'daily');
  assert.deepEqual(Array.from(model.overdue, task => task.id), ['VID-YESTERDAY']);
  assert.deepEqual(Array.from(model.dueToday, task => task.id), ['VID-TODAY']);
  assert.deepEqual(Array.from(model.attention, item => item.reason), ['Overdue now', 'Due today']);
  assert.equal(app.buildMetricsModel(tasks, range, '', today, 'daily').overdue.some(task => task.id === 'VID-OTHER-CLIENT'), true);
  assert.match(html, /Overdue and due-today items for \$\{esc\(attentionClient\)\} are current and not limited to this period/);
  assert.match(html, /Showing up to eight; View all opens every match/);
});

test('rescheduling an In Progress task to yesterday or today reaches the refreshed attention rows', () => {
  const backend = server([taskRow('VID-OVERDUE')]);
  backend.rows[1][4] = 'In Progress';
  backend.rows[1][5] = new Date(2026, 10, 10);
  backend.rows[1][6] = new Date(2026, 10, 12);
  backend.rows[1][14] = '["Acme"]';
  backend.context.initializeTaskHeaders_(backend.sheet);
  const app = client();
  const today = app.parseDate('2026-11-04');
  const range = app.dashboardRange('daily', today);
  const firstVersion = backend.context.getTasks().tasks[0].updatedAt;
  backend.context.updateTask({ taskId: 'VID-OVERDUE', taskName: 'VID-OVERDUE', category: 'Video editing', priority: 'Medium', status: 'In Progress', startDate: '2026-11-02', endDate: '2026-11-03', description: '', clients: ['Acme'], expectedUpdatedAt: firstVersion });
  let task = app.normalizeTask(backend.context.getTasks().tasks[0]);
  let model = app.buildMetricsModel([task], range, 'client:Acme', today, 'daily');
  assert.equal(model.attention[0].reason, 'Overdue now');
  backend.context.updateTask({ taskId: 'VID-OVERDUE', taskName: 'VID-OVERDUE', category: 'Video editing', priority: 'Medium', status: 'In Progress', startDate: '2026-11-03', endDate: '2026-11-04', description: '', clients: ['Acme'], expectedUpdatedAt: backend.context.getTasks().tasks[0].updatedAt });
  task = app.normalizeTask(backend.context.getTasks().tasks[0]);
  model = app.buildMetricsModel([task], range, 'client:Acme', today, 'daily');
  assert.equal(model.attention[0].reason, 'Due today');
  app.getState().taskById = new Map([[task.id, task]]);
  app.getState().childrenByParent = new Map();
  assert.match(app.renderMetricsAttention(model), /Due today/);
});

test('metric drilldowns reevaluate changes and finish variance requires comparable dates', () => {
  const app = client();
  const task = listTask('VID-1', '', { status: 'In Progress', start: app.parseDate('2026-11-01'), end: app.parseDate('2026-11-02') });
  const focus = { kind: 'overdue', start: '2026-11-01', end: '2026-11-30', period: 'monthly', client: '' };
  assert.equal(app.metricsFocusIds([task], focus, app.parseDate('2026-11-04')).length, 1);
  task.status = 'Done';
  assert.equal(app.metricsFocusIds([task], focus, app.parseDate('2026-11-04')).length, 0);
  task.actualEndDate = app.parseDate('2026-11-03');
  const varianceFocus = { kind: 'finishVariance', start: '2026-11-01', end: '2026-11-30', period: 'monthly', client: '' };
  assert.deepEqual(Array.from(app.metricsFocusIds([task], varianceFocus, app.parseDate('2026-11-04'))), ['VID-1']);
  task.end = null;
  assert.deepEqual(Array.from(app.metricsFocusIds([task], varianceFocus, app.parseDate('2026-11-04'))), []);
});

test('metric drilldown task IDs preserve parent context while excluding unrelated siblings', () => {
  const app = client();
  const tasks = [listTask('VID-1'), listTask('VID-2', 'VID-1'), listTask('VID-3', 'VID-1')];
  const grouped = app.taskGroups(tasks, { taskIds: new Set(['VID-2']) }, 'id', 1);
  assert.equal(grouped.matchingCount, 1);
  assert.equal(grouped.groups[0].contextOnly, true);
  assert.equal(grouped.groups[0].children.length, 1);
  assert.equal(grouped.groups[0].children[0].id, 'VID-2');
});

test('metrics preferences persist safely without assuming browser storage access', () => {
  const app = client();
  const values = new Map();
  app.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const dashboard = app.getState().dashboard;
  dashboard.period = 'custom'; dashboard.client = 'client:Acme'; dashboard.anchor = app.parseDate('2026-11-04');
  dashboard.customStart = '2026-10-28'; dashboard.customEnd = '2026-11-04';
  app.persistMetricsPreferences();
  dashboard.period = 'monthly'; dashboard.client = ''; dashboard.anchor = null;
  dashboard.customStart = ''; dashboard.customEnd = '';
  app.restoreMetricsPreferences();
  assert.equal(dashboard.period, 'custom');
  assert.equal(dashboard.client, 'client:Acme');
  assert.equal(app.dateKey(dashboard.anchor), '2026-11-04');
  assert.equal(dashboard.customStart, '2026-10-28');
  assert.equal(dashboard.customEnd, '2026-11-04');
  app.localStorage.getItem = () => { throw new Error('Storage blocked'); };
  assert.doesNotThrow(() => app.restoreMetricsPreferences());
});

test('Metrics invoice review carries client/range without silently replacing an unsaved draft', () => {
  const app = client();
  const state = app.getState();
  app.confirm = () => false;
  app.switchView = view => { state.activeView = view; };
  app.renderInvoices = () => {};
  state.dashboard = { period: 'weekly', anchor: app.parseDate('2026-11-04'), client: 'client:Acme' };
  state.invoices.loaded = true;
  state.invoices.settings = { anchor: '2026-11-02', currency: 'USD', defaultRate: 25, senderName: 'Studio', senderDetails: '', paymentNotes: '' };
  state.invoices.today = '2026-11-04';
  state.invoices.editor = invoiceDraft({ client: 'Keep existing client' });
  state.invoices.dirty = true;
  app.reviewMetricsInvoice();
  assert.equal(state.invoices.editor.client, 'Keep existing client');
  state.invoices.dirty = false;
  app.reviewMetricsInvoice();
  assert.equal(state.invoices.editor.client, 'Acme');
  assert.equal(state.invoices.editor.periodStart, '2026-11-02');
  assert.equal(state.invoices.editor.periodEnd, '2026-11-08');
  assert.equal(state.invoices.editor.periodMode, 'custom');
  assert.equal(state.invoices.editor.lines.length, 0);
});

test('finish variance shows per-task date differences, escapes names, and caps visible rows', () => {
  const app = client();
  const tasks = Array.from({ length: 20 }, (_, index) => listTask('VID-' + index, 'PARENT-' + index, { name: 'Client <script>' + index,
    hours: index + 1, start: app.parseDate('2026-11-01'), end: app.parseDate('2026-11-04'), status: 'Done', actualEndDate: app.parseDate('2026-11-04') }));
  const range = app.dashboardRange('weekly', app.parseDate('2026-11-04'));
  const model = app.buildMetricsModel(tasks, range, '', app.parseDate('2026-11-04'), 'weekly');
  const parentChart = app.renderMetricsParentChart(model);
  assert.equal((parentChart.match(/class="metrics-parent"/g) || []).length, 5);
  assert.match(parentChart, /Client &lt;script&gt;/);
  assert.doesNotMatch(parentChart, /Client <script>/);
  const finishVariance = app.renderMetricsFinishVariance(model);
  assert.equal((finishVariance.match(/<tr>/g) || []).length, 9);
  assert.match(finishVariance, /On time/);
  assert.match(finishVariance, /Client &lt;script&gt;/);
  assert.doesNotMatch(finishVariance, /Client <script>/);
  assert.match(finishVariance, /Showing 8 of 20 completed tasks/);
  const early = listTask('VID-EARLY', '', { name: 'Early task', status: 'Done', end: app.parseDate('2026-11-05'), actualEndDate: app.parseDate('2026-11-03') });
  const late = listTask('VID-LATE', '', { name: 'Late task', status: 'Done', end: app.parseDate('2026-11-03'), actualEndDate: app.parseDate('2026-11-05') });
  const varianceModel = app.buildMetricsModel([early, late], range, '', app.parseDate('2026-11-04'), 'weekly');
  const varianceHtml = app.renderMetricsFinishVariance(varianceModel);
  assert.ok(varianceHtml.indexOf('Late task') < varianceHtml.indexOf('Early task'));
  assert.match(varianceHtml, /2 days late/);
  assert.match(varianceHtml, /2 days early/);
  assert.doesNotMatch(varianceHtml, /metrics-variance-bar|metrics-variance-axis|metrics-variance-track/);
  assert.match(varianceHtml, /<th>Variance<\/th>/);
  const empty = app.buildMetricsModel([], range, '', app.parseDate('2026-11-04'), 'weekly');
  assert.match(app.renderMetricsFinishVariance(empty), /No completed tasks with both a planned end date and actual completion date/);
  assert.match(app.renderMetricsParentChart(empty), /No expected hours/);
});

function taskFormClient(transport = false) {
  const app = transport ? loadingClient() : client();
  const state = app.getState();
  state.editId = 'VID-1';
  for (const [id, value] of Object.entries({ taskName: 'Video', category: 'Video editing', priority: 'Medium', startDate: '2026-11-04', endDate: '2026-11-05', description: '', parentTaskId: '', taskStatus: 'To Do', taskHours: '2' })) app.elements.set(id, { value });
  app.elements.set('taskModal', { classList: { remove() {} } });
  state.clientSelections.taskClients = ['Acme'];
  state.taskBaseline = app.captureTaskForm();
  if (transport) {
    state.loaded = true;
    state.taskById.set('VID-1', listTask('VID-1', '', { name: 'Video', category: 'Video editing', hours: 2, start: app.parseDate('2026-11-04'), end: app.parseDate('2026-11-05'), clients: ['Acme'] }));
    app.elements.set('saveBtn', { disabled: false });
    app.elements.set('formError', { style: {} });
    vm.runInContext('showToast=()=>{};', app);
  }
  return app;
}

test('task detail saves send hours only for subtasks', () => {
  for (const [parentTaskId, shouldIncludeHours] of [['', false], ['VID-PARENT', true]]) {
    const app = taskFormClient(true);
    const state = app.getState();
    state.taskById.set('VID-1', listTask('VID-1', parentTaskId, { name: 'Video', category: 'Video editing', hours: 2,
      start: app.parseDate('2026-11-04'), end: app.parseDate('2026-11-05'), clients: ['Acme'] }));
    app.elements.get('taskHours').readOnly = !shouldIncludeHours;
    state.taskBaseline = app.captureTaskForm();
    app.saveTask({ preventDefault() {} });
    assert.equal(app.calls[0].method, 'updateTask');
    assert.equal(Object.prototype.hasOwnProperty.call(app.calls[0].args[0], 'hours'), shouldIncludeHours);
  }
});

test('task dirty guards preserve edits on cancelled close and ignore calculated parent-hour changes', () => {
  const app = taskFormClient();
  assert.equal(app.taskFormHasChanges(), false);
  app.elements.get('taskName').value = 'Unsaved name';
  app.confirm = () => false;
  assert.equal(app.closeModal(), false);
  assert.equal(app.getState().editId, 'VID-1');
  assert.equal(app.elements.get('taskName').value, 'Unsaved name');
  app.elements.get('taskName').value = 'Video';
  app.elements.get('taskHours').readOnly = true;
  app.elements.get('taskHours').value = '100';
  assert.equal(app.taskFormHasChanges(), false);
  app.elements.get('description').value = 'New notes';
  app.confirm = () => true;
  assert.equal(app.closeModal(), true);
  assert.equal(app.getState().taskBaseline, null);
});

test('unsent child drafts and bulk changes are guarded but already applied templates are not', () => {
  const app = taskFormClient();
  const panel = app.getState().subtaskPanel;
  panel.draft = 'Step one'; panel.quantity = 2;
  assert.equal(app.hasPendingSubtaskWork(), true);
  panel.createdDraftKey = JSON.stringify([panel.draft, panel.quantity]);
  assert.equal(app.hasPendingSubtaskWork(), false);
  panel.patch = { priority: 'High' };
  assert.equal(app.hasPendingSubtaskWork(), true);
  panel.appliedPatchKey = JSON.stringify(panel.patch);
  assert.equal(app.hasPendingSubtaskWork(), false);
});

test('workspace switching cannot discard a dirty task when confirmation is cancelled', () => {
  const app = taskFormClient();
  app.getState().activeView = 'timeline';
  app.elements.get('description').value = 'Keep these notes';
  app.confirm = () => false;
  app.switchView('dashboard');
  assert.equal(app.getState().activeView, 'timeline');
  assert.equal(app.getState().editId, 'VID-1');
  assert.equal(app.elements.get('description').value, 'Keep these notes');
});

test('status-only saving leaves other unsaved details open', () => {
  const app = loadingClient();
  const state = app.getState();
  state.loaded = true; state.editId = 'VID-1';
  state.taskById.set('VID-1', listTask('VID-1'));
  for (const [id, value] of Object.entries({ taskName: 'Video', category: 'Video editing', priority: 'Medium', startDate: '2026-11-04', endDate: '2026-11-05', description: '', parentTaskId: '', taskStatus: 'To Do', taskHours: '2' })) app.elements.set(id, { value });
  state.taskBaseline = app.captureTaskForm();
  app.elements.get('description').value = 'Unsaved notes';
  app.elements.get('taskStatus').value = 'Done';
  app.messages = [];
  vm.runInContext('showToast=message=>messages.push(message);', app);
  app.saveStatusOnly();
  app.calls[0].success({ success: true });
  assert.equal(state.editId, 'VID-1');
  assert.equal(state.taskBaseline.status, 'Done');
  assert.equal(app.elements.get('description').value, 'Unsaved notes');
  assert.equal(app.taskFormHasChanges(), true);
});

test('inline hours save uses the hours-only endpoint and clears drafts only after success', () => {
  const app = loadingClient();
  const state = app.getState();
  state.loaded = true;
  state.taskById.set('VID-1', listTask('VID-1', 'VID-PARENT', { hours: 2 }));
  state.list.hourDrafts.set('VID-1', '3.5');
  app.elements.set('inlineHours-VID-1', { value: '3.5', checkValidity: () => true });
  app.messages = [];
  vm.runInContext('showToast=message=>messages.push(message);', app);
  assert.equal(app.hasInlineHourChanges(), true);
  app.saveInlineTaskHours('VID-1');
  assert.equal(app.calls[0].method, 'updateTaskHours');
  assert.equal(state.list.hourDrafts.get('VID-1'), '3.5');
  app.calls[0].success({ success: true });
  assert.equal(state.list.hourDrafts.has('VID-1'), false);
  assert.equal(app.calls[1].method, 'getTasks');
});

test('inline hours failures retain entered values and do not alter the saved task hours', () => {
  const app = loadingClient();
  const state = app.getState();
  state.loaded = true;
  const task = listTask('VID-1', 'VID-PARENT', { hours: 2 });
  state.taskById.set(task.id, task);
  state.list.hourDrafts.set(task.id, '4');
  app.elements.set('inlineHours-VID-1', { value: '4', checkValidity: () => true });
  vm.runInContext('showToast=()=>{};', app);
  app.saveInlineTaskHours(task.id);
  app.calls[0].failure(new Error('Unavailable'));
  assert.equal(state.list.hourDrafts.get(task.id), '4');
  assert.equal(task.hours, 2);
  assert.equal(app.calls[1].method, 'getTasks');
});

test('invoice readiness identifies field-specific hours/rates and duplicate identities before issuing', () => {
  const app = client();
  const invoice = invoiceDraft({ number: 'ACME-01', lines: [{ taskId: 'VID-1', description: 'Video', hours: '', rate: 0 }] });
  const pending = app.invoiceReadiness(invoice, []);
  assert.equal(pending.ready, false);
  assert.deepEqual(Array.from(pending.issues, issue => issue.field), ['hours', 'rate']);
  assert.equal(pending.issues[0].line, 0);
  invoice.lines[0].hours = 3.5; invoice.lines[0].rate = 25;
  assert.equal(app.invoiceReadiness(invoice, []).ready, true);
  const other = { id: 'INV-other-invoice', number: 'acme-01', client: 'ACME', status: 'Issued', periodStart: invoice.periodStart, periodEnd: invoice.periodEnd };
  const duplicate = app.invoiceReadiness(invoice, [other]);
  assert.equal(duplicate.ready, false);
  assert.ok(duplicate.issues.some(issue => issue.field === 'number'));
  assert.ok(duplicate.issues.some(issue => /client and period/.test(issue.message)));
  assert.equal(app.invoiceReadiness(invoice, [{ ...other, id: invoice.id }]).ready, true);
});

test('invoice readiness checks invalid dates and leaves incomplete draft values unchanged', () => {
  const app = client();
  const invoice = invoiceDraft({ client: '', senderName: '', issueDate: '', lines: [] });
  const before = JSON.stringify(invoice);
  const result = app.invoiceReadiness(invoice);
  assert.equal(result.ready, false);
  assert.ok(result.issues.some(issue => issue.field === 'client'));
  assert.ok(result.issues.some(issue => issue.field === 'senderName'));
  assert.ok(result.issues.some(issue => issue.field === 'issueDate'));
  assert.equal(JSON.stringify(invoice), before);
});

test('saving parent details keeps unsent subtask names open and marks only the form fields saved', () => {
  const app = taskFormClient(true);
  const state = app.getState();
  app.resetSubtaskPanel('VID-1');
  state.subtaskPanel.draft = 'New child';
  state.subtaskPanel.quantity = 3;
  app.elements.get('description').value = 'Saved parent notes';
  app.saveTask({ preventDefault() {} });
  assert.equal(app.calls[0].method, 'updateTask');
  app.calls[0].success({ success: true });
  assert.equal(state.editId, 'VID-1');
  assert.equal(state.subtaskPanel.draft, 'New child');
  assert.equal(state.subtaskPanel.quantity, 3);
  assert.equal(app.taskFormHasChanges(), false);
  assert.equal(app.hasPendingSubtaskWork(), true);
  assert.equal(app.calls[1].method, 'getTasks');
});

test('invoice Issue command performs readiness checks before confirmation or a server write', () => {
  const app = loadingClient();
  const state = app.getState();
  state.invoices.editor = invoiceDraft({ lines: [] });
  app.messages = [];
  let confirmations = 0;
  app.confirm = () => { confirmations++; return true; };
  vm.runInContext('showToast=message=>messages.push(message);focusInvoiceIssue=()=>{};', app);
  app.saveCurrentInvoice('Issued');
  assert.equal(app.calls.length, 0);
  assert.equal(confirmations, 0);
  assert.equal(app.elements.get('issueInvoiceBtn').disabled, true);
  assert.match(app.messages[0], /at least one/);
});

test('void invoice copies remain exportable after a replacement is issued for the same period', () => {
  const app = client();
  const invoice = invoiceDraft({ status: 'Void', number: 'OLD-01' });
  const replacement = { ...invoice, id: 'INV-replacement-ready', status: 'Issued', number: 'NEW-01' };
  assert.equal(app.invoiceReadiness(invoice, [replacement]).ready, true);
  assert.equal(app.invoiceReadiness({ ...invoice, status: 'Draft' }, [replacement]).ready, false);
});

test('Biweekly labels retain existing 14-day period values and saved-preference compatibility', () => {
  const app = client();
  const state = app.getState();
  state.loaded = true;
  state.activeView = 'dashboard';
  state.dashboard.period = 'fortnightly';
  state.dashboard.anchor = app.parseDate('2026-11-04');
  app.renderDashboard();
  assert.match(app.elements.get('dashboardContent').innerHTML, />Biweekly<\/button>/);
  assert.doesNotMatch(app.elements.get('dashboardContent').innerHTML, />Fortnightly<\/button>/);
  assert.ok(html.includes('title="14 days">Biweekly</button>'));
  assert.ok(html.includes('value="fortnightly">Biweekly (14 days)</option>'));
  const range = app.dashboardRange('fortnightly', state.dashboard.anchor);
  assert.equal(app.dayDiff(range.start, range.end), 13);
});

test('edit-panel subtasks always order To Do, In Progress, Blocked and Done with stable ID ties', () => {
  const app = client();
  const tasks = [listTask('VID-10', 'VID-1', { status: 'Done' }), listTask('VID-8', 'VID-1', { status: 'Blocked' }),
    listTask('VID-4', 'VID-1', { status: 'In Progress' }), listTask('VID-3', 'VID-1', { status: 'To Do' }),
    listTask('VID-2', 'VID-1', { status: 'To Do' }), listTask('VID-99', 'other', { status: 'To Do' })];
  assert.deepEqual(Array.from(app.orderedSubtasks('VID-1', tasks), task => task.id), ['VID-2', 'VID-3', 'VID-4', 'VID-8', 'VID-10']);
  assert.equal(tasks[0].id, 'VID-10');
});

test('select visible in the edit panel uses status-sorted pages rather than sheet row order', () => {
  const app = client();
  const state = app.getState();
  state.tasks = [...Array.from({ length: 26 }, (_, index) => listTask('VID-' + (index + 2), 'VID-1', { status: 'Done' })),
    listTask('VID-90', 'VID-1', { status: 'To Do' }), listTask('VID-91', 'VID-1', { status: 'In Progress' })];
  app.resetSubtaskPanel('VID-1');
  app.selectPanelPage(true);
  assert.equal(state.subtaskPanel.selected.size, 25);
  assert.equal(state.subtaskPanel.selected.has('VID-90'), true);
  assert.equal(state.subtaskPanel.selected.has('VID-91'), true);
  assert.equal(state.subtaskPanel.selected.has('VID-27'), false);
});

test('status selection shortcuts cover all parent pages and replace rather than accumulate old selections', () => {
  const app = client();
  const state = app.getState();
  state.tasks = [...Array.from({ length: 60 }, (_, index) => listTask('VID-' + (index + 2), 'VID-1', { status: index % 2 ? 'Done' : 'In Progress' })), listTask('OTHER', 'elsewhere', { status: 'In Progress' })];
  app.resetSubtaskPanel('VID-1');
  state.subtaskPanel.selectionStatus = 'In Progress';
  app.selectPanelStatus();
  assert.equal(state.subtaskPanel.selected.size, 30);
  assert.equal(state.subtaskPanel.selected.has('OTHER'), false);
  state.subtaskPanel.selectionStatus = 'Done';
  app.selectPanelStatus();
  assert.equal(state.subtaskPanel.selected.size, 30);
  assert.equal(state.subtaskPanel.selected.has('VID-2'), false);
  state.subtaskPanel.selectionStatus = 'all';
  app.selectPanelStatus();
  assert.equal(state.subtaskPanel.selected.size, 60);
});

test('All tasks status selection respects filters and never selects a context-only parent', () => {
  const app = client();
  const state = app.getState();
  state.tasks = [listTask('VID-1'), listTask('VID-2', 'VID-1', { category: 'Revision', status: 'In Progress' }), listTask('VID-3', 'VID-1', { status: 'In Progress' })];
  state.list.filters.category = 'Revision';
  app.elements.set('taskSelectionStatus', { value: 'In Progress' });
  app.selectTaskStatus();
  assert.deepEqual(Array.from(state.list.selected), ['VID-2']);
  state.writing = true;
  state.list.filters.category = '';
  app.selectTaskStatus();
  assert.deepEqual(Array.from(state.list.selected), ['VID-2']);
});

test('UI foundation declares semantic tokens, readable defaults and protected timeline sizing', () => {
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>Multi Purpose Planner<\/title>/);
  assert.match(html, /--control-height:\s*2\.75rem/);
  assert.match(html, /font-variant-numeric:\s*tabular-nums/);
  assert.match(html, /\.selection-hit\s*\{[^}]*min-width:\s*var\(--control-height\)/);
  assert.match(html, /\.timeline \.task-cell, \.timeline \.day-cell\s*\{ height: 54px/);
  assert.match(html, /#taskForm \{ display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; margin: 0; \}/);
  assert.match(html, /\.modal-body \{ flex: 1 1 auto; min-height: 0; overflow: auto;/);
  assert.match(html, /\.modal-foot \{\s*flex: 0 0 auto;/);
  assert.match(html, /isolation:\s*isolate/);
});

test('task dialog and navigation use accessible labels and retain dirty-safe backdrop handling', () => {
  assert.match(html, /<dialog open class="modal" aria-modal="true" aria-labelledby="modalTitle"/);
  assert.doesNotMatch(html, /id="taskModal" onclick=/);
  assert.match(html, /id="projectNav"[^>]*aria-expanded="true"[^>]*aria-controls="workspaceNav"/);
  assert.match(html, /<nav class="workspace-nav" id="workspaceNav" aria-label="Task Timeline workspaces">/);
  assert.match(html, /function toggleWorkspaceNav\(\)/);
  for (const label of ['Search timeline tasks', 'Timeline status', 'Timeline category']) assert.ok(html.includes('aria-label="' + label + '"'));
  assert.match(html, /class="task-title"[^>]*onclick="openEdit/);
  assert.match(html, /if \(event.target === \$\('taskModal'\)\) closeModal\(\)/);
  assert.match(html, /\.nav-text \{ display: block; font-size: 11px/);
});

test('Task Timeline sidebar group toggles its workspace navigation accessibly', () => {
  const app = client();
  const attributes = new Map([['aria-expanded', 'true']]);
  const projectNav = { getAttribute: name => attributes.get(name), setAttribute: (name, value) => attributes.set(name, value) };
  const workspaceNav = { hidden: false };
  app.elements.set('projectNav', projectNav);
  app.elements.set('workspaceNav', workspaceNav);
  app.toggleWorkspaceNav();
  assert.equal(attributes.get('aria-expanded'), 'false');
  assert.equal(workspaceNav.hidden, true);
  app.toggleWorkspaceNav();
  assert.equal(attributes.get('aria-expanded'), 'true');
  assert.equal(workspaceNav.hidden, false);
});

test('dialog keyboard focus wraps at both boundaries and dismissal uses the guarded close function', () => {
  const app = client();
  const control = () => ({ matches: () => false, closest: () => null, getClientRects: () => [{}], focus() { app.document.activeElement = this; } });
  const first = control();
  const last = control();
  const dialog = { querySelectorAll: () => [first, last], contains: element => element === first || element === last };
  const modal = { classList: { contains: () => true }, querySelector: () => dialog };
  app.elements.set('taskModal', modal);
  const keydown = app.listeners.get('keydown')[0];
  let prevented = 0;
  app.document.activeElement = last;
  keydown({ key: 'Tab', preventDefault() { prevented++; } });
  assert.equal(app.document.activeElement, first);
  keydown({ key: 'Tab', shiftKey: true, preventDefault() { prevented++; } });
  assert.equal(app.document.activeElement, last);
  assert.equal(prevented, 2);
  let closes = 0;
  app.closeModal = () => { closes++; };
  keydown({ key: 'Escape' });
  app.listeners.get('click')[0]({ target: modal });
  app.listeners.get('click')[0]({ target: first });
  assert.equal(closes, 2);
});

test('invoice field errors wait for interaction and follow the original line through removal', () => {
  const app = client();
  const state = app.getState();
  state.invoices.editor = { client: 'Studio', senderName: 'Editor', currency: 'USD', status: 'Draft', periodStart: '2026-11-01', periodEnd: '2026-11-14', issueDate: '2026-11-01', dueDate: '2026-11-14', lines: [
    { description: 'First', hours: '', rate: '' }, { description: 'Second', hours: '', rate: '' }
  ] };
  app.updateInvoiceReadiness();
  assert.equal(app.elements.get('invoiceError-0-hours').textContent, '');
  assert.equal(app.elements.get('issueInvoiceBtn').disabled, true);
  app.touchInvoiceField({ field: 'hours', line: 0 });
  assert.match(app.elements.get('invoiceError-0-hours').textContent, /positive hours/);
  assert.equal(app.elements.get('invoiceError-0-rate').textContent, '');
  state.invoices.editor.lines.shift();
  app.updateInvoiceReadiness();
  assert.equal(app.elements.get('invoiceError-0-hours').textContent, '');
  app.revealInvoiceErrors(app.invoiceReadiness(state.invoices.editor));
  assert.match(app.elements.get('invoiceError-0-rate').textContent, /positive hourly rate/);
  state.invoices.editor = { ...state.invoices.editor, lines: [{ description: 'New', hours: '', rate: '' }] };
  app.updateInvoiceReadiness();
  assert.equal(app.elements.get('invoiceError-0-rate').textContent, '');
});

test('loading placeholders announce status, hide skeletons and honor reduced motion', () => {
  const app = client();
  for (const view of ['timeline', 'tasks', 'dashboard', 'invoices']) {
    const markup = app.loadingMarkup(view);
    assert.ok(markup.includes('loading-' + view));
    assert.match(markup, /aria-busy="true"><output aria-live="polite">Loading/);
    assert.match(markup, /class="loading-skeleton" aria-hidden="true"/);
  }
  assert.match(html, /\.loading:before \{ animation: none; \}/);
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