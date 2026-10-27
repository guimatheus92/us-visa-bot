import dotenv from 'dotenv';

dotenv.config();

// Index matches Date#getUTCDay()
export const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

// "mon,wed" -> [1, 3]; unset or "all" -> null (any day)
export function parseWeekdays(value, name) {
  if (!value || value.trim().toLowerCase() === 'all') return null;

  const days = value.split(',').map(d => d.trim().toLowerCase());
  const invalid = days.filter(d => !WEEKDAYS.includes(d));

  if (invalid.length > 0) {
    console.error(`${name} must be "all" or a comma-separated list of ${WEEKDAYS.join(', ')}; got "${value}"`);
    process.exit(1);
  }

  return days.map(d => WEEKDAYS.indexOf(d));
}

// A typo must not silently disable a safety limit, so anything unexpected stops the bot
export function parseBoolean(value, name) {
  const v = (value || '').trim().toLowerCase();
  if (['', 'false', '0', 'no'].includes(v)) return false;
  if (['true', '1', 'yes'].includes(v)) return true;

  console.error(`${name} must be true or false; got "${value}"`);
  process.exit(1);
}

// Unset -> null (no limit)
export function parsePositiveInt(value, name) {
  const v = (value || '').trim();
  if (!v) return null;
  if (/^[1-9]\d*$/.test(v)) return Number(v);

  console.error(`${name} must be a positive whole number; got "${value}"`);
  process.exit(1);
}

export function getConfig() {
  const config = {
    email: process.env.EMAIL,
    password: process.env.PASSWORD,
    scheduleId: process.env.SCHEDULE_ID,
    facilityId: process.env.FACILITY_ID,
    ascFacilityId: process.env.ASC_FACILITY_ID,
    countryCode: process.env.COUNTRY_CODE,
    maxDate: process.env.MAX_DATE,
    consulateWeekdays: parseWeekdays(process.env.CONSULATE_WEEKDAYS, 'CONSULATE_WEEKDAYS'),
    ascWeekdays: parseWeekdays(process.env.ASC_WEEKDAYS, 'ASC_WEEKDAYS'),
    stopAfterBooking: parseBoolean(process.env.STOP_AFTER_BOOKING, 'STOP_AFTER_BOOKING'),
    maxBookings: parsePositiveInt(process.env.MAX_BOOKINGS, 'MAX_BOOKINGS'),
    refreshDelay: Number(process.env.REFRESH_DELAY || 3)
  };

  validateConfig(config);
  return config;
}

function validateConfig(config) {
  const required = ['email', 'password', 'scheduleId', 'facilityId', 'countryCode'];
  const missing = required.filter(key => !config[key]);

  if (missing.length > 0) {
    console.error(`Missing required environment variables: ${missing.map(k => k.replace(/[A-Z]/g, c => '_' + c).toUpperCase()).join(', ')}`);
    process.exit(1);
  }
}

export function getBaseUri(countryCode) {
  return `https://ais.usvisa-info.com/en-${countryCode}/niv`;
}
