# Google Sheets Fixtures

These files contain fictional data for importing into a test copy of the planner. They contain no client data or credentials.

## Valid Starter Data

- `Task_Master.csv` has five tasks: two parents and three leaf subtasks, with clients, expected hours, statuses, and duration formulas.
- `Time_Entry_Master.csv` has two dated time entries for leaf subtasks. Its totals can be compared with the task and parent progress in the app.

Import each CSV into a separate sheet in a **copy** of a spreadsheet:

1. Open a new Google spreadsheet reserved for testing.
2. Use **File → Import → Upload** and select `Task_Master.csv`. Choose **Insert new sheet(s)** and name the resulting tab `Task_Master`.
3. Import `Time_Entry_Master.csv` the same way, naming its tab `Time_Entry_Master`.
4. Check that the headers match the CSVs, date columns were recognized as dates, and the Duration cells contain formulas. Client values are JSON arrays in one cell.
5. Bind or deploy the planner code to this test spreadsheet. Reload the sheet and app before testing.

Do not import the starter data into a spreadsheet with existing task data. `Initialize Task Database` is for setting up or formatting the task sheet; it does not merge or replace fixture rows.

## Intentional Error Fixture

`Task_ID_Issues_Example.csv` intentionally contains a Task ID with trailing whitespace, a duplicate ID after trimming, and a subtask that points to a missing parent. Import it only as `Task_Master` in a separate disposable test spreadsheet. Then run **Task Manager → Check and Clean Task IDs (with backup)** to exercise cleanup and issue reporting. The cleanup trims whitespace but reports duplicates and missing parents without choosing how to repair them.

## GitHub

These fixtures are safe to commit as test data. Keep real client names, task data, spreadsheet IDs, Apps Script IDs, credentials, and deployment URLs out of this directory.
