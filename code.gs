
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
  'Parent Task ID'
  ],
  CATEGORIES: [
    'Pre-production',
    'Editing',
    'Post-production',
    'Graphics',
    'Subtitles',
    'Review',
    'Delivery'
  ],
  PRIORITIES: ['Low', 'Medium', 'High']
};

// Adds a menu whenever the spreadsheet opens.
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Task Manager')
    .addItem('Build / Refresh Timeline', 'setupTimeline')
    .addItem('Initialize Task Database', 'setupTaskDatabase')
    .addToUi();
}

function setupTaskDatabase() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);

  // Create the database sheet if it doesn't exist.
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  }

  // Initialize a completely empty database.
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, CONFIG.HEADERS.length)
      .setValues([CONFIG.HEADERS]);

  } else {
    // Validate the original 13 columns.
    const existing = sheet.getRange(1, 1, 1, 13)
      .getValues()[0];

    const originalHeaders = CONFIG.HEADERS.slice(0, 13);

    if (existing.join('|') !== originalHeaders.join('|')) {
      throw new Error(
        'Task_Master headers do not match the required structure.'
      );
    }

    // Add Parent Task ID in column N if missing.
    const parentHeader = sheet.getRange(1, 14).getValue();

    if (!parentHeader) {
      sheet.getRange(1, 14).setValue('Parent Task ID');

    } else if (parentHeader !== 'Parent Task ID') {
      throw new Error(
        'Column N is already in use. Please inspect Task_Master before continuing.'
      );
    }
  }

  // Apply database formatting.
  sheet.setFrozenRows(1);

  sheet.getRange('A1:N1')
    .setFontWeight('bold')
    .setBackground('#1F2937')
    .setFontColor('#FFFFFF');

  sheet.getRange('F:G').setNumberFormat('mmm d, yyyy');
  sheet.getRange('J:K').setNumberFormat('mmm d, yyyy');
  sheet.getRange('H:H').setNumberFormat('0');
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

  // Backend confirms that the database contains no task rows.
  if (lastRow < 2) {
    return {
      success: true,
      hasTasks: false,
      total: 0,
      tasks: []
    };
  }

  const rows = sheet.getRange(
    2, 1, lastRow - 1, 14
  ).getValues();

  const taskRows = rows.filter(row =>
    String(row[0] || '').trim() !== ''
  );

  if (!taskRows.length) {
    return {
      success: true,
      hasTasks: false,
      total: 0,
      tasks: []
    };
  }

  // Calculate child counts for every parent.
  const childStats = {};

  taskRows.forEach(row => {
    const parentId = String(row[13] || '').trim();

    if (!parentId) return;

    if (!childStats[parentId]) {
      childStats[parentId] = {
        total: 0,
        completed: 0
      };
    }

    childStats[parentId].total++;

    if (String(row[4]) === 'Done') {
      childStats[parentId].completed++;
    }
  });

  const tasks = taskRows.map(row => {
    const taskId = String(row[0]);
    const stats = childStats[taskId] || {
      total: 0,
      completed: 0
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

      parentTaskId: String(row[13] || ''),
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
    total: tasks.length,
    tasks: tasks
  };
}

// Creates a new task.
function createTask(formData) {
  const lock = LockService.getDocumentLock();
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

    if (parentTaskId) {
      const parentRow = findTaskRow(sheet, parentTaskId);
      const existingParentId = sheet.getRange(parentRow, 14).getValue();

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

    // Required-field validation.
    if (!taskName || !category || !priority ||
        !startDate || !endDate) {
      throw new Error('Please complete all required fields.');
    }

    if (!CONFIG.CATEGORIES.includes(category)) {
      throw new Error('Invalid task category.');
    }

    if (!CONFIG.PRIORITIES.includes(priority)) {
      throw new Error('Invalid task priority.');
    }

    if (endDate < startDate) {
      throw new Error(
        'End date cannot be earlier than start date.'
      );
    }

    // Find the highest existing task ID.
    const lastRow = sheet.getLastRow();
    let maxId = 0;

    if (lastRow >= 2) {
      const ids = sheet.getRange(2, 1, lastRow - 1, 1)
        .getDisplayValues();

      ids.forEach(row => {
        const match = String(row[0]).match(/^VID-(\d+)$/);
        if (match) {
          maxId = Math.max(maxId, Number(match[1]));
        }
      });
    }

    const taskId = 'VID-' + String(maxId + 1).padStart(3, '0');
    const now = new Date();
    const newRow = sheet.getLastRow() + 1;

    // Write all 14 columns, including Parent Task ID.
    sheet.getRange(newRow, 1, 1, 14).setValues([[
      taskId,
      taskName,
      category,
      priority,
      'To Do',
      startDate,
      endDate,
      '',
      description,
      '',
      '',
      now,
      now,
      parentTaskId
    ]]);

    // Inclusive calendar-day duration.
    sheet.getRange(newRow, 8).setFormula(
      `=IF(OR(F${newRow}="",G${newRow}=""),"",G${newRow}-F${newRow}+1)`
    );

    sheet.getRange(newRow, 6, 1, 2)
      .setNumberFormat('mmm d, yyyy');

    sheet.getRange(newRow, 12, 1, 2)
      .setNumberFormat('mmm d, yyyy hh:mm');

    // Recalculate the parent after adding a subtask.
    if (parentTaskId) {
      refreshParentSchedule(sheet, parentTaskId);
    }

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

// Recalculates a parent's dates from its current subtasks.
function refreshParentSchedule(sheet, parentTaskId) {
  parentTaskId = String(parentTaskId || '').trim();

  if (!parentTaskId) return;

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  const rows = sheet.getRange(
    2, 1, lastRow - 1, 14
  ).getValues();

  const parentIndex = rows.findIndex(
    row => String(row[0]).trim() === parentTaskId
  );

  if (parentIndex === -1) {
    throw new Error('Parent task not found: ' + parentTaskId);
  }

  const children = rows.filter(
    row => String(row[13] || '').trim() === parentTaskId
  );

  // Preserve the last schedule when no children remain.
  if (!children.length) return;

  const validDates = values => values
    .map(value => {
      if (value instanceof Date && !isNaN(value.getTime())) {
        return value;
      }

      return parseLocalDate(value);
    })
    .filter(Boolean);

  const starts = validDates(children.map(row => row[5]));
  const ends = validDates(children.map(row => row[6]));

  if (!starts.length || !ends.length) return;

  const earliestStart = new Date(
    Math.min(...starts.map(date => date.getTime()))
  );

  const latestEnd = new Date(
    Math.max(...ends.map(date => date.getTime()))
  );

  const parentRow = parentIndex + 2;

  // Update the parent's planned schedule.
  sheet.getRange(parentRow, 6, 1, 2).setValues([[
    earliestStart,
    latestEnd
  ]]);

  // Update inclusive duration.
  sheet.getRange(parentRow, 8).setFormula(
    `=IF(OR(F${parentRow}="",G${parentRow}=""),"",G${parentRow}-F${parentRow}+1)`
  );

  sheet.getRange(parentRow, 6, 1, 2)
    .setNumberFormat('mmm d, yyyy');

  sheet.getRange(parentRow, 13).setValue(new Date());
}
// Updates task details without changing its status.
// Updates task details without changing its status.
function updateTask(formData) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(10000);

  try {
    const taskId = String(formData.taskId || '').trim();
    const taskName = String(formData.taskName || '').trim();
    const category = String(formData.category || '');
    const priority = String(formData.priority || '');
    const startDate = parseLocalDate(formData.startDate);
    const endDate = parseLocalDate(formData.endDate);
    const description = String(formData.description || '').trim();
    const dayOffset = Number(formData.dayOffset || 0);

    if (!taskId || !taskName || !category ||
        !priority || !startDate || !endDate) {
      throw new Error('Please complete all required fields.');
    }

    if (!Number.isInteger(dayOffset)) {
      throw new Error('Invalid reschedule offset.');
    }

    if (!CONFIG.CATEGORIES.includes(category)) {
      throw new Error('Invalid task category.');
    }

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

    // Remember the current parent relationship.
    const currentParentTaskId = String(
      sheet.getRange(row, 14).getValue() || ''
    ).trim();

    // Determine whether this task has children.
    const lastRow = sheet.getLastRow();

    const rows = lastRow >= 2
      ? sheet.getRange(2, 1, lastRow - 1, 14).getValues()
      : [];

    const hasChildren = rows.some(row =>
      String(row[13] || '').trim() === taskId
    );

    // Update editable fields only.
    sheet.getRange(row, 2, 1, 3).setValues([[
      taskName, category, priority
    ]]);

    sheet.getRange(row, 6, 1, 2).setValues([[
      startDate, endDate
    ]]);

    sheet.getRange(row, 9).setValue(description);
    sheet.getRange(row, 13).setValue(new Date());

    if (hasChildren && dayOffset !== 0) {
      rows.forEach((childValues, index) => {
        if (String(childValues[13] || '').trim() !== taskId) return;

        const childStart = childValues[5] instanceof Date
          ? childValues[5]
          : parseLocalDate(childValues[5]);
        const childEnd = childValues[6] instanceof Date
          ? childValues[6]
          : parseLocalDate(childValues[6]);

        if (!childStart || !childEnd) return;

        const childRow = index + 2;
        sheet.getRange(childRow, 6, 1, 2).setValues([[
          addDays(childStart, dayOffset),
          addDays(childEnd, dayOffset)
        ]]);
        sheet.getRange(childRow, 13).setValue(new Date());
      });

      refreshParentSchedule(sheet, taskId);

      return {
        success: true,
        message: taskId + ' rescheduled successfully!'
      };
    }

    // Editing a subtask recalculates its parent.
    if (currentParentTaskId) {
      refreshParentSchedule(sheet, currentParentTaskId);
    }

    // Editing a parent with children recalculates its schedule.
    if (hasChildren) {
      refreshParentSchedule(sheet, taskId);
    }

    return {
      success: true,
      message: taskId + ' updated successfully!'
    };

  } finally {
    lock.releaseLock();
  }
}

function addDays(dateValue, days) {
  const date = new Date(dateValue.getTime());
  date.setDate(date.getDate() + days);
  return date;
}

// Updates status and actual work dates.
function updateTaskStatus(taskId, newStatus) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(10000);

  try {
    const allowedStatuses = [
      'To Do',
      'In Progress',
      'Blocked',
      'Done'
    ];

    if (!allowedStatuses.includes(newStatus)) {
      throw new Error('Invalid status.');
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet()
      .getSheetByName(CONFIG.SHEET_NAME);

    const row = findTaskRow(sheet, taskId);
    const currentStatus = sheet.getRange(row, 5).getValue();

    const now = new Date();

    // Record the first day work actually begins.
    const actualStart = sheet.getRange(row, 10).getValue();

    if (
      !actualStart &&
      (newStatus === 'In Progress' || newStatus === 'Done')
    ) {
      sheet.getRange(row, 10).setValue(now);
    }

    // Record completion date.
    if (newStatus === 'Done') {
      sheet.getRange(row, 11).setValue(now);
    } else if (currentStatus === 'Done') {
      // Reopened task: remove previous completion date.
      sheet.getRange(row, 11).clearContent();
    }

    sheet.getRange(row, 5).setValue(newStatus);
    sheet.getRange(row, 13).setValue(now);

    return {
      success: true,
      message: taskId + ' status changed to ' + newStatus + '.'
    };

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
// Deletes a task and recalculates its former parent's schedule.
function deleteTask(taskId) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(10000);

  try {
    taskId = String(taskId || '').trim();

    if (!taskId) {
      throw new Error('Task ID is required.');
    }

    const sheet = SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName(CONFIG.SHEET_NAME);

    if (!sheet) {
      throw new Error('Task_Master sheet not found.');
    }

    const row = findTaskRow(sheet, taskId);

    // Prevent deleting a parent with existing subtasks.
    const lastRow = sheet.getLastRow();

    if (lastRow >= 2) {
      const records = sheet
        .getRange(2, 1, lastRow - 1, 14)
        .getValues();

      const hasChildren = records.some(record =>
        String(record[13] || '').trim() === taskId
      );

      if (hasChildren) {
        throw new Error(
          'This task has subtasks. Delete or transfer its subtasks first.'
        );
      }
    }

    // Preserve the parent ID before deleting the row.
    const formerParentTaskId = String(
      sheet.getRange(row, 14).getValue() || ''
    ).trim();

    sheet.deleteRow(row);

    // Recalculate the former parent's schedule.
    if (formerParentTaskId) {
      refreshParentSchedule(sheet, formerParentTaskId);
    }

    SpreadsheetApp.flush();

    return {
      success: true,
      message: taskId + ' deleted successfully.'
    };

  } finally {
    lock.releaseLock();
  }
}
// Changes a task's parent without recreating the task.
function setTaskParent(taskId, newParentTaskId) {
  const lock = LockService.getDocumentLock();
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

    const previousParentTaskId = String(
      sheet.getRange(taskRow, 14).getValue() || ''
    ).trim();

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

    // Recalculate the previous parent.
    if (
      previousParentTaskId &&
      previousParentTaskId !== newParentTaskId
    ) {
      refreshParentSchedule(sheet, previousParentTaskId);
    }

    // Recalculate the destination parent.
    if (newParentTaskId) {
      refreshParentSchedule(sheet, newParentTaskId);
    }

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
