import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Response } from 'node-fetch';
import { Bot, nextMaxDate } from '../src/lib/bot.js';
import { VisaHttpClient } from '../src/lib/client.js';

const config = { scheduleId: '1', facilityId: '56', ascFacilityId: '60', countryCode: 'br' };

function makeBot({ dates = [], ascDates = ['2026-10-27'], confirmed = true, overrides = {} } = {}) {
  const bot = new Bot({ ...config, ...overrides });
  const booked = [];
  bot.client = {
    checkAvailableDate: async (h, s, facilityId) => (facilityId === config.ascFacilityId ? ascDates : dates),
    checkAvailableTime: async () => '08:30',
    book: async (...args) => { booked.push(args); return confirmed; }
  };
  return { bot, booked };
}

test('ceiling steps down to the end of the previous month', () => {
  assert.equal(nextMaxDate('2026-11-10'), '2026-10-31');
  assert.equal(nextMaxDate('2026-10-28'), '2026-09-30');
  assert.equal(nextMaxDate('2027-01-15'), '2026-12-31');
});

test('picks the earliest date that is before current and within the ceiling', async () => {
  const { bot } = makeBot({ dates: ['2027-01-05', '2026-11-10', '2026-10-29', '2027-03-10'] });
  assert.equal(await bot.checkAvailableDate({}, '2027-03-04', undefined, '2026-11-30'), '2026-10-29');
});

test('ignores dates after the ceiling (January when only Oct/Nov count)', async () => {
  const { bot } = makeBot({ dates: ['2026-12-01', '2027-01-05'] });
  assert.equal(await bot.checkAvailableDate({}, '2027-03-04', undefined, '2026-11-30'), null);
});

test('without a max date any earlier date counts', async () => {
  const { bot } = makeBot({ dates: ['2027-03-01'] });
  assert.equal(await bot.checkAvailableDate({}, '2027-03-04', undefined, undefined), '2027-03-01');
});

test('without ASC_FACILITY_ID books the consulate only', async () => {
  const { bot, booked } = makeBot({ overrides: { ascFacilityId: undefined } });
  assert.equal(await bot.bookAppointment({}, '2026-11-10'), true);
  assert.equal(booked[0][5], null);
});

test('after booking November, another November date is ignored', async () => {
  const { bot } = makeBot({ dates: ['2026-11-05'] });
  assert.equal(await bot.checkAvailableDate({}, '2026-11-20', undefined, nextMaxDate('2026-11-20')), null);
});

test('refuses to book after the ceiling', async () => {
  const { bot, booked } = makeBot();
  assert.equal(await bot.bookAppointment({}, '2026-12-15', '2026-11-30'), false);
  assert.equal(booked.length, 0);
});

test('never books without an ASC (CASV) slot', async () => {
  const { bot, booked } = makeBot({ ascDates: [] });
  assert.equal(await bot.bookAppointment({}, '2026-11-10', '2026-11-30'), false);
  assert.equal(booked.length, 0);
});

test('books consulate and ASC together', async () => {
  const { bot, booked } = makeBot();
  assert.equal(await bot.bookAppointment({}, '2026-11-10', '2026-11-30'), true);
  assert.deepEqual(booked[0].slice(1, 6), ['1', '56', '2026-11-10', '08:30', { facilityId: '60', date: '2026-10-27', time: '08:30' }]);
});

test('exits with code 1 when the booking is not confirmed', async (t) => {
  t.mock.method(process, 'exit', (code) => { throw new Error(`exit ${code}`); });
  const { bot } = makeBot({ confirmed: false });
  await assert.rejects(bot.bookAppointment({}, '2026-11-10', '2026-11-30'), /exit 1/);
});

const page = (html, session) => new Response(
  `<html><head><meta name="csrf-token" content="tok-${session}"></head><body>${html}</body></html>`,
  { headers: { 'set-cookie': `_yatri_session=${session}; path=/` } }
);
const PICKER = '<input type="checkbox" name="applicants[]" value="111"><input type="checkbox" name="applicants[]" value="222">';
const FORM = '<select id="appointments_consulate_appointment_facility_id"></select>';

function makeClient(pages) {
  const client = new VisaHttpClient('br', 'e', 'p');
  const calls = { gets: [], post: null };
  client._anonymousRequest = async (url, headers) => {
    calls.gets.push({ url, cookie: headers.Cookie });
    return page(pages[calls.gets.length - 1], `s${calls.gets.length}`);
  };
  client._submitFormWithRedirect = async (url, headers, data) => {
    calls.post = { headers, data };
    return new Response('<p>You have successfully scheduled your visa appointment</p>');
  };
  return { client, calls };
}

test('group booking walks limit warning -> applicant picker -> form, then posts consulate + ASC', async () => {
  const { client, calls } = makeClient([PICKER, FORM]);

  const ok = await client.book({ Cookie: '_yatri_session=s0' }, '9', '56', '2026-11-10', '08:30', { facilityId: '60', date: '2026-10-27', time: '07:15' });

  assert.equal(ok, true);
  assert.match(calls.gets[0].url, /\/schedule\/9\/appointment\?confirmed_limit_message=1&commit=Continue$/);
  assert.equal(calls.gets[1].cookie, '_yatri_session=s1');
  assert.match(decodeURIComponent(calls.gets[1].url), /\/schedule\/9\/appointment\?applicants\[\]=111&applicants\[\]=222&confirmed_limit_message=1&commit=Continue$/);
  assert.equal(calls.post.headers.Cookie, '_yatri_session=s2');
  assert.equal(calls.post.data.authenticity_token, 'tok-s2');
  assert.equal(calls.post.data['appointments[consulate_appointment][date]'], '2026-11-10');
  assert.equal(calls.post.data['appointments[asc_appointment][facility_id]'], '60');
  assert.equal(calls.post.data['appointments[asc_appointment][date]'], '2026-10-27');
  assert.equal(calls.post.data['appointments[asc_appointment][time]'], '07:15');
});

test('never posts when the reschedule form is not reached', async () => {
  const { client, calls } = makeClient([PICKER, '<p>Sign in</p>']);
  const ok = await client.book({}, '9', '56', '2026-11-10', '08:30', { facilityId: '60', date: '2026-10-27', time: '07:15' });
  assert.equal(ok, false);
  assert.equal(calls.post, null);
});
