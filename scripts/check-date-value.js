// Checks common/dateValue.ts (the date control's time zone conversion) without a test runner.
// Runs the checks once per browser time zone, since that is what date bugs depend on:
//   npm run check:dates
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ts = require("typescript");

const BROWSER_TIME_ZONES = ["America/New_York", "Asia/Jakarta", "UTC"];

if (!process.env.DATE_CHECK_CHILD) {
    for (const tz of BROWSER_TIME_ZONES) {
        execFileSync(process.execPath, [__filename], { stdio: "inherit", env: { ...process.env, TZ: tz, DATE_CHECK_CHILD: "1" } });
    }
    process.exit(0);
}

const assert = require("assert");
const source = fs.readFileSync(path.join(__dirname, "..", "common", "dateValue.ts"), "utf8");
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
}).outputText;
const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "date-check-")), "dateValue.js");
fs.writeFileSync(file, compiled);
const d = require(file);

const userUtcPlus7 = () => 420; // the user's Dataverse time zone, independent of the browser's
const withTime = (w) => d.toInputValue(w, true);

// Inbound, per behavior (README caveat 8).
const userLocal = d.toWallClock(new Date(Date.UTC(2026, 9, 15, 7, 0)), 1, userUtcPlus7);
assert.strictEqual(withTime(userLocal), "2026-10-15T14:00", "User Local shows the user's time zone");
const dateOnly = d.toWallClock(new Date(Date.UTC(2026, 9, 15)), 2, userUtcPlus7);
assert.strictEqual(d.toInputValue(dateOnly, false), "2026-10-15", "Date Only never shifts");
const independent = d.toWallClock(new Date(Date.UTC(2026, 9, 15, 14, 0)), 3, userUtcPlus7);
assert.strictEqual(withTime(independent), "2026-10-15T14:00", "Time Zone Independent never shifts");

// An unchanged edit gives back exactly the same value, seconds included.
const withSeconds = d.toWallClock(new Date(Date.UTC(2026, 9, 15, 7, 0, 42)), 1, userUtcPlus7);
for (const w of [userLocal, dateOnly, independent, withSeconds]) {
    assert.strictEqual(d.fromInputValue(withTime(w), w).getTime(), w.getTime(), "unchanged round trip");
    assert.strictEqual(d.fromWallClock(w).getTime(), w.getTime(), "output keeps the wall clock");
}
// Changing the minute drops the stored seconds; changing only the date keeps the time of day.
assert.strictEqual(d.fromInputValue("2026-10-15T14:01", withSeconds).getSeconds(), 0);
assert.strictEqual(withTime(d.fromInputValue("2026-10-20", userLocal)), "2026-10-20T14:00");
// Empty clears; anything else unreadable is rejected.
assert.strictEqual(d.fromInputValue("", userLocal), null);
assert.strictEqual(d.fromInputValue("15/10/2026", userLocal), undefined);

console.log(`date helpers OK (browser time zone ${process.env.TZ})`);
