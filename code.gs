
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
    'Scheduling',
    'Revision'
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
    if (!parentHeader && sheet.getLastRow() > 1) {
      const parentRange = sheet.getRange(2, 14, sheet.getLastRow() - 1, 1);
      const hasValues = parentRange.getValues().some(row => row[0] !== '');
      const hasFormulas = parentRange.getFormulas().some(row => row[0] !== '');
      if (hasValues || hasFormulas) throw new Error('Column N contains data without a Parent Task ID header. Inspect Task_Master before upgrading.');
    }
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
      if (category !== values[2]) changes.push({ rowNumber: index + 2, category, updatedAt: values[12] });
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
      sheet.getRange(group[0].rowNumber, 13, group.length, 1).setValues(group.map(record => [nextTaskUpdatedAt_(record.updatedAt, now)]));
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
      spreadsheetTimeZone: timezone,
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
      spreadsheetTimeZone: timezone,
      total: 0,
      tasks: []
    };
  }

  // Calculate child counts for every parent.
  const childStats = Object.create(null);
  const ownHours = new Map(taskRows.map(row => [String(row[0]), withHours ? normalizeTaskHours_(row[15], row[0]) : 0]));
  const timeEntryHours = timeEntryTotalsByTask_(taskRows, timezone);
  const totalTaskHours = new Map(taskRows.map(row => {
    const taskId = String(row[0]);
    return [taskId, ownHours.get(taskId) + (timeEntryHours.get(taskId) || 0)];
  }));

  taskRows.forEach(row => {
    const parentId = String(row[13] || '').trim();
    const taskId = String(row[0]);
    const manualUnits = Math.round(ownHours.get(taskId) * 100);
    const entryUnits = Math.round((timeEntryHours.get(taskId) || 0) * 100);

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
    childStats[parentId].hourUnits += Math.round(totalTaskHours.get(String(row[0])) * 100);

    childStats[parentId].completedHourUnits += entryUnits;
    if (String(row[4]) === 'Done') {
      childStats[parentId].completed++;
      childStats[parentId].completedHourUnits += manualUnits;
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
    const hasParent = Boolean(String(row[13] || '').trim());
    const ownCompletedHours = (String(row[4]) === 'Done' ? ownHours.get(taskId) : 0) + (timeEntryHours.get(taskId) || 0);

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
      updatedAt: taskVersion_(row[12]),

      parentTaskId: String(row[13] || ''),
      clients: withClients ? readClients_(row[14], taskId) : [],
      hours: String(row[13] || '').trim() ? ownHours.get(taskId) : 0,
      manualHours: String(row[13] || '').trim() ? ownHours.get(taskId) : 0,
      timeEntryHours: timeEntryHours.get(taskId) || 0,
      hasTimeEntries: timeEntryHours.has(taskId),
      subtaskHours: stats.hourUnits / 100,
      totalHours: stats.total ? stats.hourUnits / 100 : String(row[13] || '').trim() ? totalTaskHours.get(taskId) : 0,
      completedHours: stats.total ? stats.completedHourUnits / 100 : hasParent ? ownCompletedHours : 0,
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
    spreadsheetTimeZone: timezone,
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
    const startDate = parseTaskDate_(formData.startDate);
    const endDate = parseTaskDate_(formData.endDate);
    const description = String(formData.description || '').trim();
    const clients = formData.clients === undefined ? inheritedClients : normalizeClients_(formData.clients);
    const hours = normalizeTaskHours_(formData.hours);
    if (formData.hours !== undefined && !hasHoursColumn_(sheet)) throw new Error('Run Upgrade Categories, Clients and Hours from the spreadsheet menu first.');
    if (!parentTaskId && hours > 0) throw new Error('Only subtasks can record hours. Parent totals are calculated from subtasks.');

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

    let records = [{ taskName, category, priority, startDate, endDate, description, clients, parentTaskId, hours }];
    if (formData.recurrence) {
      if (parentTaskId) throw new Error('Recurring tasks must be standalone tasks.');
      const startKey = Utilities.formatDate(startDate, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
      const endKey = Utilities.formatDate(endDate, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
      const durationDays = Math.round((Date.parse(endKey + 'T00:00:00Z') - Date.parse(startKey + 'T00:00:00Z')) / 86400000);
      records = recurringTaskStarts_(startKey, formData.recurrence).map(date => ({
        taskName, category, priority, startDate: parseTaskDate_(date),
        endDate: parseTaskDate_(shiftTaskDateKey_(date, durationDays)), description, clients, parentTaskId: '', hours: 0
      }));
    }
    const taskIds = appendTasks_(sheet, records);

    return {
      success: true,
      taskId: taskIds[0],
      taskIds,
      created: taskIds.length,
      message: taskIds.length === 1 ? taskIds[0] + ' created successfully!' : taskIds.length + ' recurring tasks created.'
    };

  } finally {
    lock.releaseLock();
  }
}

function shiftTaskDateKey_(value, days) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function recurringTaskStarts_(startKey, recurrence) {
  const frequency = String(recurrence.frequency || '');
  if (!['Weekly', 'Biweekly', 'Monthly'].includes(frequency)) throw new Error('Choose a weekly, biweekly, or monthly task frequency.');
  const throughDate = parseTaskDate_(recurrence.throughDate);
  if (!throughDate) throw new Error('Choose a valid recurring-task through date.');
  const timezone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const throughKey = Utilities.formatDate(throughDate, timezone, 'yyyy-MM-dd');
  if (throughKey <= startKey) throw new Error('The recurrence through date must be after the first task date.');
  const anchorDay = Number(startKey.slice(8, 10));
  const starts = [];
  let current = startKey;
  while (current <= throughKey) {
    starts.push(current);
    if (starts.length > 100) throw new Error('A recurring task can create at most 100 occurrences. Choose an earlier through date.');
    if (frequency === 'Weekly' || frequency === 'Biweekly') {
      current = shiftTaskDateKey_(current, frequency === 'Weekly' ? 7 : 14);
    } else {
      const [year, month] = current.split('-').map(Number);
      const nextMonth = new Date(Date.UTC(year, month, 1));
      const lastDay = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 0)).getUTCDate();
      current = `${nextMonth.getUTCFullYear()}-${String(nextMonth.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(anchorDay, lastDay)).padStart(2, '0')}`;
    }
  }
  return starts;
}

// Finds a task by its ID rather than relying on a row number.
function findTaskRow(sheet, taskId) {
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    throw new Error('No tasks found.');
  }

  const ids = sheet.getRange(2, 1, lastRow - 1, 1)
    .getDisplayValues();

  const matches = [];
  ids.forEach((row, index) => {
    if (row[0] === taskId) matches.push(index);
  });
  if (!matches.length) {
    throw new Error('Task ID not found: ' + taskId);
  }
  if (matches.length > 1) throw new Error('Duplicate task ID: ' + taskId);

  return matches[0] + 2;
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
    const startDate = parseTaskDate_(formData.startDate);
    const endDate = parseTaskDate_(formData.endDate);
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
    const currentUpdatedAt = sheet.getRange(row, 13).getValue();
    assertTaskVersion_(formData.expectedUpdatedAt, currentUpdatedAt);
    const now = new Date();

    const hours = formData.hours === undefined ? null : normalizeTaskHours_(formData.hours, taskId);
    if (hours !== null) assertEditableTaskHours_(sheet, taskId, row);
    const clients = formData.clients === undefined ? null : normalizeClients_(formData.clients);
    if (clients !== null && !hasClientsColumn_(sheet)) throw new Error('Run Upgrade Categories and Clients from the spreadsheet menu first.');
    let statusValues = null;
    if (formData.status !== undefined) {
      validateStatus_(formData.status);
      statusValues = nextStatusValues_(
        sheet.getRange(row, 1, 1, 14).getValues()[0],
        formData.status,
        now
      );
    }

    sheet.getRange(row, 2, 1, 3).setValues([[
      taskName, category, priority
    ]]);

    sheet.getRange(row, 6, 1, 2).setValues([[
      startDate, endDate
    ]]);

    sheet.getRange(row, 9).setValue(description);
    sheet.getRange(row, 13).setValue(statusValues ? statusValues.updatedAt : nextTaskUpdatedAt_(currentUpdatedAt, now));
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
function assertEditableTaskHours_(sheet, taskId, rowNumber) {
  if (!hasHoursColumn_(sheet)) throw new Error('Run Upgrade Categories, Clients and Hours from the spreadsheet menu first.');
  const parents = sheet.getLastRow() > 1 ? sheet.getRange(2, 14, sheet.getLastRow() - 1, 1).getValues() : [];
  if (parents.some(values => String(values[0] || '').trim() === taskId)) {
    throw new Error('Parent hours are calculated from subtasks. Update the subtask hours instead.');
  }
  const taskParentId = String(sheet.getRange(rowNumber || findTaskRow(sheet, taskId), 14).getValue() || '').trim();
  if (!taskParentId) throw new Error('Only subtasks can record hours. Parent totals are calculated from subtasks.');
  if (timeEntryTaskIds_().has(taskId)) throw new Error('This task has dated time entries. Edit the entries instead of manual Hours.');
}

function updateTaskHours(taskId, value, expectedUpdatedAt) {
  const hours = normalizeTaskHours_(value, taskId);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const selection = readTaskSelection_([taskId]);
    assertEditableTaskHours_(selection.sheet, selection.ids[0], selection.selected[0].rowNumber);
    const currentUpdatedAt = selection.selected[0].values[12];
    assertTaskVersion_(expectedUpdatedAt, currentUpdatedAt);
    const row = selection.selected[0].rowNumber;
    selection.sheet.getRange(row, 16).setValue(hours);
    selection.sheet.getRange(row, 13).setValue(nextTaskUpdatedAt_(currentUpdatedAt));
    return { success: true, taskId: selection.ids[0], hours, message: selection.ids[0] + ' hours updated.' };
  } finally {
    lock.releaseLock();
  }
}

const TIME_ENTRY_CONFIG = {
  SHEET: 'Time_Entry_Master',
  HEADERS: ['Entry ID', 'Task ID', 'Work Date', 'Hours', 'Note', 'Created At']
};

function normalizeTimeEntryHours_(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24 || Math.abs(hours * 100 - Math.round(hours * 100)) > 0.000001) {
    throw new Error('Time entries must be greater than 0 and no more than 24 hours, with at most two decimal places.');
  }
  return Math.round(hours * 100) / 100;
}

function timeEntrySheet_(create) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(TIME_ENTRY_CONFIG.SHEET);
  if (!sheet && create) sheet = ss.insertSheet(TIME_ENTRY_CONFIG.SHEET);
  if (!sheet) return null;
  if (!sheet.getLastRow()) {
    if (create) sheet.getRange(1, 1, 1, TIME_ENTRY_CONFIG.HEADERS.length).setValues([TIME_ENTRY_CONFIG.HEADERS]);
    return create ? sheet : null;
  }
  const headers = sheet.getRange(1, 1, 1, TIME_ENTRY_CONFIG.HEADERS.length).getValues()[0];
  if (headers.join('|') !== TIME_ENTRY_CONFIG.HEADERS.join('|')) throw new Error('Time_Entry_Master headers do not match.');
  return sheet;
}

function deleteTimeEntriesForTasks_(taskIds) {
  const sheet = timeEntrySheet_(false);
  if (!sheet || sheet.getLastRow() < 2) return;
  const ids = new Set(taskIds.map(String));
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, TIME_ENTRY_CONFIG.HEADERS.length).getValues();
  const matches = rows.reduce((records, row, index) => {
    if (ids.has(String(row[1] || ''))) records.push({ rowNumber: index + 2 });
    return records;
  }, []);
  contiguousRows_(matches).reverse().forEach(group => sheet.deleteRows(group[0].rowNumber, group.length));
}

function readTimeEntry_(row, timezone) {
  const date = row[2] instanceof Date
    ? Utilities.formatDate(row[2], timezone, 'yyyy-MM-dd') : String(row[2] || '').trim();
  if (!String(row[0] || '').trim() || !String(row[1] || '').trim() || !parseLocalDate(date)) {
    throw new Error('Stored time entry is invalid.');
  }
  return {
    id: String(row[0]), taskId: String(row[1]), date,
    hours: normalizeTimeEntryHours_(row[3]), note: String(row[4] || ''),
    createdAt: String(row[5] || '')
  };
}

function timeEntryTotalsByTask_(taskRows, timezone) {
  const taskParents = new Map(taskRows.filter(row => row[0]).map(row => [String(row[0]), String(row[13] || '').trim()]));
  const parentIds = new Set([...taskParents.values()].filter(Boolean));
  const sheet = timeEntrySheet_(false);
  const totals = new Map();
  if (!sheet || sheet.getLastRow() < 2) return totals;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, TIME_ENTRY_CONFIG.HEADERS.length).getValues();
  rows.forEach(row => {
    const taskId = String(row[1] || '').trim();
    const parentTaskId = taskParents.get(taskId);
    if (!parentTaskId || parentIds.has(taskId)) return;
    const entry = readTimeEntry_(row, timezone);
    totals.set(taskId, Math.round(((totals.get(taskId) || 0) + entry.hours) * 100) / 100);
  });
  return totals;
}

function timeEntryTaskIds_() {
  const sheet = timeEntrySheet_(false);
  if (!sheet || sheet.getLastRow() < 2) return new Set();
  return new Set(sheet.getRange(2, 1, sheet.getLastRow() - 1, TIME_ENTRY_CONFIG.HEADERS.length).getValues()
    .map(row => String(row[1] || '').trim()).filter(Boolean));
}

function assertTimeEntrySubtask_(sheet, taskId) {
  const row = findTaskRow(sheet, taskId);
  const parentTaskId = String(sheet.getRange(row, 14).getValue() || '').trim();
  if (!parentTaskId) throw new Error('Time entries can only be logged on subtasks.');
  const taskRows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 14).getValues() : [];
  if (taskRows.some(values => String(values[13] || '').trim() === taskId)) {
    throw new Error('Time entries can only be logged on subtasks without their own subtasks.');
  }
}

function getTaskTimeEntries(taskId) {
  taskId = String(taskId || '').trim();
  if (!taskId) throw new Error('Task ID is required.');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const taskSheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!taskSheet) throw new Error('Task_Master sheet not found.');
  findTaskRow(taskSheet, taskId);
  const sheet = timeEntrySheet_(false);
  if (!sheet || sheet.getLastRow() < 2) return { success: true, entries: [] };
  const timezone = ss.getSpreadsheetTimeZone();
  const entries = sheet.getRange(2, 1, sheet.getLastRow() - 1, TIME_ENTRY_CONFIG.HEADERS.length).getValues()
    .filter(row => String(row[1] || '') === taskId)
    .map(row => readTimeEntry_(row, timezone))
    .sort((first, second) => second.date.localeCompare(first.date) || second.createdAt.localeCompare(first.createdAt));
  return { success: true, entries };
}

function getTimeEntrySummary(startValue, endValue, clientFilter) {
  const start = parseTaskDate_(startValue);
  const end = parseTaskDate_(endValue);
  if (!start || !end || end < start) throw new Error('Choose a valid time-entry date range.');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const taskSheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!taskSheet) throw new Error('Task_Master sheet not found.');
  const timezone = ss.getSpreadsheetTimeZone();
  const taskRows = taskSheet.getLastRow() > 1
    ? taskSheet.getRange(2, 1, taskSheet.getLastRow() - 1, taskReadWidth_(taskSheet)).getValues() : [];
  const parentIds = new Set(taskRows.map(row => String(row[13] || '').trim()).filter(Boolean));
  const tasks = new Map(taskRows.filter(row => row[0]).map(row => [String(row[0]), {
    name: String(row[1] || ''), parentTaskId: String(row[13] || '').trim(), hasChildren: parentIds.has(String(row[0])),
    clients: hasClientsColumn_(taskSheet) ? readClients_(row[14], row[0]) : []
  }]));
  const sheet = timeEntrySheet_(false);
  if (!sheet || sheet.getLastRow() < 2) return { success: true, entries: [], totalHours: 0 };
  const startKey = Utilities.formatDate(start, timezone, 'yyyy-MM-dd');
  const endKey = Utilities.formatDate(end, timezone, 'yyyy-MM-dd');
  const filter = String(clientFilter || '');
  const entries = sheet.getRange(2, 1, sheet.getLastRow() - 1, TIME_ENTRY_CONFIG.HEADERS.length).getValues()
    .map(row => readTimeEntry_(row, timezone))
    .filter(entry => {
      const task = tasks.get(entry.taskId);
      if (!task || !task.parentTaskId || task.hasChildren || entry.date < startKey || entry.date > endKey) return false;
      if (!filter) return true;
      if (filter === 'unassigned') return !task.clients.length;
      if (!filter.startsWith('client:')) return false;
      const client = filter.slice(7).toLowerCase();
      return task.clients.some(name => name.toLowerCase() === client);
    })
    .map(entry => ({ ...entry, taskName: tasks.get(entry.taskId).name }))
    .sort((first, second) => second.date.localeCompare(first.date) || second.createdAt.localeCompare(first.createdAt));
  return { success: true, entries, totalHours: entries.reduce((sum, entry) => sum + entry.hours, 0) };
}

function saveTaskTimeEntry(taskId, dateValue, hoursValue, noteValue) {
  taskId = String(taskId || '').trim();
  if (!taskId) throw new Error('Task ID is required.');
  const workDate = parseTaskDate_(dateValue);
  if (!workDate) throw new Error('Choose a valid work date.');
  const hours = normalizeTimeEntryHours_(hoursValue);
  const note = String(noteValue || '').trim();
  if (note.length > 200) throw new Error('Time entry notes can be up to 200 characters.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const taskSheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    if (!taskSheet) throw new Error('Task_Master sheet not found.');
    assertTimeEntrySubtask_(taskSheet, taskId);
    const sheet = timeEntrySheet_(true);
    const entry = {
      id: 'TE-' + Utilities.getUuid(), taskId, date: Utilities.formatDate(workDate, ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd'),
      hours, note, createdAt: new Date().toISOString()
    };
    const row = sheet.getLastRow() + 1;
    sheet.getRange(row, 1, 1, TIME_ENTRY_CONFIG.HEADERS.length).setValues([[
      entry.id, entry.taskId, workDate, entry.hours, entry.note, entry.createdAt
    ]]);
    sheet.getRange(row, 3).setNumberFormat('mmm d, yyyy');
    return { success: true, entry, message: 'Time entry saved.' };
  } finally {
    lock.releaseLock();
  }
}

function deleteTaskTimeEntry(taskId, entryId) {
  taskId = String(taskId || '').trim();
  entryId = String(entryId || '').trim();
  if (!taskId || !entryId) throw new Error('Task and time entry IDs are required.');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const taskSheet = ss.getSheetByName(CONFIG.SHEET_NAME);
    if (!taskSheet) throw new Error('Task_Master sheet not found.');
    findTaskRow(taskSheet, taskId);
    const sheet = timeEntrySheet_(false);
    if (!sheet || sheet.getLastRow() < 2) throw new Error('Time entry not found.');
    const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, TIME_ENTRY_CONFIG.HEADERS.length).getValues();
    const index = rows.findIndex(row => String(row[0] || '') === entryId && String(row[1] || '') === taskId);
    if (index < 0) throw new Error('Time entry not found.');
    sheet.deleteRows(index + 2, 1);
    return { success: true, message: 'Time entry deleted.' };
  } finally {
    lock.releaseLock();
  }
}

function taskVersion_(value) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? Math.floor(value.getTime() / 1000) * 1000 : 0;
}

function nextTaskUpdatedAt_(currentValue, now = new Date()) {
  return new Date(Math.max(taskVersion_(now), taskVersion_(currentValue) + 1000));
}

function assertTaskVersion_(expected, currentValue) {
  const version = Number(expected);
  if (!Number.isSafeInteger(version) || version < 0 || version !== taskVersion_(currentValue)) {
    throw new Error('This task changed since it was loaded. Refresh and retry your edit.');
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
    updatedAt: nextTaskUpdatedAt_(values[12], now)
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
  if (records.some(record => !String(record.parentTaskId || '').trim() && normalizeTaskHours_(record.hours) > 0)) {
    throw new Error('Only subtasks can record hours. Parent totals are calculated from subtasks.');
  }
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
  const start = patch.startDate === undefined ? null : parseTaskDate_(patch.startDate);
  const end = patch.endDate === undefined ? null : parseTaskDate_(patch.endDate);
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
      const tasksWithEntries = timeEntryTaskIds_();
      if (selection.ids.some(id => tasksWithEntries.has(id))) throw new Error('Selected tasks with dated time entries cannot be edited through manual Hours.');
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
    const firstRow = selection.selected.reduce((first, record) => Math.min(first, record.rowNumber), Infinity);
    const lastRow = selection.selected.reduce((last, record) => Math.max(last, record.rowNumber), 0);
    const range = selection.sheet.getRange(firstRow, 1, lastRow - firstRow + 1, taskReadWidth_(selection.sheet));
    const values = range.getValues();
    const formulas = range.getFormulas();
    formulas.forEach((row, rowIndex) => row.forEach((formula, columnIndex) => {
      if (formula) values[rowIndex][columnIndex] = formula;
    }));
    const now = new Date();
    selection.selected.forEach(record => {
      const row = values[record.rowNumber - firstRow];
      if (patch.category !== undefined) row[2] = patch.category;
      if (patch.priority !== undefined) row[3] = patch.priority;
      if (start) row[5] = start;
      if (end) row[6] = end;
      if (clients !== null) row[14] = JSON.stringify(clients);
      if (hours !== null) row[15] = hours;
      row[12] = nextTaskUpdatedAt_(record.values[12], now);
    });
    range.setValues(values);
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

function parseTaskDate_(value) {
  if (!parseLocalDate(value)) return null;
  const timezone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  return Utilities.parseDate(String(value), timezone, 'yyyy-MM-dd');
}

function ensureTimelineColumns_(sheet, lastColumn) {
  const currentColumns = sheet.getMaxColumns();
  if (currentColumns < lastColumn) sheet.insertColumnsAfter(currentColumns, lastColumn - currentColumns);
}

function timelineDayCount_(rows, timezone) {
  const ranges = rows.filter(row => row[0] instanceof Date && row[1] instanceof Date && row[1] >= row[0])
    .map(row => [Utilities.formatDate(row[0], timezone, 'yyyy-MM-dd'), Utilities.formatDate(row[1], timezone, 'yyyy-MM-dd')]);
  if (!ranges.length) return 90;
  const starts = ranges.map(range => range[0]).sort();
  const ends = ranges.map(range => range[1]).sort();
  const start = starts[0].split('-').map(Number);
  const end = ends[ends.length - 1].split('-').map(Number);
  const span = (Date.UTC(end[0], end[1] - 1, end[2]) - Date.UTC(start[0], start[1] - 1, start[2])) / 86400000 + 1;
  return Math.max(90, span);
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

  const timezone = ss.getSpreadsheetTimeZone();
  const dateRows = db.getLastRow() > 1 ? db.getRange(2, 6, db.getLastRow() - 1, 2).getValues() : [];
  const timelineDays = timelineDayCount_(dateRows, timezone);
  const timelineLastColumn = 5 + timelineDays;
  ensureTimelineColumns_(sheet, timelineLastColumn);

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
    `=IFERROR(SEQUENCE(1,${timelineDays},MIN(FILTER(Task_Master!F2:F,Task_Master!F2:F<>"")),1),SEQUENCE(1,90,TODAY(),1))`
  );

  sheet.getRange(2, 6, 1, timelineDays)
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

  sheet.setColumnWidths(6, timelineDays, 30);

  sheet.getRange('D3:E200')
    .setNumberFormat('mmm d, yyyy');

  sheet.getRange(3, 1, 198, timelineLastColumn)
    .setVerticalAlignment('middle');

  sheet.setRowHeight(2, 32);

  // Conditional formatting rules.
  const timelineRange = sheet.getRange(3, 6, 198, timelineDays);
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
      .setRanges([sheet.getRange(2, 6, 1, timelineDays)])
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
    .setTitle('Multi Purpose Planner')
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
    deleteTimeEntriesForTasks_(selection.ids);
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
    const taskValues = rows.find(row => String(row[0] || '').trim() === taskId);
    const currentParentId = String(taskValues?.[13] || '').trim();
    const ownHours = hasHoursColumn_(sheet) ? normalizeTaskHours_(sheet.getRange(taskRow, 16).getValue(), taskId) : 0;
    const hasTimeEntries = timeEntryTaskIds_().has(taskId);
    if (currentParentId && !newParentTaskId && (ownHours > 0 || hasTimeEntries)) {
      throw new Error('This subtask has logged hours or dated entries. Resolve them before making it standalone.');
    }
    if (!currentParentId && newParentTaskId && (ownHours > 0 || hasTimeEntries)) {
      throw new Error('This top-level task has stored Hours or dated entries. Resolve them before assigning it a parent.');
    }

    // Find the existing children of this task.
    const children = rows
      .map((row, index) => ({
        rowNumber: index + 2,
        taskId: String(row[0] || '').trim(),
        parentTaskId: String(row[13] || '').trim(),
        updatedAt: row[12]
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
    const taskUpdatedAt = taskValues ? taskValues[12] : sheet.getRange(taskRow, 13).getValue();

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
          .setValue(nextTaskUpdatedAt_(child.updatedAt, now));
      });
    }

    // Update selected task timestamp.
    sheet.getRange(taskRow, 13).setValue(nextTaskUpdatedAt_(taskUpdatedAt, now));

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
  CURRENCIES: ['USD', 'PHP', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'KRW']
};

function currencyScale_(currency) {
  return currency === 'JPY' || currency === 'KRW' ? 1 : 100;
}

function invoiceDateKey_(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
}

function invoiceText_(value, label, maximum) {
  const text = String(value == null ? '' : value).trim();
  if (text.length > maximum) throw new Error(label + ' is too long.');
  return text;
}

function invoiceDecimal_(value, label, maximum, currency) {
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error(label + ' must be a number.');
  const number = Number(value);
  currency = currency || 'USD';
  const scale = currencyScale_(currency);
  const units = Math.round(number * scale);
  if (!Number.isFinite(number) || number < 0 || number > maximum || Math.abs(number * scale - units) > 0.000001) {
    const precision = scale === 1 ? 'a whole number with no decimal places' : 'a number with at most two decimal places';
    throw new Error(label + ' must be nonnegative and have ' + precision + ' for ' + currency + '.');
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
  const number = invoiceText_(input.number, 'Invoice number', 40);
  if (number && !/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(number)) throw new Error('Invoice numbers must start with a letter or digit and use letters, digits, spaces, dots, slashes, underscores or hyphens.');
  if (!Array.isArray(input.lines) || input.lines.length > 100) throw new Error('An invoice can contain up to 100 lines.');
  const seen = new Set();
  const lines = input.lines.map((line, index) => {
    if (!line || typeof line !== 'object') throw new Error('Invalid invoice line.');
    const taskId = invoiceText_(line.taskId, 'Task ID', 100);
    if (taskId && seen.has(taskId)) throw new Error('The same video appears more than once in this invoice.');
    if (taskId) seen.add(taskId);
    const description = invoiceText_(line.description, 'Line description', 200);
    const hoursUnits = invoiceDecimal_(line.hours, 'Hours on line ' + (index + 1), 10000);
    const rateMinor = invoiceDecimal_(line.rate, 'Rate on line ' + (index + 1), 1000000, currency);
    if (!description) throw new Error('Enter a description for every invoice line.');
    if (status !== 'Draft' && (!hoursUnits || !rateMinor)) throw new Error('Enter positive hours and rates before issuing an invoice.');
    const scale = currencyScale_(currency);
    return { taskId, description, hours: hoursUnits / 100, rate: rateMinor / scale, amountMinor: Math.round(hoursUnits * rateMinor / 100) };
  });
  if (status !== 'Draft' && (!senderName || !lines.length)) throw new Error('Add your name or business and at least one line before issuing.');
  const invoice = {
    id, number, name: invoiceText_(input.name, 'Invoice name', 120), client, currency, status,
    periodStart: input.periodStart, periodEnd: input.periodEnd, issueDate, dueDate,
    periodMode, videoDateBasis, videoScope, includeUnassigned: input.includeUnassigned === true,
    senderName, senderDetails: invoiceText_(input.senderDetails, 'Sender details', 1000),
    clientDetails: invoiceText_(input.clientDetails, 'Client details', 1000),
    notes: invoiceText_(input.notes, 'Notes', 1500),
    defaultRate: invoiceDecimal_(input.defaultRate || 0, 'Default rate', 1000000, currency) / currencyScale_(currency),
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
    defaultRate: invoiceDecimal_(input.defaultRate || 0, 'Default hourly rate', 1000000, input.currency) / currencyScale_(input.currency),
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
      id: invoice.id, number: invoice.number, name: invoice.name, client: invoice.client, periodStart: invoice.periodStart, periodEnd: invoice.periodEnd,
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
      const match = String(row[1] || '').match(/^INV-(\d+)$/i);
      if (match) maximum = Math.max(maximum, Number(match[1]));
    });
    const now = new Date().toISOString();
    invoice.number = invoice.number || (current ? current.number : 'INV-' + String(maximum + 1).padStart(5, '0'));
    if (store.rows.some(row => row[0] !== invoice.id && String(row[1] || '').trim().toLowerCase() === invoice.number.toLowerCase())) {
      throw new Error('Invoice number already exists. Choose a unique invoice number.');
    }
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

const EXPENSE_CONFIG = {
  SHEET: 'Expense_Master',
  HEADERS: ['Expense ID', 'Date', 'Merchant', 'Category', 'Description', 'Amount Minor', 'Currency', 'Payment Method', 'Status', 'Notes', 'Receipt URL', 'Created At', 'Updated At', 'Revision'],
  CATEGORIES: ['Meals', 'Travel', 'Supplies', 'Software', 'Utilities', 'Other'],
  CURRENCIES: INVOICE_CONFIG.CURRENCIES,
  PAYMENT_METHODS: ['Cash', 'Card', 'Bank transfer', 'Digital wallet', 'Other'],
  STATUSES: ['Pending', 'Paid']
};

function expenseText_(value, label, maximum) {
  const text = String(value == null ? '' : value).trim();
  if (text.length > maximum) throw new Error(label + ' is too long.');
  return text;
}

function expenseAmountMinor_(value, currency) {
  if (typeof value !== 'number' && typeof value !== 'string') throw new Error('Amount must be a number.');
  const amount = Number(value);
  currency = currency || 'USD';
  const scale = currencyScale_(currency);
  const minor = Math.round(amount * scale);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10000000 || Math.abs(amount * scale - minor) > 0.000001) {
    const precision = scale === 1 ? 'a whole number with no decimal places' : 'at most two decimal places';
    throw new Error('Amount must be greater than zero, no more than 10000000, and have ' + precision + ' for ' + currency + '.');
  }
  return minor;
}

function normalizeExpense_(input) {
  if (!input || typeof input !== 'object') throw new Error('Expense details are required.');
  const id = String(input.id || '');
  if (id && !/^EXP-[a-zA-Z0-9-]{8,80}$/.test(id)) throw new Error('Invalid expense ID.');
  const date = expenseText_(input.date, 'Date', 10);
  if (!parseLocalDate(date) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose a valid expense date.');
  const merchant = expenseText_(input.merchant, 'Merchant', 120);
  if (!merchant) throw new Error('Enter a merchant.');
  const category = String(input.category || '');
  if (!EXPENSE_CONFIG.CATEGORIES.includes(category)) throw new Error('Choose a valid expense category.');
  const currency = String(input.currency || '');
  if (!EXPENSE_CONFIG.CURRENCIES.includes(currency)) throw new Error('Choose a supported expense currency.');
  const paymentMethod = String(input.paymentMethod || '');
  if (!EXPENSE_CONFIG.PAYMENT_METHODS.includes(paymentMethod)) throw new Error('Choose a valid payment method.');
  const status = input.status || 'Pending';
  if (!EXPENSE_CONFIG.STATUSES.includes(status)) throw new Error('Choose a valid payment status.');
  const receiptUrl = expenseText_(input.receiptUrl, 'Receipt link', 2000);
  if (receiptUrl && !/^https?:\/\/[^\s/$.?#][^\s]*$/i.test(receiptUrl)) throw new Error('Receipt link must be an HTTP or HTTPS URL.');
  const revision = Number(input.revision || 0);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid expense revision.');
  return {
    id, date, merchant, category,
    description: expenseText_(input.description, 'Description', 200),
    amountMinor: expenseAmountMinor_(input.amount, currency),
    currency, paymentMethod, status,
    notes: expenseText_(input.notes, 'Notes', 2000), receiptUrl, revision
  };
}

function expenseSheet_(create) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(EXPENSE_CONFIG.SHEET);
  if (!sheet && create) sheet = ss.insertSheet(EXPENSE_CONFIG.SHEET);
  if (!sheet) return null;
  if (!sheet.getLastRow()) {
    if (create) {
      sheet.getRange(1, 1, 1, EXPENSE_CONFIG.HEADERS.length).setValues([EXPENSE_CONFIG.HEADERS]);
      sheet.setFrozenRows(1);
    }
    return sheet;
  }
  const headers = sheet.getRange(1, 1, 1, EXPENSE_CONFIG.HEADERS.length).getValues()[0];
  if (headers.join('|') !== EXPENSE_CONFIG.HEADERS.join('|')) throw new Error('Expense_Master headers do not match. No expense data was changed.');
  return sheet;
}

function expenseRows_() {
  const sheet = expenseSheet_(false);
  return { sheet, rows: !sheet || sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, EXPENSE_CONFIG.HEADERS.length).getValues() };
}

function expenseDateKey_(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    const timezone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
    return Utilities.formatDate(value, timezone, 'yyyy-MM-dd');
  }
  return String(value == null ? '' : value).trim();
}

function readExpenseRecord_(row) {
  const expense = normalizeExpense_({
    id: String(row[0]), date: expenseDateKey_(row[1]), merchant: row[2], category: row[3], description: row[4],
    amount: Number(row[5]) / currencyScale_(row[6]), currency: row[6], paymentMethod: row[7], status: row[8],
    notes: row[9], receiptUrl: row[10], revision: Number(row[13])
  });
  if (!Number.isSafeInteger(Number(row[5])) || expense.amountMinor !== Number(row[5])) throw new Error('Stored expense amount is invalid.');
  return { ...expense, createdAt: String(row[11] || ''), updatedAt: String(row[12] || '') };
}

function getExpenses() {
  const records = expenseRows_().rows.filter(row => row[0]).map(readExpenseRecord_);
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return {
    success: true,
    expenses: records.sort((first, second) => second.date.localeCompare(first.date) || second.updatedAt.localeCompare(first.updatedAt)),
    today: Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd'),
    categories: EXPENSE_CONFIG.CATEGORIES.slice(),
    currencies: EXPENSE_CONFIG.CURRENCIES.slice(),
    paymentMethods: EXPENSE_CONFIG.PAYMENT_METHODS.slice(),
    statuses: EXPENSE_CONFIG.STATUSES.slice()
  };
}

function writeExpense_(sheet, row, expense) {
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), row - sheet.getMaxRows());
  const date = parseTaskDate_(expense.date);
  if (!date) throw new Error('Choose a valid expense date in the spreadsheet time zone.');
  sheet.getRange(row, 1, 1, EXPENSE_CONFIG.HEADERS.length).setValues([[
    expense.id, date, literalText_(expense.merchant), literalText_(expense.category), literalText_(expense.description),
    expense.amountMinor, expense.currency, literalText_(expense.paymentMethod), expense.status, literalText_(expense.notes),
    literalText_(expense.receiptUrl), expense.createdAt, expense.updatedAt, expense.revision
  ]]);
  sheet.getRange(row, 2).setNumberFormat('mmm d, yyyy');
}

function saveExpense(input) {
  const expense = normalizeExpense_(input);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const store = expenseRows_();
    const index = expense.id ? store.rows.findIndex(row => row[0] === expense.id) : -1;
    if (expense.id && index < 0) throw new Error('Expense not found. Refresh the expense list before saving.');
    const current = index < 0 ? null : readExpenseRecord_(store.rows[index]);
    if (expense.revision !== (current ? current.revision : 0)) throw new Error('This expense changed in another session. Reopen it before updating.');
    const now = new Date().toISOString();
    expense.id = current ? current.id : 'EXP-' + Utilities.getUuid();
    expense.revision = (current ? current.revision : 0) + 1;
    expense.createdAt = current ? current.createdAt : now;
    expense.updatedAt = now;
    const sheet = expenseSheet_(true);
    writeExpense_(sheet, index < 0 ? sheet.getLastRow() + 1 : index + 2, expense);
    return { success: true, expense, message: 'Expense saved.' };
  } finally {
    lock.releaseLock();
  }
}

function deleteExpense(expenseId, revision) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const store = expenseRows_();
    const index = store.rows.findIndex(row => row[0] === expenseId);
    if (index < 0) throw new Error('Expense not found. Refresh the expense list.');
    const expense = readExpenseRecord_(store.rows[index]);
    if (expense.revision !== Number(revision)) throw new Error('This expense changed in another session. Refresh before deleting.');
    store.sheet.deleteRows(index + 2, 1);
    return { success: true, message: 'Expense deleted.' };
  } finally {
    lock.releaseLock();
  }
}

const EARNING_CONFIG = {
  SHEET: 'Earning_Master',
  HEADERS: ['Earning ID', 'Date', 'Payer', 'Category', 'Description', 'Amount Minor', 'Currency', 'Status', 'Notes', 'Created At', 'Updated At', 'Revision'],
  CATEGORIES: ['Salary', 'Freelance', 'Business', 'Investments', 'Other'],
  STATUSES: ['Pending', 'Received'],
  CURRENCIES: INVOICE_CONFIG.CURRENCIES
};

function normalizeEarning_(input) {
  if (!input || typeof input !== 'object') throw new Error('Earning details are required.');
  const id = String(input.id || '');
  if (id && !/^ERN-[a-zA-Z0-9-]{8,80}$/.test(id)) throw new Error('Invalid earning ID.');
  const date = expenseText_(input.date, 'Date', 10);
  if (!parseLocalDate(date) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Choose a valid earning date.');
  const payer = expenseText_(input.payer, 'Payer', 120);
  if (!payer) throw new Error('Enter a payer or income source.');
  const category = String(input.category || '');
  if (!EARNING_CONFIG.CATEGORIES.includes(category)) throw new Error('Choose a valid earning category.');
  const currency = String(input.currency || '');
  if (!EARNING_CONFIG.CURRENCIES.includes(currency)) throw new Error('Choose a supported earning currency.');
  const status = input.status || 'Pending';
  if (!EARNING_CONFIG.STATUSES.includes(status)) throw new Error('Choose a valid earning status.');
  const revision = Number(input.revision || 0);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid earning revision.');
  return {
    id, date, payer, category,
    description: expenseText_(input.description, 'Description', 200),
    amountMinor: expenseAmountMinor_(input.amount, currency), currency, status,
    notes: expenseText_(input.notes, 'Notes', 2000), revision
  };
}

function earningSheet_(create) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(EARNING_CONFIG.SHEET);
  if (!sheet && create) sheet = ss.insertSheet(EARNING_CONFIG.SHEET);
  if (!sheet) return null;
  if (!sheet.getLastRow()) {
    if (create) {
      sheet.getRange(1, 1, 1, EARNING_CONFIG.HEADERS.length).setValues([EARNING_CONFIG.HEADERS]);
      sheet.setFrozenRows(1);
    }
    return sheet;
  }
  const headers = sheet.getRange(1, 1, 1, EARNING_CONFIG.HEADERS.length).getValues()[0];
  if (headers.join('|') !== EARNING_CONFIG.HEADERS.join('|')) throw new Error('Earning_Master headers do not match. No earning data was changed.');
  return sheet;
}

function earningRows_() {
  const sheet = earningSheet_(false);
  return { sheet, rows: !sheet || sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, EARNING_CONFIG.HEADERS.length).getValues() };
}

function readEarningRecord_(row) {
  const currency = String(row[6]);
  const earning = normalizeEarning_({
    id: String(row[0]), date: expenseDateKey_(row[1]), payer: row[2], category: row[3], description: row[4],
    amount: Number(row[5]) / currencyScale_(currency), currency, status: row[7], notes: row[8], revision: Number(row[11])
  });
  if (!Number.isSafeInteger(Number(row[5])) || earning.amountMinor !== Number(row[5])) throw new Error('Stored earning amount is invalid.');
  return { ...earning, createdAt: String(row[9] || ''), updatedAt: String(row[10] || '') };
}

function getEarnings() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const records = earningRows_().rows.filter(row => row[0]).map(readEarningRecord_);
  return {
    success: true,
    earnings: records.sort((first, second) => second.date.localeCompare(first.date) || second.updatedAt.localeCompare(first.updatedAt)),
    today: Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd'),
    categories: EARNING_CONFIG.CATEGORIES.slice(), statuses: EARNING_CONFIG.STATUSES.slice(), currencies: EARNING_CONFIG.CURRENCIES.slice()
  };
}

function writeEarning_(sheet, row, earning) {
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), row - sheet.getMaxRows());
  const date = parseTaskDate_(earning.date);
  if (!date) throw new Error('Choose a valid earning date in the spreadsheet time zone.');
  sheet.getRange(row, 1, 1, EARNING_CONFIG.HEADERS.length).setValues([[
    earning.id, date, literalText_(earning.payer), literalText_(earning.category), literalText_(earning.description),
    earning.amountMinor, earning.currency, earning.status, literalText_(earning.notes),
    earning.createdAt, earning.updatedAt, earning.revision
  ]]);
  sheet.getRange(row, 2).setNumberFormat('mmm d, yyyy');
}

function saveEarning(input) {
  const earning = normalizeEarning_(input);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const store = earningRows_();
    const index = earning.id ? store.rows.findIndex(row => row[0] === earning.id) : -1;
    if (earning.id && index < 0) throw new Error('Earning not found. Refresh the earnings list before saving.');
    const current = index < 0 ? null : readEarningRecord_(store.rows[index]);
    if (earning.revision !== (current ? current.revision : 0)) throw new Error('This earning changed in another session. Reopen it before updating.');
    const now = new Date().toISOString();
    earning.id = current ? current.id : 'ERN-' + Utilities.getUuid();
    earning.revision = (current ? current.revision : 0) + 1;
    earning.createdAt = current ? current.createdAt : now;
    earning.updatedAt = now;
    const sheet = earningSheet_(true);
    writeEarning_(sheet, index < 0 ? sheet.getLastRow() + 1 : index + 2, earning);
    return { success: true, earning, message: 'Earning saved.' };
  } finally {
    lock.releaseLock();
  }
}

function deleteEarning(earningId, revision) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const store = earningRows_();
    const index = store.rows.findIndex(row => row[0] === earningId);
    if (index < 0) throw new Error('Earning not found. Refresh the earnings list.');
    const earning = readEarningRecord_(store.rows[index]);
    if (earning.revision !== Number(revision)) throw new Error('This earning changed in another session. Refresh before deleting.');
    store.sheet.deleteRows(index + 2, 1);
    return { success: true, message: 'Earning deleted.' };
  } finally {
    lock.releaseLock();
  }
}

const RECURRING_CONFIG = {
  SHEET: 'Recurring_Master',
  HEADERS: ['Rule ID', 'Type', 'Name', 'Category', 'Description', 'Amount Minor', 'Currency', 'Frequency', 'Start Date', 'End Date', 'Status', 'Notes', 'Created At', 'Updated At', 'Revision'],
  TYPES: ['Expense', 'Earning'],
  FREQUENCIES: ['Weekly', 'Monthly', 'Quarterly', 'Yearly'],
  STATUSES: ['Active', 'Paused']
};

function normalizeRecurringRule_(input) {
  if (!input || typeof input !== 'object') throw new Error('Recurring rule details are required.');
  const id = String(input.id || '');
  if (id && !/^REC-[a-zA-Z0-9-]{8,80}$/.test(id)) throw new Error('Invalid recurring rule ID.');
  const type = String(input.type || '');
  if (!RECURRING_CONFIG.TYPES.includes(type)) throw new Error('Choose Expense or Earning for this rule.');
  const name = expenseText_(input.name, 'Name', 120);
  if (!name) throw new Error('Enter a name for this recurring item.');
  const category = String(input.category || '');
  const categories = type === 'Expense' ? EXPENSE_CONFIG.CATEGORIES : EARNING_CONFIG.CATEGORIES;
  if (!categories.includes(category)) throw new Error('Choose a valid category for this recurring item.');
  const currency = String(input.currency || '');
  if (!INVOICE_CONFIG.CURRENCIES.includes(currency)) throw new Error('Choose a supported recurring currency.');
  const frequency = String(input.frequency || '');
  if (!RECURRING_CONFIG.FREQUENCIES.includes(frequency)) throw new Error('Choose a valid recurring frequency.');
  const startDate = expenseText_(input.startDate, 'Start date', 10);
  const endDate = expenseText_(input.endDate, 'End date', 10);
  if (!parseLocalDate(startDate) || (endDate && !parseLocalDate(endDate))) throw new Error('Choose valid recurring dates.');
  if (endDate && endDate < startDate) throw new Error('End date cannot precede start date.');
  const status = input.status || 'Active';
  if (!RECURRING_CONFIG.STATUSES.includes(status)) throw new Error('Choose Active or Paused.');
  const revision = Number(input.revision || 0);
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid recurring rule revision.');
  return {
    id, type, name, category, description: expenseText_(input.description, 'Description', 200),
    amountMinor: expenseAmountMinor_(input.amount, currency), currency, frequency, startDate, endDate, status,
    notes: expenseText_(input.notes, 'Notes', 2000), revision
  };
}

function recurringSheet_(create) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(RECURRING_CONFIG.SHEET);
  if (!sheet && create) sheet = ss.insertSheet(RECURRING_CONFIG.SHEET);
  if (!sheet) return null;
  if (!sheet.getLastRow()) {
    if (create) {
      sheet.getRange(1, 1, 1, RECURRING_CONFIG.HEADERS.length).setValues([RECURRING_CONFIG.HEADERS]);
      sheet.setFrozenRows(1);
    }
    return sheet;
  }
  const headers = sheet.getRange(1, 1, 1, RECURRING_CONFIG.HEADERS.length).getValues()[0];
  if (headers.join('|') !== RECURRING_CONFIG.HEADERS.join('|')) throw new Error('Recurring_Master headers do not match. No recurring data was changed.');
  return sheet;
}

function recurringRows_() {
  const sheet = recurringSheet_(false);
  return { sheet, rows: !sheet || sheet.getLastRow() < 2 ? [] : sheet.getRange(2, 1, sheet.getLastRow() - 1, RECURRING_CONFIG.HEADERS.length).getValues() };
}

function readRecurringRule_(row) {
  const currency = String(row[6]);
  const rule = normalizeRecurringRule_({
    id: String(row[0]), type: row[1], name: row[2], category: row[3], description: row[4],
    amount: Number(row[5]) / currencyScale_(currency), currency, frequency: row[7],
    startDate: expenseDateKey_(row[8]), endDate: row[9] ? expenseDateKey_(row[9]) : '', status: row[10], notes: row[11], revision: Number(row[14])
  });
  if (!Number.isSafeInteger(Number(row[5])) || rule.amountMinor !== Number(row[5])) throw new Error('Stored recurring amount is invalid.');
  return { ...rule, createdAt: String(row[12] || ''), updatedAt: String(row[13] || '') };
}

function getRecurringRules(type) {
  if (type && !RECURRING_CONFIG.TYPES.includes(type)) throw new Error('Choose Expense or Earning for recurring rules.');
  return { success: true, rules: recurringRows_().rows.filter(row => row[0]).map(readRecurringRule_).filter(rule => !type || rule.type === type).sort((first, second) => first.startDate.localeCompare(second.startDate)) };
}

function writeRecurringRule_(sheet, row, rule) {
  if (row > sheet.getMaxRows()) sheet.insertRowsAfter(sheet.getMaxRows(), row - sheet.getMaxRows());
  const startDate = parseTaskDate_(rule.startDate);
  const endDate = rule.endDate ? parseTaskDate_(rule.endDate) : '';
  if (!startDate || (rule.endDate && !endDate)) throw new Error('Choose valid recurring dates in the spreadsheet time zone.');
  sheet.getRange(row, 1, 1, RECURRING_CONFIG.HEADERS.length).setValues([[
    rule.id, rule.type, literalText_(rule.name), literalText_(rule.category), literalText_(rule.description),
    rule.amountMinor, rule.currency, rule.frequency, startDate, endDate, rule.status, literalText_(rule.notes),
    rule.createdAt, rule.updatedAt, rule.revision
  ]]);
  sheet.getRange(row, 9, 1, 2).setNumberFormat('mmm d, yyyy');
}

function saveRecurringRule(input) {
  const rule = normalizeRecurringRule_(input);
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const store = recurringRows_();
    const index = rule.id ? store.rows.findIndex(row => row[0] === rule.id) : -1;
    if (rule.id && index < 0) throw new Error('Recurring rule not found. Refresh before saving.');
    const current = index < 0 ? null : readRecurringRule_(store.rows[index]);
    if (rule.revision !== (current ? current.revision : 0)) throw new Error('This recurring rule changed in another session. Reopen it before updating.');
    const now = new Date().toISOString();
    rule.id = current ? current.id : 'REC-' + Utilities.getUuid();
    rule.revision = (current ? current.revision : 0) + 1;
    rule.createdAt = current ? current.createdAt : now;
    rule.updatedAt = now;
    const sheet = recurringSheet_(true);
    writeRecurringRule_(sheet, index < 0 ? sheet.getLastRow() + 1 : index + 2, rule);
    return { success: true, rule, message: 'Recurring rule saved. Forecasts do not create transactions.' };
  } finally {
    lock.releaseLock();
  }
}

function deleteRecurringRule(ruleId, revision) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const store = recurringRows_();
    const index = store.rows.findIndex(row => row[0] === ruleId);
    if (index < 0) throw new Error('Recurring rule not found. Refresh the rules list.');
    const rule = readRecurringRule_(store.rows[index]);
    if (rule.revision !== Number(revision)) throw new Error('This recurring rule changed in another session. Refresh before deleting.');
    store.sheet.deleteRows(index + 2, 1);
    return { success: true, message: 'Recurring rule deleted.' };
  } finally {
    lock.releaseLock();
  }
}

function getFinanceExchangeRates(baseCurrency) {
  baseCurrency = String(baseCurrency || 'USD').toUpperCase();
  if (!INVOICE_CONFIG.CURRENCIES.includes(baseCurrency)) throw new Error('Choose a supported reporting currency.');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const requestedOn = Utilities.formatDate(new Date(), ss.getSpreadsheetTimeZone(), 'yyyy-MM-dd');
  const propertyKey = 'FINANCE_FX_DAILY_' + baseCurrency;
  const properties = PropertiesService.getScriptProperties();
  let saved = null;
  try { saved = JSON.parse(properties.getProperty(propertyKey) || 'null'); } catch (_) {}
  if (saved && saved.requestedOn === requestedOn && saved.rates && saved.base === baseCurrency) return { ...saved, cached: true, stale: false };

  try {
    const quotes = INVOICE_CONFIG.CURRENCIES.filter(currency => currency !== baseCurrency).join(',');
    const url = 'https://api.frankfurter.dev/v2/rates?base=' + encodeURIComponent(baseCurrency) + '&quotes=' + encodeURIComponent(quotes);
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) throw new Error('Daily exchange rate provider returned HTTP ' + response.getResponseCode() + '.');
    const rows = JSON.parse(response.getContentText());
    if (!Array.isArray(rows) || !rows.length) throw new Error('Daily exchange rate provider returned no rates.');
    const rates = { [baseCurrency]: 1 };
    rows.forEach(row => {
      if (row.base === baseCurrency && INVOICE_CONFIG.CURRENCIES.includes(row.quote) && Number.isFinite(Number(row.rate)) && Number(row.rate) > 0) {
        rates[row.quote] = Number(row.rate);
      }
    });
    if (Object.keys(rates).length < 2) throw new Error('Daily exchange rate provider returned no usable quotes.');
    const result = {
      success: true, base: baseCurrency, rates,
      rateDate: String(rows[0].date || ''), requestedOn,
      source: 'Frankfurter daily mid-market rates'
    };
    try { properties.setProperty(propertyKey, JSON.stringify(result)); } catch (_) {}
    return { ...result, cached: false, stale: false };
  } catch (error) {
    if (saved && saved.rates && saved.base === baseCurrency) {
      return { ...saved, cached: true, stale: true, error: 'Could not refresh today’s exchange rates. Showing the last saved daily rates.' };
    }
    throw new Error('Daily exchange rates are unavailable: ' + (error.message || error));
  }
}
