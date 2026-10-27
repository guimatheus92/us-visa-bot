import { Bot, nextMaxDate } from '../lib/bot.js';
import { getConfig, WEEKDAYS } from '../lib/config.js';
import { log, sleep, isSocketHangupError } from '../lib/utils.js';

const COOLDOWN = 3600; // 1 hour in seconds
const EMPTY_LIST_LIMIT = 3; // consecutive empty date lists before pausing like a connection reset
const MAX_FAILURES = 3; // consecutive errors before pausing like a connection reset

export async function botCommand(options) {
  const config = getConfig();
  const bot = new Bot(config, { dryRun: options.dryRun });
  let currentBookedDate = options.current;
  const targetDate = options.target;
  const minDate = options.min;
  // options.max also carries a lowered ceiling across the retry restarts below
  let maxDate = options.max || config.maxDate;

  // A malformed date parses to NaN and would silently disable the ceiling
  if (maxDate && !/^\d{4}-\d{2}-\d{2}$/.test(maxDate)) {
    console.error(`Max date must be YYYY-MM-DD, got "${maxDate}"`);
    process.exit(1);
  }

  log(`Initializing with current date ${currentBookedDate}`);

  if (maxDate) {
    log(`Max date: ${maxDate}`);
  }

  if (config.consulateWeekdays || config.ascWeekdays) {
    const days = (weekdays) => (weekdays ? weekdays.map(d => WEEKDAYS[d]).join(', ') : 'all');
    log(`Weekdays: interview ${days(config.consulateWeekdays)}; ASC ${days(config.ascWeekdays)}`);
  }

  // STOP_AFTER_BOOKING is MAX_BOOKINGS=1; whichever limit comes first wins
  const bookingLimit = config.stopAfterBooking ? 1 : config.maxBookings;

  if (bookingLimit) {
    log(`Stops after ${bookingLimit} confirmed booking(s) (${options.bookings || 0} so far)`);
  }

  if (options.dryRun) {
    log(`[DRY RUN MODE] Bot will only log what would be booked without actually booking`);
  }

  if (targetDate) {
    log(`Target date: ${targetDate}`);
  }

  if (minDate) {
    log(`Minimum date: ${minDate}`);
  }

  try {
    const sessionHeaders = await bot.initialize();

    while (true) {
      if (maxDate && maxDate < new Date().toISOString().slice(0, 10)) {
        log(`Max date ${maxDate} has passed, nothing left to look for. Stopping.`);
        process.exit(0);
      }

      const availableDates = await bot.checkAvailableDates(
        sessionHeaders,
        currentBookedDate,
        minDate,
        maxDate
      );

      // The site answered: earlier errors no longer count toward a pause
      if (options.failures) {
        options = { ...options, failures: 0 };
      }

      // Nothing to see while the list stays empty (daily window or rate limit); pause, then log in again
      if (bot.emptyStreak >= EMPTY_LIST_LIMIT) {
        log(`${bot.emptyStreak} empty date lists in a row (daily window or rate limit). Trying again after ${COOLDOWN} seconds...`);
        await sleep(COOLDOWN);
        return botCommand(options);
      }

      if (availableDates.length > 0) {
        const bookedDate = await bot.bookEarliest(sessionHeaders, availableDates, maxDate);

        if (bookedDate) {
          // Update current date; with a max date, only a whole month earlier is worth another attempt
          currentBookedDate = bookedDate;

          if (maxDate) {
            maxDate = nextMaxDate(bookedDate);
            log(`Rescheduled to ${bookedDate}. From now on only dates up to ${maxDate} count.`);
          }

          // options also carries the count across the retry restarts, so a pause cannot reset the limit
          const bookings = (options.bookings || 0) + 1;

          options = {
            ...options,
            current: currentBookedDate,
            max: maxDate,
            bookings
          };

          if (bookingLimit && bookings >= bookingLimit) {
            log(`Booking limit reached (${bookings} of ${bookingLimit}, STOP_AFTER_BOOKING / MAX_BOOKINGS). Stopping.`);
            process.exit(0);
          }

          if (targetDate && bookedDate <= targetDate) {
            log(`Target date reached! Successfully booked appointment on ${bookedDate}`);
            process.exit(0);
          }
        }
      }

      await sleep(config.refreshDelay);
    }
  } catch (err) {
    // Never retry right away: an error page once made the bot log in ~100 times in 15 seconds
    const failures = (options.failures || 0) + 1;
    options = { ...options, failures };

    if (isSocketHangupError(err)) {
      log(`Socket hangup error: ${err.message}. Trying again after ${COOLDOWN} seconds...`);
      await sleep(COOLDOWN);
    } else if (failures >= MAX_FAILURES) {
      log(`Session/authentication error: ${err.message}. ${failures} failures in a row, trying again after ${COOLDOWN} seconds...`);
      await sleep(COOLDOWN);
    } else {
      log(`Session/authentication error: ${err.message}. Retrying after ${config.refreshDelay} seconds...`);
      await sleep(config.refreshDelay);
    }
    return botCommand(options);
  }
}
