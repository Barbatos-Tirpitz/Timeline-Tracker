
const CONFIG = {
  SHEET_NAME: 'Task_Master',
  HEADERS: [
  'Task ID',
  'Task Name',
  'Category',
  'Priority',
  'Status',
  'Start Date',
  'End Date',
  'Duration',
  'Description',
  'Actual Start',
  'Actual End',
  'Created At',
  'Updated At',
  'Parent Task ID',
  'Clients',
  'Hours'
  ],
  CATEGORIES: [
    'Graphic Design',
    'Video editing',
    'Scheduling'
  ],
  PRIORITIES: ['Low', 'Medium', 'High']
};

const LEGACY_CATEGORY_MAP = Object.freeze({
  'Graphics': 'Graphic Design',
  'Pre-production': 'Video editing',
  'Editing': 'Video editing',
  'Post-production': 'Video editing',
  'Subtitles': 'Video editing',
  'Review': 'Video editing',
  'Delivery': 'Video editing'
});

function validateCategory_(category) {
  if (!CONFIG.CATEGORIES.includes(category)) {
    throw new Error('Invalid task category. Allowed categories: ' + CONFIG.CATEGORIES.join(', ') + '.');
  }
}

// Adds a menu whenever the spreadsheet opens.
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Task Manager')
    .addItem('Build / Refresh Timeline', 'setupTimeline')
    .addItem('Initialize Task Database', 'setupTaskDatabase')
    .addItem('Upgrade Categories, Clients and Hours (with backup)', 'upgradeTaskDatabase')
    .addToUi();
}

function normalizeClients_(values) {
  if (!Array.isArray(values)) throw new Error('Clients must be a list of names.');
  const names = new Map();
  values.forEach(value => {
    if (typeof value !== 'string') throw new Error('Each client must be a name.');
    const name = value.trim();
    if (!name || name.length > 100) throw new Error('Client names must contain 1-100 characters.');
    if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
  });
  if (names.size > 50) throw new Error('A task can have at most 50 clients.');
  return [...names.values()].sort((first, second) => first.localeCompare(second, undefined, { sensitivity: 'base', numeric: true }));
}

function readClients_(value, taskId) {
  if (value === '' || value == null) return [];
  try {
    return normalizeClients_(JSON.parse(String(value)));
  } catch (error) {
    throw new Error('Invalid Clients data for ' + taskId + ': ' + error.message);
  }
}

function hasClientsColumn_(sheet) {
  if (sheet.getMaxColumns() < 15) return false;
  const header = sheet.getRange(1, 15).getValue();
  if (header && header !== 'Clients') throw new Error('Column O is already in use. Inspect Task_Master before upgrading.');
  if (!header && sheet.getLastRow() > 1 && sheet.getRange(2, 15, sheet.getLastRow() - 1, 1).getValues().some(row => row[0] !== '')) {
    throw new Error('Column O contains data without a Clients header. Inspect Task_Master before upgrading.');
  }
  return header === 'Clients';
}

function validateTaskHeaders_(sheet) {
  if (!sheet.getLastRow()) return;
  const existing = sheet.getRange(1, 1, 1, 13).getValues()[0];
  if (existing.join('|') !== CONFIG.HEADERS.slice(0, 13).join('|')) throw new Error('Task_Master headers do not match the required structure.');
  if (sheet.getMaxColumns() >= 14) {
    const parentHeader = sheet.getRange(1, 14).getValue();
    if (parentHeader && parentHeader !== 'Parent Task ID') throw new Error('Column N is already in use. Inspect Task_Master before upgrading.');
  }
  hasClientsColumn_(sheet);
  hasHoursColumn_(sheet);
}

function normalizeTaskHours_(value, taskId = '') {
  if (value === '' || value == null) return 0;
  const number = Number(value);
  if (!['number', 'string'].includes(typeof value) || !Number.isFinite(number) || number < 0 || number > 10000 ||
      Math.abs(number * 100 - Math.round(number * 100)) > 0.000001) {
    throw new Error('Hours' + (taskId ? ' for ' + taskId : '') + ' must be between 0 and 10000, with at most two decimal places.');
  }
  return Math.round(number * 100) / 100;
}

function hasHoursColumn_(sheet) {
  if (sheet.getMaxColumns() < 16) return false;
  const header = sheet.getRange(1, 16).getValue();
  if (header && header !== 'Hours') throw new Error('Column P is already in use. Inspect Task_Master before upgrading.');
  if (!header && sheet.getLastRow() > 1 && sheet.getRange(2, 16, sheet.getLastRow() - 1, 1).getValues().some(row => row[0] !== '')) {
    throw new Error('Column P contains data without an Hours header. Inspect Task_Master before upgrading.');
  }
  return header === 'Hours';
}

function taskReadWidth_(sheet) {
  const clients = hasClientsColumn_(sheet);
  const hours = hasHoursColumn_(sheet);
  return hours ? 16 : clients ? 15 : Math.min(14, sheet.getMaxColumns());
}

function initializeTaskHeaders_(sheet) {
  validateTaskHeaders_(sheet);
  if (sheet.getMaxColumns() < CONFIG.HEADERS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), CONFIG.HEADERS.length - sheet.getMaxColumns());
  }
  sheet.getRange(1, 1, 1, CONFIG.HEADERS.length).setValues([CONFIG.HEADERS]);
}

function categoryForUpgrade_(category) {
  if (CONFIG.CATEGORIES.includes(category)) return category;
  if (Object.prototype.hasOwnProperty.call(LEGACY_CATEGORY_MAP, category)) return LEGACY_CATEGORY_MAP[category];
  throw new Error('Unknown category "' + category + '". Set it to one of ' + CONFIG.CATEGORIES.join(', ') + ' before upgrading.');
}

function upgradeTaskDatabase() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Upgrade task database?', 'Create a backup, add Clients in column O and Hours in column P, and migrate task categories?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    if (!sheet) throw new Error('Initialize Task_Master first.');
    validateTaskHeaders_(sheet);
    const width = taskReadWidth_(sheet);
    const rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, width).getValues() : [];
    const changes = [];
    const withClients = hasClientsColumn_(sheet);
    const withHours = hasHoursColumn_(sheet);
    rows.forEach((values, index) => {
      if (!values[0]) return;
      if (withClients) readClients_(values[14], values[0]);
      if (withHours) normalizeTaskHours_(values[15], values[0]);
      const category = categoryForUpgrade_(String(values[2] || ''));
      if (category !== values[2]) changes.push({ rowNumber: index + 2, category });
    });
    if (!changes.length && withClients && withHours) {
      ss.toast('Database is already upgraded.', 'Task Manager', 5);
      return;
    }
    sheet.copyTo(ss).setName('Task_Backup_' + Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyyMMdd_HHmmss_SSS'));
    initializeTaskHeaders_(sheet);
    sheet.getRange('P:P').setNumberFormat('0.00');
    const now = new Date();
    contiguousRows_(changes).forEach(group => {
      sheet.getRange(group[0].rowNumber, 3, group.length, 1).setValues(group.map(record => [record.category]));
      sheet.getRange(group[0].rowNumber, 13, group.length, 1).setValues(group.map(() => [now]));
    });
    ss.toast('Categories, Clients and Hours upgraded. Backup created.', 'Task Manager', 5);
  } finally {
    lock.releaseLock();
  }
}

function setupTaskDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  // Create the database sheet if it doesn't exist.
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  }

  initializeTaskHeaders_(sheet);

  // Apply database formatting.
  sheet.setFrozenRows(1);

  sheet.getRange('A1:P1')
    .setFontWeight('bold')
    .setBackground('#1F2937')
    .setFontColor('#FFFFFF');

  sheet.getRange('F:G').setNumberFormat('mmm d, yyyy');
  sheet.getRange('J:K').setNumberFormat('mmm d, yyyy');
  sheet.getRange('H:H').setNumberFormat('0');
  sheet.getRange('P:P').setNumberFormat('0.00');
  sheet.getRange('L:M').setNumberFormat('mmm d, yyyy hh:mm');

  sheet.autoResizeColumns(1, CONFIG.HEADERS.length);

  ss.toast(
    'Task database is ready!',
    'Task Manager',
    5
  );
}

// Retrieves existing tasks for the sidebar.
// Retrieves tasks and calculates parent progress.
// Retrieves tasks and calculates parent progress.
function getTasks() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  // A missing database is an error, not an empty database.
  if (!sheet) {
    throw new Error(
      'Task_Master sheet not found. Initialize the task database first.'
    );
  }

  const timezone = ss.getSpreadsheetTimeZone();
  const lastRow = sheet.getLastRow();
  const spreadsheetToday = Utilities.formatDate(new Date(), timezone, 'yyyy-MM-dd');
  const withClients = hasClientsColumn_(sheet);
  const withHours = hasHoursColumn_(sheet);

  // Backend confirms that the database contains no task rows.
  if (lastRow < 2) {
    return {
      success: true,
      hasTasks: false,
      spreadsheetToday,
      total: 0,
      tasks: []
    };
  }

  const rows = sheet.getRange(
    2, 1, lastRow - 1, taskReadWidth_(sheet)
  ).getValues();

  const taskRows = rows.filter(row =>
    String(row[0] || '').trim() !== ''
  );

  if (!taskRows.length) {
    return {
      success: true,
      hasTasks: false,
      spreadsheetToday,
      total: 0,
      tasks: []
    };
  }

  // Calculate child counts for every parent.
  const childStats = Object.create(null);
  const ownHours = new Map(taskRows.map(row => [String(row[0]), withHours ? normalizeTaskHours_(row[15], row[0]) : 0]));

  taskRows.forEach(row => {
    const parentId = String(row[13] || '').trim();

    if (!parentId) return;

    if (!childStats[parentId]) {
      childStats[parentId] = {
        total: 0,
        completed: 0,
        hourUnits: 0,
        completedHourUnits: 0
      };
    }

    childStats[parentId].total++;
    childStats[parentId].hourUnits += Math.round(ownHours.get(String(row[0])) * 100);

    if (String(row[4]) === 'Done') {
      childStats[parentId].completed++;
      childStats[parentId].completedHourUnits += Math.round(ownHours.get(String(row[0])) * 100);
    }
  });

  const tasks = taskRows.map(row => {
    const taskId = String(row[0]);
    const stats = childStats[taskId] || {
      total: 0,
      completed: 0,
      hourUnits: 0,
      completedHourUnits: 0
    };

    return {
      taskId: taskId,
      taskName: String(row[1]),
      category: String(row[2]),
      priority: String(row[3]),
      status: String(row[4]),

      startDate: row[5] instanceof Date
        ? Utilities.formatDate(row[5], timezone, 'yyyy-MM-dd') : '',

      endDate: row[6] instanceof Date
        ? Utilities.formatDate(row[6], timezone, 'yyyy-MM-dd') : '',

      duration: row[7],
      description: String(row[8] || ''),

      actualStart: row[9] instanceof Date
        ? Utilities.formatDate(row[9], timezone, 'MMM d, yyyy') : '',

      actualEnd: row[10] instanceof Date
        ? Utilities.formatDate(row[10], timezone, 'MMM d, yyyy') : '',
      actualEndDate: row[10] instanceof Date
        ? Utilities.formatDate(row[10], timezone, 'yyyy-MM-dd') : '',

      parentTaskId: String(row[13] || ''),
      clients: withClients ? readClients_(row[14], taskId) : [],
      hours: ownHours.get(taskId),
      subtaskHours: stats.hourUnits / 100,
      totalHours: stats.total ? stats.hourUnits / 100 : ownHours.get(taskId),
      completedHours: stats.total ? stats.completedHourUnits / 100 : String(row[4]) === 'Done' ? ownHours.get(taskId) : 0,
      subtaskCount: stats.total,
      completedSubtaskCount: stats.completed,

      progress: stats.total
        ? Math.round(stats.completed / stats.total * 100)
        : null
    };
  });

  return {
    success: true,
    hasTasks: true,
    spreadsheetToday,
    total: tasks.length,
    tasks: tasks
  };
}

// Creates a new task.
function createTask(formData) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const sheet = SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(CONFIG.SHEET_NAME);

    if (!sheet) {
      throw new Error(
        'Task_Master does not exist. Initialize the database first.'
      );
    }

    // Optional parent task ID.
    const parentTaskId = String(formData.parentTaskId || '').trim();
    if (!hasClientsColumn_(sheet)) throw new Error('Run Upgrade Categories and Clients from the spreadsheet menu first.');
    let inheritedClients = [];

    if (parentTaskId) {
      const parentRow = findTaskRow(sheet, parentTaskId);
      const existingParentId = sheet.getRange(parentRow, 14).getValue();
      inheritedClients = readClients_(sheet.getRange(parentRow, 15).getValue(), parentTaskId);

      if (existingParentId) {
        throw new Error(
          'Nested subtasks are not supported. Select a top-level task instead.'
        );
      }
    }

    const taskName = String(formData.taskName || '').trim();
    const category = String(formData.category || '');
    const priority = String(formData.priority || '');
    const startDate = parseLocalDate(formData.startDate);
    const endDate = parseLocalDate(formData.endDate);
    const description = String(formData.description || '').trim();
    const clients = formData.clients === undefined ? inheritedClients : normalizeClients_(formData.clients);
    const hours = normalizeTaskHours_(formData.hours);
    if (formData.hours !== undefined && !hasHoursColumn_(sheet)) throw new Error('Run Upgrade Categories, Clients and Hours from the spreadsheet menu first.');

    // Required-field validation.
    if (!taskName || !category || !priority ||
        !startDate || !endDate) {
      throw new Error('Please complete all required fields.');
    }

    validateCategory_(category);

    if (!CONFIG.PRIORITIES.includes(priority)) {
      throw new Error('Invalid task priority.');
    }

    if (endDate < startDate) {
      throw new Error(
        'End date cannot be earlier than start date.'
      );
    }

    const taskId = appendTasks_(sheet, [{ taskName, category, priority, startDate, endDate, description, clients, parentTaskId, hours }])[0];

    return {
      success: true,
      taskId: taskId,
      message: taskId + ' created successfully!'
    };

  } finally {
    lock.releaseLock();
  }
}

// Finds a task by its ID rather than relying on a row number.
function findTaskRow(sheet, taskId) {
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    throw new Error('No tasks found.');
  }

  const ids = sheet.getRange(2, 1, lastRow - 1, 1)
    .getDisplayValues();

  const index = ids.findIndex(row => row[0] === taskId);

  if (index === -1) {
    throw new Error('Task ID not found: ' + taskId);
  }

  return index + 2;
}

// Updates task details without changing its status.
// Updates task details without changing its status.
function updateTask(formData) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const taskId = String(formData.taskId || '').trim();
    const taskName = String(formData.taskName || '').trim();
    const category = String(formData.category || '');
    const priority = String(formData.priority || '');
    const startDate = parseLocalDate(formData.startDate);
    const endDate = parseLocalDate(formData.endDate);
    const description = String(formData.description || '').trim();

    if (!taskId || !taskName || !category ||
        !priority || !startDate || !endDate) {
      throw new Error('Please complete all required fields.');
    }

    validateCategory_(category);

    if (!CONFIG.PRIORITIES.includes(priority)) {
      throw new Error('Invalid task priority.');
    }

    if (endDate < startDate) {
      throw new Error('End date cannot precede start date.');
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet()
      .getSheetByName(CONFIG.SHEET_NAME);

    if (!sheet) {
      throw new Error('Task_Master sheet not found.');
    }

    const row = findTaskRow(sheet, taskId);

    const hours = formData.hours === undefined ? null : normalizeTaskHours_(formData.hours, taskId);
    if (hours !== null) assertEditableTaskHours_(sheet, taskId);
    const clients = formData.clients === undefined ? null : normalizeClients_(formData.clients);
    if (clients !== null && !hasClientsColumn_(sheet)) throw new Error('Run Upgrade Categories and Clients from the spreadsheet menu first.');
    let statusValues = null;
    if (formData.status !== undefined) {
      validateStatus_(formData.status);
      statusValues = nextStatusValues_(
        sheet.getRange(row, 1, 1, 14).getValues()[0],
        formData.status,
        new Date()
      );
    }

    sheet.getRange(row, 2, 1, 3).setValues([[
      taskName, category, priority
    ]]);

    sheet.getRange(row, 6, 1, 2).setValues([[
      startDate, endDate
    ]]);

    sheet.getRange(row, 9).setValue(description);
    sheet.getRange(row, 13).setValue(new Date());
    if (clients !== null) sheet.getRange(row, 15).setValue(JSON.stringify(clients));
    if (hours !== null) sheet.getRange(row, 16).setValue(hours);

    if (statusValues) {
      writeStatusRows_(sheet, [{ rowNumber: row, values: statusValues }]);
    }

    return {
      success: true,
      message: taskId + ' updated successfully!'
    };

  } finally {
    lock.releaseLock();
  }
}

// Updates status and actual work dates.
function assertEditableTaskHours_(sheet, taskId, rows) {
  if (!hasHoursColumn_(sheet)) throw new Error('Run Upgrade Categories, Clients and Hours from the spreadsheet menu first.');
  const parents = rows ? rows.map(values => [values[13]])
    : sheet.getLastRow() > 1 ? sheet.getRange(2, 14, sheet.getLastRow() - 1, 1).getValues() : [];
  if (parents.some(values => String(values[0] || '').trim() === taskId)) {
    throw new Error('Parent hours are calculated from subtasks. Update the subtask hours instead.');
  }
}

function updateTaskHours(taskId, value) {
  const hours = normalizeTaskHours_(value, taskId);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const selection = readTaskSelection_([taskId]);
    assertEditableTaskHours_(selection.sheet, selection.ids[0], selection.rows);
    const row = selection.selected[0].rowNumber;
    selection.sheet.getRange(row, 16).setValue(hours);
    selection.sheet.getRange(row, 13).setValue(new Date());
    return { success: true, taskId: selection.ids[0], hours, message: selection.ids[0] + ' hours updated.' };
  } finally {
    lock.releaseLock();
  }
}

function updateTaskStatus(taskId, newStatus) {
  const result = updateTaskStatuses([taskId], newStatus);
  result.message = taskId + ' status changed to ' + newStatus + '.';
  return result;
}

function validateStatus_(status) {
  if (!['To Do', 'In Progress', 'Blocked', 'Done'].includes(status)) {
    throw new Error('Invalid status.');
  }
}

function readTaskSelection_(taskIds) {
  if (!Array.isArray(taskIds) || !taskIds.length) {
    throw new Error('Select at least one task.');
  }
  const ids = [...new Set(taskIds.map(id => String(id || '').trim()))];
  if (ids.some(id => !id)) throw new Error('Task ID is required.');
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('Task_Master sheet not found.');
  const lastRow = sheet.getLastRow();
  const width = taskReadWidth_(sheet);
  const rows = lastRow < 2 ? [] : sheet.getRange(2, 1, lastRow - 1, width).getValues();
  const byId = new Map();
  rows.forEach((values, index) => {
    const id = String(values[0] || '').trim();
    if (!id) return;
    if (byId.has(id)) throw new Error('Duplicate task ID: ' + id);
    byId.set(id, { rowNumber: index + 2, values });
  });
  ids.forEach(id => {
    if (!byId.has(id)) throw new Error('Task ID not found: ' + id);
  });
  return { sheet, rows, ids, selected: ids.map(id => byId.get(id)) };
}

function nextStatusValues_(values, status, now) {
  if (values[4] === status) return null;
  return {
    status,
    actualStart: values[9] || (status === 'In Progress' || status === 'Done' ? now : ''),
    actualEnd: status === 'Done' ? now : values[4] === 'Done' ? '' : values[10],
    updatedAt: now
  };
}

function contiguousRows_(records) {
  const groups = [];
  records.slice().sort((first, second) => first.rowNumber - second.rowNumber).forEach(record => {
    const previous = groups[groups.length - 1];
    if (previous && previous[previous.length - 1].rowNumber + 1 === record.rowNumber) {
      previous.push(record);
    } else {
      groups.push([record]);
    }
  });
  return groups;
}

function writeStatusRows_(sheet, records) {
  contiguousRows_(records).forEach(group => {
    const row = group[0].rowNumber;
    sheet.getRange(row, 5, group.length, 1).setValues(group.map(record => [record.values.status]));
    sheet.getRange(row, 10, group.length, 2).setValues(
      group.map(record => [record.values.actualStart, record.values.actualEnd])
    );
    sheet.getRange(row, 13, group.length, 1).setValues(group.map(record => [record.values.updatedAt]));
  });
}

function updateTaskStatuses(taskIds, newStatus, parentTaskId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    validateStatus_(newStatus);
    const selection = readTaskSelection_(taskIds);
    if (parentTaskId !== undefined) assertSubtaskSelection_(selection, parentTaskId);
    const now = new Date();
    const changes = selection.selected.map(record => ({
      rowNumber: record.rowNumber,
      values: nextStatusValues_(record.values, newStatus, now)
    })).filter(record => record.values);
    writeStatusRows_(selection.sheet, changes);
    return {
      success: true,
      taskIds: selection.ids,
      changed: changes.length,
      message: changes.length + ' task statuses updated.'
    };
  } finally {
    lock.releaseLock();
  }
}

function assertSubtaskSelection_(selection, parentTaskId) {
  parentTaskId = String(parentTaskId || '').trim();
  const parent = selection.rows.find(values => String(values[0]) === parentTaskId);
  if (!parent || parent[13]) throw new Error('Select an existing top-level parent task.');
  if (selection.selected.some(record => String(record.values[13] || '').trim() !== parentTaskId)) {
    throw new Error('Selection contains tasks that are no longer direct subtasks of this parent. Refresh and select again.');
  }
  return parent;
}

function appendTasks_(sheet, records, existingRows) {
  const lastRow = sheet.getLastRow();
  const rows = existingRows || (lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues() : []);
  let maxId = 0;
  const seen = new Set();
  rows.forEach(values => {
    const id = String(values[0] || '').trim();
    if (id && seen.has(id)) throw new Error('Duplicate task ID: ' + id);
    if (id) seen.add(id);
    const match = id.match(/^VID-(\d+)$/);
    if (match) maxId = Math.max(maxId, Number(match[1]));
  });
  const now = new Date();
  const ids = records.map((record, index) => 'VID-' + String(maxId + index + 1).padStart(3, '0'));
  const values = records.map((record, index) => {
    const row = lastRow + index + 1;
    return [ids[index], literalText_(record.taskName), record.category, record.priority, 'To Do', record.startDate, record.endDate,
      `=IF(OR(F${row}="",G${row}=""),"",G${row}-F${row}+1)`, literalText_(record.description || ''), '', '', now, now,
      record.parentTaskId || '', JSON.stringify(record.clients)];
  });
  if (lastRow + records.length > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), lastRow + records.length - sheet.getMaxRows());
  const withHours = hasHoursColumn_(sheet);
  if (!withHours && records.some(record => normalizeTaskHours_(record.hours) !== 0)) throw new Error('Run Upgrade Categories, Clients and Hours before recording hours.');
  if (withHours) values.forEach((row, index) => row.push(normalizeTaskHours_(records[index].hours)));
  sheet.getRange(lastRow + 1, 1, records.length, withHours ? 16 : 15).setValues(values);
  sheet.getRange(lastRow + 1, 6, records.length, 2).setNumberFormat('mmm d, yyyy');
  sheet.getRange(lastRow + 1, 12, records.length, 2).setNumberFormat('mmm d, yyyy hh:mm');
  return ids;
}

function literalText_(value) {
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

function createSubtasks(parentTaskId, names, quantity = 1) {
  if (!Array.isArray(names) || names.some(name => typeof name !== 'string')) throw new Error('Subtask names must be a list of text values.');
  names = names.map(name => name.trim()).filter(Boolean);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) throw new Error('Quantity must be a whole number from 1 to 100.');
  if (!names.length || names.length * quantity > 100 || names.some(name => name.length > 200)) throw new Error('Enter 1-100 subtask names in total, at most 200 characters each.');
  names = names.flatMap(name => Array(quantity).fill(name));
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const selection = readTaskSelection_([parentTaskId]);
    if (!hasClientsColumn_(selection.sheet)) throw new Error('Run Upgrade Categories and Clients first.');
    const parent = selection.selected[0].values;
    if (parent[13]) throw new Error('Only top-level tasks can have subtasks.');
    validateCategory_(parent[2]);
    if (!CONFIG.PRIORITIES.includes(parent[3]) ||
        !parent[5] || !parent[6] || typeof parent[5].getTime !== 'function' || typeof parent[6].getTime !== 'function' ||
        !Number.isFinite(parent[5].getTime()) || !Number.isFinite(parent[6].getTime()) || parent[6] < parent[5]) {
      throw new Error('Save valid parent category, priority and planned dates before adding subtasks.');
    }
    const clients = readClients_(parent[14], parentTaskId);
    const records = names.map(taskName => ({ taskName, category: parent[2], priority: parent[3], startDate: parent[5], endDate: parent[6], clients, parentTaskId }));
    const taskIds = appendTasks_(selection.sheet, records, selection.rows);
    return { success: true, taskIds, created: taskIds.length, message: taskIds.length + ' subtasks created.' };
  } finally {
    lock.releaseLock();
  }
}

function updateSubtasks(parentTaskId, taskIds, patch) {
  const allowed = ['category', 'priority', 'clients', 'startDate', 'endDate', 'hours'];
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !allowed.includes(key))) {
    throw new Error('Choose at least one supported field to apply.');
  }
  if (patch.category !== undefined) validateCategory_(patch.category);
  if (patch.priority !== undefined && !CONFIG.PRIORITIES.includes(patch.priority)) throw new Error('Invalid task priority.');
  const clients = patch.clients === undefined ? null : normalizeClients_(patch.clients);
  const hours = patch.hours === undefined ? null : normalizeTaskHours_(patch.hours);
  const start = patch.startDate === undefined ? null : parseLocalDate(patch.startDate);
  const end = patch.endDate === undefined ? null : parseLocalDate(patch.endDate);
  if ((patch.startDate !== undefined && !start) || (patch.endDate !== undefined && !end)) throw new Error('Choose valid planned dates.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const selection = readTaskSelection_(taskIds);
    assertSubtaskSelection_(selection, parentTaskId);
    if (hours !== null) {
      if (!hasHoursColumn_(selection.sheet)) throw new Error('Run Upgrade Categories, Clients and Hours from the spreadsheet menu first.');
      const parents = new Set(selection.rows.map(values => String(values[13] || '').trim()).filter(Boolean));
      if (selection.selected.some(record => parents.has(String(record.values[0])))) throw new Error('Parent hours are calculated from subtasks. Update the subtask hours instead.');
    }
    if (clients !== null && !hasClientsColumn_(selection.sheet)) throw new Error('Run Upgrade Categories and Clients first.');
    if (start || end) selection.selected.forEach(record => {
      const mergedStart = start || record.values[5];
      const mergedEnd = end || record.values[6];
      if (!mergedStart || !mergedEnd || typeof mergedStart.getTime !== 'function' || typeof mergedEnd.getTime !== 'function' ||
          !Number.isFinite(mergedStart.getTime()) || !Number.isFinite(mergedEnd.getTime()) || mergedEnd < mergedStart) {
        throw new Error('End date cannot precede start date for ' + record.values[0] + '.');
      }
    });
    const fields = [];
    if (patch.category !== undefined) fields.push([3, patch.category]);
    if (patch.priority !== undefined) fields.push([4, patch.priority]);
    if (start) fields.push([6, start]);
    if (end) fields.push([7, end]);
    if (clients !== null) fields.push([15, JSON.stringify(clients)]);
    if (hours !== null) fields.push([16, hours]);
    fields.push([13, new Date()]);
    contiguousRows_(selection.selected).forEach(group => fields.forEach(([column, value]) => {
      selection.sheet.getRange(group[0].rowNumber, column, group.length, 1).setValues(group.map(() => [value]));
    }));
    return { success: true, taskIds: selection.ids, updated: selection.ids.length };
  } finally {
    lock.releaseLock();
  }
}

// Parses HTML date input as a local calendar date.
function parseLocalDate(value) {
  if (!value) return null;

  const match = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})$/
  );

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  const date = new Date(year, month - 1, day);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}

function setupTimeline() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const db = ss.getSheetByName(CONFIG.SHEET_NAME);

  if (!db) {
    throw new Error('Task_Master sheet not found.');
  }

  let sheet = ss.getSheetByName('Timeline');

  if (!sheet) {
    sheet = ss.insertSheet('Timeline');
  }

  // Clear previous generated layout.
  sheet.clear();
  sheet.setConditionalFormatRules([]);

  // Title and legend.
  sheet.getRange('A1').setValue('VIDEO PRODUCTION TIMELINE');
  sheet.getRange('A1').setFontSize(16)
    .setFontWeight('bold');

  sheet.getRange('A2:E2').setValues([[
    'Task ID',
    'Task Name',
    'Status',
    'Start Date',
    'End Date'
  ]]);

  sheet.getRange('A2:E2')
    .setBackground('#1F2937')
    .setFontColor('#FFFFFF')
    .setFontWeight('bold');

  // Pull live task information from Task_Master.
  const formulas = [
    '=IFERROR(FILTER(Task_Master!A2:A,Task_Master!A2:A<>""),"")',
    '=IFERROR(FILTER(Task_Master!B2:B,Task_Master!A2:A<>""),"")',
    '=IFERROR(FILTER(Task_Master!E2:E,Task_Master!A2:A<>""),"")',
    '=IFERROR(FILTER(Task_Master!F2:F,Task_Master!A2:A<>""),"")',
    '=IFERROR(FILTER(Task_Master!G2:G,Task_Master!A2:A<>""),"")'
  ];

  formulas.forEach((formula, index) => {
    sheet.getRange(3, index + 1).setFormula(formula);
  });

  // Generate a dynamic daily timeline.
  // If no tasks exist, show the next 90 days.
  sheet.getRange('F2').setFormula(
    '=IFERROR(SEQUENCE(1,MAX(1,MAX(FILTER(Task_Master!G2:G,Task_Master!G2:G<>""))-MIN(FILTER(Task_Master!F2:F,Task_Master!F2:F<>""))+1),MIN(FILTER(Task_Master!F2:F,Task_Master!F2:F<>"")),1),SEQUENCE(1,90,TODAY(),1))'
  );

  sheet.getRange('F2:ZZ2')
    .setNumberFormat('d-mmm')
    .setHorizontalAlignment('center')
    .setFontWeight('bold');

  // Task information formatting.
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(5);

  sheet.setColumnWidth(1, 100);
  sheet.setColumnWidth(2, 230);
  sheet.setColumnWidth(3, 110);
  sheet.setColumnWidth(4, 110);
  sheet.setColumnWidth(5, 110);

  sheet.setColumnWidths(6, 180, 30);

  sheet.getRange('D3:E200')
    .setNumberFormat('mmm d, yyyy');

  sheet.getRange('A3:ZZ200')
    .setVerticalAlignment('middle');

  sheet.setRowHeight(2, 32);

  // Conditional formatting rules.
  const timelineRange = sheet.getRange('F3:ZZ200');
  const rules = [];

  const statusColors = [
    { status: 'Done', color: '#16A34A' },
    { status: 'To Do', color: '#9CA3AF' },
    { status: 'In Progress', color: '#3B82F6' },
    { status: 'Blocked', color: '#DC2626' }
  ];

  statusColors.forEach(item => {
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenFormulaSatisfied(
          `=AND(F$2>=$D3,F$2<=$E3,$C3="${item.status}",$A3<>"")`
        )
        .setBackground(item.color)
        .setFontColor('#FFFFFF')
        .setRanges([timelineRange])
        .build()
    );
  });

  // Shade weekends outside task bars.
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied(
        '=AND(F$2<>"",WEEKDAY(F$2,2)>5,NOT(AND(F$2>=$D3,F$2<=$E3)))'
      )
      .setBackground('#F1F3F4')
      .setRanges([timelineRange])
      .build()
  );

  // Highlight today's date in the date header.
  rules.push(
    SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=F$2=TODAY()')
      .setBackground('#FDE68A')
      .setFontColor('#92400E')
      .setRanges([sheet.getRange('F2:ZZ2')])
      .build()
  );

  sheet.setConditionalFormatRules(rules);

  ss.setActiveSheet(sheet);

  SpreadsheetApp.getUi().alert(
    'Gantt Timeline created successfully!'
  );
}
function formatTimeline() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Timeline');

  if (!sheet) throw new Error('Timeline sheet not found.');

  // ==========================================
  // CUSTOMIZATION
  // ==========================================
  const C = {
    columns: {
      id: 1,
      name: 2,
      status: 3,
      start: 4,
      end: 5,
      timelineStart: 6,
      timelineEnd: 180
    },

    widths: {
      id: 100,
      name: 250,
      status: 115,
      dates: 115,
      timeline: 34
    },

    rows: {
      title: 1,
      header: 2,
      data: 3,
      titleHeight: 42,
      headerHeight: 38,
      dataHeight: 34
    },

    font: 'Arial',

    colors: {
      navy: '#172B4D',
      navyLight: '#253858',
      white: '#FFFFFF',
      background: '#F8FAFC',
      rowEven: '#FFFFFF',
      rowOdd: '#F1F5F9',
      border: '#E2E8F0',
      text: '#334155',
      muted: '#64748B',
      today: '#FEF3C7',
      weekend: '#F1F5F9'
    },

    status: {
      'To Do': '#94A3B8',
      'In Progress': '#3B82F6',
      'Blocked': '#EF4444',
      'Done': '#22C55E'
    },

    dateFormat: 'dd mmm yyyy',
    timelineFormat: 'd'
  };

  // ==========================================
  // DIMENSIONS
  // ==========================================
  const lastRow = Math.max(sheet.getLastRow(), C.rows.data);
  const lastCol = C.columns.timelineEnd;
  const dataRows = lastRow - C.rows.data + 1;
  const timelineCols =
    C.columns.timelineEnd - C.columns.timelineStart + 1;

  // ==========================================
  // RESET BASE FORMATTING
  // ==========================================
  sheet.getRange(1, 1, lastRow, lastCol)
    .setFontFamily(C.font)
    .setFontSize(10)
    .setFontColor(C.colors.text)
    .setVerticalAlignment('middle')
    .setBackground(C.colors.background);

  // ==========================================
  // TITLE
  // ==========================================
  sheet.getRange(1, 1, 1, lastCol)
    .setBackground(C.colors.navy)
    .setFontColor(C.colors.white)
    .setFontSize(16)
    .setFontWeight('bold')
    .setVerticalAlignment('middle');

  sheet.getRange('A1')
    .setHorizontalAlignment('left')
    .setIndent(1);

  sheet.setRowHeight(C.rows.title, C.rows.titleHeight);

  // ==========================================
  // COLUMN HEADERS
  // ==========================================
  sheet.getRange(2, 1, 1, lastCol)
    .setBackground(C.colors.navyLight)
    .setFontColor(C.colors.white)
    .setFontWeight('bold')
    .setFontSize(9)
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  sheet.setRowHeight(C.rows.header, C.rows.headerHeight);

  // ==========================================
  // TASK ROWS
  // ==========================================
  if (dataRows > 0) {
    const dataRange = sheet.getRange(
      C.rows.data, 1, dataRows, lastCol
    );

    dataRange
      .setFontSize(10)
      .setVerticalAlignment('middle');

    // Alternating row colors
    for (let i = 0; i < dataRows; i++) {
      sheet.getRange(C.rows.data + i, 1, 1, lastCol)
        .setBackground(
          i % 2 === 0 ? C.colors.rowEven : C.colors.rowOdd
        );
    }

    // Task ID
    sheet.getRange(C.rows.data, 1, dataRows, 1)
      .setFontColor(C.colors.muted)
      .setHorizontalAlignment('center');

    // Task name
    sheet.getRange(C.rows.data, 2, dataRows, 1)
      .setFontWeight('bold')
      .setHorizontalAlignment('left');

    // Status
    sheet.getRange(C.rows.data, 3, dataRows, 1)
      .setHorizontalAlignment('center')
      .setFontWeight('bold');

    // Dates
    sheet.getRange(C.rows.data, 4, dataRows, 2)
      .setNumberFormat(C.dateFormat)
      .setHorizontalAlignment('center');

    // Timeline area
    sheet.getRange(
      C.rows.data,
      C.columns.timelineStart,
      dataRows,
      timelineCols
    ).setHorizontalAlignment('center');

    sheet.setRowHeights(
      C.rows.data,
      dataRows,
      C.rows.dataHeight
    );
  }

  // ==========================================
  // COLUMN WIDTHS
  // ==========================================
  sheet.setColumnWidth(C.columns.id, C.widths.id);
  sheet.setColumnWidth(C.columns.name, C.widths.name);
  sheet.setColumnWidth(C.columns.status, C.widths.status);
  sheet.setColumnWidth(C.columns.start, C.widths.dates);
  sheet.setColumnWidth(C.columns.end, C.widths.dates);

  sheet.setColumnWidths(
    C.columns.timelineStart,
    timelineCols,
    C.widths.timeline
  );

  // ==========================================
  // TIMELINE DATE HEADERS
  // ==========================================
  sheet.getRange(
    2,
    C.columns.timelineStart,
    1,
    timelineCols
  )
    .setNumberFormat(C.timelineFormat)
    .setHorizontalAlignment('center');

  // ==========================================
  // SUBTLE BORDERS
  // ==========================================
  sheet.getRange(2, 1, dataRows + 1, lastCol)
    .setBorder(
      false, false, true, false, false, false,
      C.colors.border,
      SpreadsheetApp.BorderStyle.SOLID
    );

  // ==========================================
  // FREEZE PANES
  // ==========================================
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(5);

  // ==========================================
  // HIDE GRIDLINES
  // ==========================================
  sheet.setHiddenGridlines(true);

  // ==========================================
  // STATUS TEXT COLORS
  // ==========================================
  const statusRange = sheet.getRange(
    C.rows.data, C.columns.status, dataRows, 1
  );

  const statusRules = Object.entries(C.status).map(
    ([status, color]) =>
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo(status)
        .setBackground(color)
        .setFontColor(C.colors.white)
        .setBold(true)
        .setRanges([statusRange])
        .build()
  );

  // Preserve existing Gantt rules, replacing only
  // rules that target the status column.
  const existingRules = sheet.getConditionalFormatRules();

  const filteredRules = existingRules.filter(rule =>
    !rule.getRanges().some(range =>
      range.getColumn() <= C.columns.status &&
      range.getLastColumn() >= C.columns.status &&
      range.getRow() >= C.rows.data
    )
  );

  sheet.setConditionalFormatRules([
    ...filteredRules,
    ...statusRules
  ]);

  SpreadsheetApp.flush();

  ss.toast('Clean timeline formatting applied!', 'Task Manager', 3);
}

/**
 * Web app entry point.
 * Keeps your existing spreadsheet and task functions intact.
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('App')
    .setTitle('Video Production Manager')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
// Deletes a task without changing its former parent's schedule.
function deleteTask(taskId) {
  const result = deleteTasks([taskId]);
  result.message = taskId + ' deleted successfully.';
  return result;
}

function deleteTasks(taskIds, parentTaskId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const selection = readTaskSelection_(taskIds);
    if (parentTaskId !== undefined) assertSubtaskSelection_(selection, parentTaskId);
    const selectedIds = new Set(selection.ids);
    selection.rows.forEach(values => {
      const parentId = String(values[13] || '').trim();
      if (parentId && selectedIds.has(parentId) && !selectedIds.has(String(values[0] || '').trim())) {
        throw new Error('Select every subtask of ' + parentId + ' before deleting the parent.');
      }
    });
    contiguousRows_(selection.selected).reverse().forEach(group => {
      selection.sheet.deleteRows(group[0].rowNumber, group.length);
    });
    SpreadsheetApp.flush();
    return {
      success: true,
      taskIds: selection.ids,
      deleted: selection.ids.length,
      message: selection.ids.length + ' tasks deleted.'
    };
  } finally {
    lock.releaseLock();
  }
}
// Changes a task's parent without recreating the task.
function setTaskParent(taskId, newParentTaskId) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    taskId = String(taskId || '').trim();
    newParentTaskId = String(newParentTaskId || '').trim();

    if (!taskId) {
      throw new Error('Task ID is required.');
    }

    if (taskId === newParentTaskId) {
      throw new Error('A task cannot be its own parent.');
    }

    const sheet = SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(CONFIG.SHEET_NAME);

    if (!sheet) {
      throw new Error('Task_Master sheet not found.');
    }

    const taskRow = findTaskRow(sheet, taskId);

    const lastRow = sheet.getLastRow();

    const rows = lastRow >= 2
      ? sheet.getRange(2, 1, lastRow - 1, 14).getValues()
      : [];

    // Find the existing children of this task.
    const children = rows
      .map((row, index) => ({
        rowNumber: index + 2,
        taskId: String(row[0] || '').trim(),
        parentTaskId: String(row[13] || '').trim()
      }))
      .filter(row => row.parentTaskId === taskId);

    // Validate destination parent.
    if (newParentTaskId) {
      const parentRow = findTaskRow(sheet, newParentTaskId);

      const destinationParentId = String(
        sheet.getRange(parentRow, 14).getValue() || ''
      ).trim();

      if (destinationParentId) {
        throw new Error(
          'Nested subtasks are not supported. Select a top-level task.'
        );
      }
    }

    const now = new Date();

    // Update or clear the selected task's parent.
    const parentCell = sheet.getRange(taskRow, 14);

    if (newParentTaskId) {
      parentCell.setValue(newParentTaskId);
    } else {
      parentCell.clearContent();
    }

    // If converting a parent into a subtask,
    // move its existing children to the destination parent.
    if (newParentTaskId && children.length > 0) {
      children.forEach(child => {
        sheet.getRange(child.rowNumber, 14)
          .setValue(newParentTaskId);

        sheet.getRange(child.rowNumber, 13)
          .setValue(now);
      });
    }

    // Update selected task timestamp.
    sheet.getRange(taskRow, 13).setValue(now);

    SpreadsheetApp.flush();

    return {
      success: true,
      taskId: taskId,
      parentTaskId: newParentTaskId,
      childrenMoved: newParentTaskId ? children.length : 0,
      message: newParentTaskId
        ? taskId + ' transferred successfully.'
        : taskId + ' is now standalone.'
    };

  } finally {
    lock.releaseLock();
  }
}

const INVOICE_CONFIG = {
  SHEET: 'Invoice_Master',
  SETTINGS_SHEET: 'Invoice_Settings',
  HEADERS: ['Invoice ID', 'Invoice Number', 'Client', 'Period Start', 'Period End', 'Currency', 'Status', 'Total Minor', 'Invoice JSON', 'Updated At', 'Revision'],
  CURRENCIES: ['USD', 'PHP', 'EUR', 'GBP', 'CAD', 'AUD']
};

function invoiceDateKey_(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function invoiceText_(value, label, maximum) {
  const text = String(value == null ? '' : value).trim();
  if (text.length > maximum) throw new Error(label + ' is too long.');
  return text;
}

function invoiceDecimal_(value, label, maximum) {
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error(label + ' must be a number.');
  const number = Number(value);
  const units = Math.round(number * 100);
  if (!Number.isFinite(number) || number < 0 || number > maximum || Math.abs(number * 100 - units) > 0.000001) {
    throw new Error(label + ' must be a nonnegative number with at most two decimal places.');
  }
  return units;
}

function normalizeInvoice_(input) {
  if (!input || typeof input !== 'object') throw new Error('Invoice details are required.');
  const id = String(input.id || '');
  if (!/^INV-[a-zA-Z0-9-]{8,80}$/.test(id)) throw new Error('Invalid invoice ID.');
  const client = invoiceText_(input.client, 'Client', 100);
  if (!client) throw new Error('Choose a client for this invoice.');
  const currency = String(input.currency || '');
  if (!INVOICE_CONFIG.CURRENCIES.includes(currency)) throw new Error('Choose a supported invoice currency.');
  const start = parseLocalDate(input.periodStart);
  const end = parseLocalDate(input.periodEnd);
  if (!start || !end) throw new Error('Choose valid billing dates.');
  if (end < start) throw new Error('Billing end date cannot precede start date.');
  const periodMode = input.periodMode || 'fortnight';
  const videoDateBasis = input.videoDateBasis || 'planned';
  const videoScope = input.videoScope || 'leaf';
  if (!['fortnight', 'custom'].includes(periodMode) || !['planned', 'completed'].includes(videoDateBasis) || !['leaf', 'topLevel', 'all'].includes(videoScope)) {
    throw new Error('Choose valid invoice timeline and video filters.');
  }
  const expectedEnd = new Date(start);
  expectedEnd.setDate(expectedEnd.getDate() + 13);
  if (periodMode === 'fortnight' && invoiceDateKey_(expectedEnd) !== input.periodEnd) throw new Error('A two-week billing period must contain exactly 14 calendar days.');
  const status = input.status || 'Draft';
  if (!['Draft', 'Issued', 'Paid', 'Void'].includes(status)) throw new Error('Invalid invoice status.');
  const issueDate = invoiceText_(input.issueDate, 'Issue date', 10);
  const dueDate = invoiceText_(input.dueDate, 'Due date', 10);
  if (!parseLocalDate(issueDate) || !parseLocalDate(dueDate)) throw new Error('Choose valid issue and due dates.');
  const senderName = invoiceText_(input.senderName, 'Your name or business', 200);
  if (!Array.isArray(input.lines) || input.lines.length > 100) throw new Error('An invoice can contain up to 100 lines.');
  const seen = new Set();
  const lines = input.lines.map((line, index) => {
    if (!line || typeof line !== 'object') throw new Error('Invalid invoice line.');
    const taskId = invoiceText_(line.taskId, 'Task ID', 100);
    if (taskId && seen.has(taskId)) throw new Error('The same video appears more than once in this invoice.');
    if (taskId) seen.add(taskId);
    const description = invoiceText_(line.description, 'Line description', 200);
    const hoursUnits = invoiceDecimal_(line.hours, 'Hours on line ' + (index + 1), 10000);
    const rateMinor = invoiceDecimal_(line.rate, 'Rate on line ' + (index + 1), 1000000);
    if (!description) throw new Error('Enter a description for every invoice line.');
    if (status !== 'Draft' && (!hoursUnits || !rateMinor)) throw new Error('Enter positive hours and rates before issuing an invoice.');
    return { taskId, description, hours: hoursUnits / 100, rate: rateMinor / 100, amountMinor: Math.round(hoursUnits * rateMinor / 100) };
  });
  if (status !== 'Draft' && (!senderName || !lines.length)) throw new Error('Add your name or business and at least one line before issuing.');
  const invoice = {
    id, number: invoiceText_(input.number, 'Invoice number', 40), client, currency, status,
    periodStart: input.periodStart, periodEnd: input.periodEnd, issueDate, dueDate,
    periodMode, videoDateBasis, videoScope, includeUnassigned: input.includeUnassigned === true,
    senderName, senderDetails: invoiceText_(input.senderDetails, 'Sender details', 1000),
    clientDetails: invoiceText_(input.clientDetails, 'Client details', 1000),
    notes: invoiceText_(input.notes, 'Notes', 1500),
    defaultRate: invoiceDecimal_(input.defaultRate || 0, 'Default rate', 1000000) / 100,
    lines, totalMinor: lines.reduce((total, line) => total + line.amountMinor, 0),
    revision: Number(input.revision || 0)
  };
  if (!Number.isSafeInteger(invoice.revision) || invoice.revision < 0) throw new Error('Invalid invoice revision.');
  if (JSON.stringify(invoice).length > 45000) throw new Error('This invoice is too large to save.');
  return invoice;
}

function invoiceSheet_(create) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(INVOICE_CONFIG.SHEET);
  if (!sheet && create) sheet = ss.insertSheet(INVOICE_CONFIG.SHEET);
  if (!sheet) return null;
  if (!sheet.getLastRow()) {
    if (create) sheet.getRange(1, 1, 1, INVOICE_CONFIG.HEADERS.length).setValues([INVOICE_CONFIG.HEADERS]);
    return sheet;
  }
  const headers = sheet.getRange(1, 1, 1, INVOICE_CONFIG.HEADERS.length).getValues()[0];
  if (headers.join('|') !== INVOICE_CONFIG.HEADERS.join('|')) throw new Error('Invoice_Master headers do not match. No invoice data was changed.');
  return sheet;
}

function invoiceRows_() {
  const sheet = invoiceSheet_(false);
  return { sheet, rows: !sheet || sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, INVOICE_CONFIG.HEADERS.length).getValues() };
}

function readInvoiceRecord_(row) {
  try {
    const stored = JSON.parse(String(row[8]));
    const invoice = normalizeInvoice_(stored);
    if (invoice.id !== row[0] || invoice.status !== row[6]) throw new Error('Invoice identity or status does not match its stored row.');
    return { ...invoice, number: String(row[1]), revision: Number(row[10]), updatedAt: stored.updatedAt || '', paidAt: stored.paidAt || '', createdAt: stored.createdAt || '' };
  } catch (error) {
    throw new Error('Cannot read invoice ' + row[0] + ': ' + error.message);
  }
}

function normalizeBillingSettings_(input) {
  if (!input || !parseLocalDate(input.anchor)) throw new Error('Choose a valid billing-cycle start date.');
  if (!INVOICE_CONFIG.CURRENCIES.includes(input.currency)) throw new Error('Choose a supported currency.');
  return {
    anchor: input.anchor, currency: input.currency,
    defaultRate: invoiceDecimal_(input.defaultRate || 0, 'Default hourly rate', 1000000) / 100,
    senderName: invoiceText_(input.senderName, 'Your name or business', 200),
    senderDetails: invoiceText_(input.senderDetails, 'Sender details', 1000),
    paymentNotes: invoiceText_(input.paymentNotes, 'Payment notes', 1500)
  };
}

function billingSettings_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const today = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  const sheet = ss.getSheetByName(INVOICE_CONFIG.SETTINGS_SHEET);
  const defaults = { settings: { anchor: today, currency: 'USD', defaultRate: 0, senderName: '', senderDetails: '', paymentNotes: '' }, revision: 0, today };
  if (!sheet || !sheet.getLastRow()) return defaults;
  if (sheet.getRange(1, 1, 1, 2).getValues()[0].join('|') !== 'Settings JSON|Revision') throw new Error('Invoice_Settings headers do not match.');
  if (sheet.getLastRow() < 2) return defaults;
  const row = sheet.getRange(2, 1, 1, 2).getValues()[0];
  return { settings: normalizeBillingSettings_(JSON.parse(String(row[0]))), revision: Number(row[1]), today };
}

function getInvoiceWorkspace() {
  const records = invoiceRows_().rows.filter(row => row[0]).map(readInvoiceRecord_);
  const settings = billingSettings_();
  return {
    success: true, settings: settings.settings, settingsRevision: settings.revision, today: settings.today,
    invoices: records.map(invoice => ({
      id: invoice.id, number: invoice.number, client: invoice.client, periodStart: invoice.periodStart, periodEnd: invoice.periodEnd,
      currency: invoice.currency, status: invoice.status, totalMinor: invoice.totalMinor, defaultRate: invoice.defaultRate,
      revision: invoice.revision, updatedAt: invoice.updatedAt, lineCount: invoice.lines.length,
      totalHours: invoice.lines.reduce((total, line) => total + Math.round(line.hours * 100), 0) / 100
    })).sort((first, second) => second.updatedAt.localeCompare(first.updatedAt))
  };
}

function getInvoice(invoiceId) {
  const row = invoiceRows_().rows.find(values => values[0] === invoiceId);
  if (!row) throw new Error('Invoice not found. Refresh invoice history.');
  return { success: true, invoice: readInvoiceRecord_(row) };
}

function writeInvoice_(sheet, row, invoice) {
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), row - sheet.getMaxRows());
  sheet.getRange(row, 1, 1, INVOICE_CONFIG.HEADERS.length).setValues([[
    invoice.id, invoice.number, literalText_(invoice.client), invoice.periodStart, invoice.periodEnd,
    invoice.currency, invoice.status, invoice.totalMinor, JSON.stringify(invoice), new Date(), invoice.revision
  ]]);
}

function saveInvoice(input) {
  const invoice = normalizeInvoice_(input);
  if (!['Draft', 'Issued'].includes(invoice.status)) throw new Error('Save a draft or issue it before recording a payment.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const store = invoiceRows_();
    const index = store.rows.findIndex(row => row[0] === invoice.id);
    const current = index < 0 ? null : readInvoiceRecord_(store.rows[index]);
    if (invoice.revision !== (current ? current.revision : 0)) throw new Error('This invoice changed in another session. Reopen the saved invoice before updating it.');
    if (current && current.status !== 'Draft') throw new Error('Issued, paid and void invoices cannot be edited.');
    if (invoice.status === 'Issued') {
      const duplicate = store.rows.filter(row => row[0] && row[0] !== invoice.id).map(readInvoiceRecord_).find(other =>
        ['Issued', 'Paid'].includes(other.status) && other.client.toLowerCase() === invoice.client.toLowerCase() &&
        other.periodStart === invoice.periodStart && other.periodEnd === invoice.periodEnd);
      if (duplicate) throw new Error('An invoice already exists for this client and period: ' + duplicate.number + '.');
    }
    let maximum = 0;
    store.rows.forEach(row => {
      const match = String(row[1] || '').match(/^INV-(\d+)$/);
      if (match) maximum = Math.max(maximum, Number(match[1]));
    });
    const now = new Date().toISOString();
    invoice.number = current ? current.number : 'INV-' + String(maximum + 1).padStart(5, '0');
    invoice.revision = (current ? current.revision : 0) + 1;
    invoice.createdAt = current ? current.createdAt : now;
    invoice.updatedAt = now;
    const sheet = store.sheet || invoiceSheet_(true);
    writeInvoice_(sheet, index < 0 ? sheet.getLastRow() + 1 : index + 2, invoice);
    return { success: true, invoice, message: invoice.number + ' saved as ' + invoice.status + '.' };
  } finally {
    lock.releaseLock();
  }
}

function changeInvoiceStatus(invoiceId, revision, status) {
  if (!['Paid', 'Void'].includes(status)) throw new Error('Choose Paid or Void.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const store = invoiceRows_();
    const index = store.rows.findIndex(row => row[0] === invoiceId);
    if (index < 0) throw new Error('Invoice not found.');
    const invoice = readInvoiceRecord_(store.rows[index]);
    if (invoice.revision !== revision) throw new Error('This invoice changed. Reopen it before updating its status.');
    if (invoice.status !== 'Issued') throw new Error('Only issued invoices can be marked Paid or Void.');
    invoice.status = status;
    invoice.revision++;
    invoice.updatedAt = new Date().toISOString();
    if (status === 'Paid') invoice.paidAt = invoice.updatedAt;
    writeInvoice_(store.sheet, index + 2, invoice);
    return { success: true, invoice, message: invoice.number + ' marked ' + status + '.' };
  } finally {
    lock.releaseLock();
  }
}

function deleteInvoiceDraft(invoiceId, revision) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const store = invoiceRows_();
    const index = store.rows.findIndex(row => row[0] === invoiceId);
    if (index < 0) throw new Error('Invoice not found.');
    const invoice = readInvoiceRecord_(store.rows[index]);
    if (invoice.revision !== revision || invoice.status !== 'Draft') throw new Error('Only an unchanged draft can be deleted.');
    store.sheet.deleteRows(index + 2, 1);
    return { success: true, message: invoice.number + ' draft deleted.' };
  } finally {
    lock.releaseLock();
  }
}

function saveInvoiceSettings(input, revision) {
  const settings = normalizeBillingSettings_(input);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const current = billingSettings_();
    if (current.revision !== revision) throw new Error('Billing settings changed. Refresh before saving.');
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(INVOICE_CONFIG.SETTINGS_SHEET);
    if (!sheet) sheet = ss.insertSheet(INVOICE_CONFIG.SETTINGS_SHEET);
    if (!sheet.getLastRow()) sheet.getRange(1, 1, 1, 2).setValues([['Settings JSON', 'Revision']]);
    sheet.getRange(2, 1, 1, 2).setValues([[JSON.stringify(settings), revision + 1]]);
    return { success: true, settings, revision: revision + 1, message: 'Billing defaults saved.' };
  } finally {
    lock.releaseLock();
  }
}
