/**
 * Converts Dataverse date values to and from a "wall clock": the date and time a
 * user reads on the form, held in a Date's browser-local fields (getFullYear,
 * getHours, ...). The picker input, the formatted display and getOutputs all use
 * that one representation.
 *
 * Microsoft documents how each time zone behavior is stored but not what a PCF
 * control receives, so these rules follow the community-documented behavior:
 * - User Local: the value is a UTC instant; the user's Dataverse time zone
 *   (not the browser's) gives its wall clock.
 * - Date Only and Time Zone Independent: the value carries the wall clock in
 *   its UTC fields.
 * - On the way out, the platform takes the wall clock from the browser-local
 *   fields and applies the column's behavior itself.
 */

/** DateTimeMetadata.Behavior values. 0 (none) is treated like User Local. */
export const DATE_BEHAVIOR = { userLocal: 1, dateOnly: 2, timeZoneIndependent: 3 } as const;

/** The platform value as the wall clock the user sees. */
export function toWallClock(raw: Date, behavior: number, timeZoneOffsetMinutes: (date: Date) => number): Date {
    const utcFields =
        behavior === DATE_BEHAVIOR.dateOnly || behavior === DATE_BEHAVIOR.timeZoneIndependent
            ? raw
            : new Date(raw.getTime() + timeZoneOffsetMinutes(raw) * 60_000);
    return new Date(
        utcFields.getUTCFullYear(),
        utcFields.getUTCMonth(),
        utcFields.getUTCDate(),
        utcFields.getUTCHours(),
        utcFields.getUTCMinutes(),
        utcFields.getUTCSeconds()
    );
}

/** The value to hand back to the platform for a wall clock. */
export function fromWallClock(wallClock: Date): Date {
    return new Date(wallClock.getTime());
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The wall clock as an <input type="date"> ("YYYY-MM-DD") or "datetime-local" ("YYYY-MM-DDTHH:mm") value. */
export function toInputValue(wallClock: Date, withTime: boolean): string {
    const date = `${wallClock.getFullYear()}-${pad(wallClock.getMonth() + 1)}-${pad(wallClock.getDate())}`;
    return withTime ? `${date}T${pad(wallClock.getHours())}:${pad(wallClock.getMinutes())}` : date;
}

/**
 * Parses a date or datetime-local input value into a wall clock. Without a time part, the time
 * of day comes from `keepTimeOf` (so editing only the date keeps a stored time), else midnight.
 * Returns null for an empty value and undefined for one that can't be read.
 */
export function fromInputValue(value: string, keepTimeOf: Date | null): Date | null | undefined {
    if (value === "") return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(value);
    if (!match) return undefined;
    const [, y, m, d, hh, mm] = match;
    const hours = hh !== undefined ? Number(hh) : keepTimeOf?.getHours() ?? 0;
    const minutes = mm !== undefined ? Number(mm) : keepTimeOf?.getMinutes() ?? 0;
    const seconds = hh !== undefined ? 0 : keepTimeOf?.getSeconds() ?? 0;
    return new Date(Number(y), Number(m) - 1, Number(d), hours, minutes, seconds);
}
