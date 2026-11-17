
'use strict';

const cfg = window.ZONE_CONFIG || {};
const configured =
  /^https:\/\//.test(cfg.SUPABASE_URL || '') &&
  /^(sb_publishable_|eyJ)/.test(cfg.SUPABASE_ANON_KEY || '');

const db = configured && window.supabase
  ? window.supabase.createClient(
      cfg.SUPABASE_URL,
      cfg.SUPABASE_ANON_KEY
    )
  : null;

let admin = false;
let families = [];
let events = [];
let assignments = [];
let results = [];
let rosters = [];
let publicNames = [];
let scoreboard = [];
let roomMatches = [];
let publicMatches = [];
let registrationOpen = true;

const $ = id => document.getElementById(id);

const esc = value =>
  String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));

const activeFamilies = () =>
  families.filter(f => f.is_active !== false);

const familyName = id =>
  !id
    ? 'مكان شاغر'
    : families.find(f => f.id === id)?.family ||
      'عائلة غير معروفة';

const familyLimit = f =>
  Number.isSafeInteger(Number(f?.max_participations)) &&
  Number(f?.max_participations) >= 0
    ? Number(f.max_participations)
    : 10;

const eventAssignments = id =>
  assignments.filter(a => a.event_id === id);

const eventMatches = id =>
  roomMatches
    .filter(m => m.event_id === id)
    .sort((a, b) =>
      a.round_number - b.round_number ||
      a.match_number - b.match_number
    );

const isQualified = id =>
  results.some(r =>
    r.first_family_id === id ||
    r.second_family_id === id
  );

const dateStr = date =>
  date
    ? new Date(date + 'T12:00:00')
        .toLocaleDateString('ar-SA', {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric'
        })
    : '';

function notify(message) {
  const el = $('feedback');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function show(id) {
  document.querySelectorAll('.section').forEach(el => {
    el.classList.toggle('active', el.id === id);
  });
  window.scrollTo(0, 0);
}

function showPage(id) {
  show(id);
  document.querySelectorAll('.nav-item').forEach(b => {
    b.classList.toggle(
      'active-nav',
      b.dataset.page === id
    );
  });
}

/* تحميل البيانات */

async function fetchAll() {
  if (!db) {
    return notify('تحقق من إعدادات Supabase في config.js');
  }

  try {
    const { data: session, error: authError } =
      await db.auth.getSession();

    if (authError) throw authError;

    admin = false;

    if (session.session) {
      const check = await db.rpc('is_zone_admin');
      admin = !check.error && check.data === true;
    }

    $('adminLogin').hidden = admin;
    $('adminTools').hidden = !admin;

    const queries = await Promise.all([
      db.from('public_family_names')
        .select('family')
        .order('family'),
      db.from('published_rosters').select('*'),
      db.from('public_scoreboard')
        .select('*')
        .order('event_date'),
      db.from('zone_settings')
        .select('*')
        .eq('id', true)
        .single(),
      db.from('public_room_matches')
        .select('*')
        .order('event_date')
        .order('round_number')
        .order('match_number')
    ]);

    for (const q of queries) {
      if (q.error) throw q.error;
    }

    publicNames = queries[0].data || [];
    rosters = queries[1].data || [];
    scoreboard = queries[2].data || [];
    registrationOpen =
      queries[3].data?.registration_open ?? true;
    publicMatches = queries[4].data || [];

    if (admin) {
      const privateQueries = await Promise.all([
        db.from('families')
          .select('*')
          .order('created_at'),
        db.from('events')
          .select('*')
          .order('event_date'),
        db.from('assignments').select('*'),
        db.from('results').select('*'),
        db.from('room_matches')
          .select('*')
          .order('round_number')
          .order('match_number')
      ]);

      for (const q of privateQueries) {
        if (q.error) throw q.error;
      }

      [
        families,
        events,
        assignments,
        results,
        roomMatches
      ] = privateQueries.map(q => q.data || []);
    } else {
      families = [];
      events = [];
      assignments = [];
      results = [];
      roomMatches = [];
    }

    render();
    displayPublicMatches();

  } catch (error) {
    notify('تعذر تحميل البيانات: ' + error.message);
  }
}

/* تسجيل العوائل */

$('registration').addEventListener('submit', async event => {
  event.preventDefault();

  if (!db || !registrationOpen) {
    return notify('التسجيل غير متاح حاليًا');
  }

  const form = new FormData(event.target);

  const row = {
    family: String(form.get('family') || '').trim(),
    family_id: String(form.get('familyId') || '').trim(),
    coordinator: String(form.get('coordinator') || '').trim(),
    coordinator_id: String(form.get('coordinatorId') || '').trim()
  };

  if (Object.values(row).some(value => !value)) {
    return notify('يرجى تعبئة جميع بيانات التسجيل');
  }

  const { error } = await db.from('families').insert(row);

  if (error) {
    return notify(
      error.code === '23505'
        ? 'آيدي العائلة مسجل مسبقًا'
        : 'تعذر التسجيل: ' + error.message
    );
  }

  event.target.reset();
  await fetchAll();
  showPage('families');
  notify('تم تسجيل العائلة في قائمة الانتظار بنجاح');
});

/* تسجيل الدخول */

$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();

  if (!db) {
    return notify('الاتصال بقاعدة البيانات غير متاح');
  }

  const form = new FormData(event.target);

  const { error } = await db.auth.signInWithPassword({
    email: String(form.get('email')),
    password: String(form.get('password'))
  });

  if (error) {
    return notify('تعذر الدخول: ' + error.message);
  }

  await fetchAll();

  if (!admin) {
    notify('هذا الحساب لا يملك صلاحية الإدارة');
  }
});

async function logout() {
  if (!db) return;
  await db.auth.signOut();
  await fetchAll();
}

/* إنشاء الرومات */

$('eventForm').addEventListener('submit', async event => {
  event.preventDefault();
  if (!admin) return;

  const form = new FormData(event.target);
  const date = String(form.get('date'));
  const day = new Date(date + 'T12:00:00').getDay();

  if (day !== 2 && day !== 3) {
    return notify('اختر يوم الثلاثاء أو الأربعاء');
  }

  const { error } = await db.from('events').insert({
    name: String(form.get('name') || '').trim(),
    event_date: date,
    event_time: String(form.get('time')),
    published: false
  });

  if (error) return notify(error.message);

  event.target.reset();
  await fetchAll();
  notify('تم إنشاء الروم بنجاح');
});

/* توزيع عائلة */

async function assign(familyId, eventId) {
  if (!admin || !eventId) return;

  const family = families.find(f => f.id === familyId);
  const room = events.find(e => e.id === eventId);

  if (!family || family.is_active === false) {
    return notify('العائلة غير نشطة');
  }

  if (!room || room.published) {
    return notify('يجب أن يكون الروم مخفيًا');
  }

  if (eventMatches(eventId).length) {
    return notify('تم إنشاء مواجهات هذا الروم');
  }

  const used = assignments.filter(a =>
    a.family_id === familyId
  );

  if (used.length >= familyLimit(family)) {
    return notify('العائلة استنفدت فرص مشاركتها');
  }

  if (isQualified(familyId)) {
    return notify('العائلة متأهلة بالفعل');
  }

  if (eventAssignments(eventId).length >= 8) {
    return notify('الروم مكتمل');
  }

  if (used.some(a => a.event_id === eventId)) {
    return notify('العائلة موجودة بالفعل في الروم');
  }

  const { error } = await db.from('assignments').insert({
    family_id: familyId,
    event_id: eventId
  });

  if (error) {
    return notify('تعذر التوزيع: ' + error.message);
  }

  await fetchAll();
  notify('تم توزيع العائلة');
}

/* القرعة */

async function randomDraw(eventId) {
  if (!admin) return;

  const room = events.find(e => e.id === eventId);

  if (!room || room.published) {
    return notify('يجب إخفاء الروم قبل إجراء القرعة');
  }

  if (
    eventAssignments(eventId).length ||
    eventMatches(eventId).length
  ) {
    return notify('الروم يحتوي على توزيع أو مواجهات مسبقة');
  }

  if (!confirm(
    'إجراء قرعة عشوائية لاختيار 8 عوائل وإنشاء المواجهات؟'
  )) return;

  const { data, error } = await db.rpc(
    'zone_random_draw',
    { p_event_id: eventId }
  );

  if (error) {
    return notify('تعذرت القرعة: ' + error.message);
  }

  await fetchAll();
  notify('نجحت القرعة واختيرت ' + data + ' عوائل');
}

/* إزالة من الروم */

async function unassign(familyId, eventId) {
  if (!admin) return;

  const room = events.find(e => e.id === eventId);

  if (room?.published) {
    return notify('أخفِ الروم قبل تعديل توزيعه');
  }

  if (eventMatches(eventId).length) {
    return notify('استخدم تعديل مواجهات دور الثمانية');
  }

  if (results.some(r => r.event_id === eventId)) {
    return notify('الروم لديه نتيجة معتمدة');
  }

  const { error } = await db.from('assignments')
    .delete()
    .eq('family_id', familyId)
    .eq('event_id', eventId);

  if (error) return notify(error.message);

  await fetchAll();
}

/* نشر الروم */

async function publishRoom(id, published) {
  if (!admin) return;

  if (published && eventAssignments(id).length !== 8) {
    return notify('يجب وجود 8 عوائل قبل نشر الروم');
  }

  if (published && eventMatches(id).length !== 7) {
    return notify('يجب إنشاء جدول المواجهات قبل نشر الروم');
  }

  if (
    published &&
    eventMatches(id)
      .filter(m => m.round_number === 1)
      .some(m => !m.first_family_id || !m.second_family_id)
  ) {
    return notify('هناك مكان شاغر في دور الثمانية');
  }

  const { error } = await db.from('events')
    .update({ published })
    .eq('id', id);

  if (error) return notify(error.message);

  await fetchAll();
  notify(published ? 'تم نشر الروم' : 'تم إخفاء الروم');
}

/* اعتماد الفائز */

async function setMatchWinner(matchId, winnerId) {
  if (!admin) return;

  const match = roomMatches.find(m => m.id === matchId);

  if (!match) return notify('المواجهة غير موجودة');
  if (!winnerId) return notify('اختر العائلة الفائزة');

  if (!match.first_family_id || !match.second_family_id) {
    return notify('لم يكتمل طرفا المواجهة');
  }

  if (![
    match.first_family_id,
    match.second_family_id
  ].includes(winnerId)) {
    return notify('الفائز ليس أحد طرفَي المواجهة');
  }

  if (
    match.winner_family_id &&
    match.winner_family_id !== winnerId
  ) {
    return notify('استخدم زر تعديل الفائز');
  }

  if (!confirm(
    'اعتماد فوز ' + familyName(winnerId) + '؟'
  )) return;

  const { error } = await db.rpc(
    'zone_set_match_winner',
    {
      p_match_id: matchId,
      p_winner_id: winnerId
    }
  );

  if (error) {
    return notify('تعذر اعتماد الفائز: ' + error.message);
  }

  await fetchAll();

  notify(
    match.round_number === 3
      ? 'تم اعتماد بطل النهائي. اعتمد مقاعد التأهل الآن.'
      : 'تم اعتماد الفائز وترحيله للدور التالي'
  );
}

/* تعديل الفائز بعد الاعتماد */

async function zoneCorrectWinner(matchId) {
  if (!admin || !db) {
    return notify('ليس لديك صلاحية الإدارة');
  }

  const match = roomMatches.find(m => m.id === matchId);

  if (!match || !match.winner_family_id) {
    return notify('لا توجد نتيجة معتمدة لتعديلها');
  }

  const candidates = [
    match.first_family_id,
    match.second_family_id
  ].filter(Boolean);

  if (candidates.length !== 2) {
    return notify('أطراف المواجهة غير مكتملة');
  }

  const replacement = candidates.find(
    id => id !== match.winner_family_id
  );

  if (!replacement) {
    return notify('تعذر تحديد الفائز البديل');
  }

  const existing = results.some(
    r => r.event_id === match.event_id
  );

  if (existing) {
    return notify(
      'هذا الروم اعتمدت مقاعد تأهله؛ يجب تصحيح التأهل أولًا'
    );
  }

  const next = eventMatches(match.event_id).find(m =>
    m.round_number === match.round_number + 1 &&
    m.match_number === Math.ceil(match.match_number / 2)
  );

  if (next?.winner_family_id) {
    return notify(
      'الدور التالي لديه فائز معتمد؛ يجب تصحيحه أولًا'
    );
  }

  if (!confirm(
    'تصحيح الفائز؟\n' +
    'السابق: ' + familyName(match.winner_family_id) +
    '\nالجديد: ' + familyName(replacement)
  )) return;

  const scroll = window.scrollY;

  const { error } = await db.rpc(
    'zone_admin_correct_winner',
    {
      p_match_id: matchId,
      p_winner_id: replacement
    }
  );

  if (error) {
    return notify('تعذر تعديل النتيجة: ' + error.message);
  }

  await fetchAll();

  notify('تم تصحيح الفائز وتحديث المتأهل للدور التالي');

  requestAnimationFrame(() => {
    window.scrollTo({
      top: scroll,
      left: 0,
      behavior: 'auto'
    });
  });
}

/* اعتماد التأهل */

async function saveResult(eventId) {
  if (!admin) return;

  const final = eventMatches(eventId).find(m =>
    m.round_number === 3 &&
    m.match_number === 1
  );

  if (!final) {
    return notify('لا يوجد جدول نهائي لهذا الروم');
  }

  if (!final.winner_family_id) {
    return notify('اعتمد الفائز في النهائي أولًا');
  }

  const first = final.winner_family_id;
  const second =
    first === final.first_family_id
      ? final.second_family_id
      : final.first_family_id;

  if (!second) {
    return notify('لا يمكن تحديد الوصيف');
  }

  const existing = results.find(r => r.event_id === eventId);

  if (!existing && results.length >= 32) {
    return notify('اكتملت مقاعد البطولة');
  }

  if (results.some(r =>
    r.event_id !== eventId &&
    [r.first_family_id, r.second_family_id].some(id =>
      id === first || id === second
    )
  )) {
    return notify('إحدى العائلتين حصلت على مقعد تأهل سابقًا');
  }

  if (!confirm(
    'اعتماد النتيجة النهائية؟\n' +
    'الفائز: ' + familyName(first) + '\n' +
    'الوصيف: ' + familyName(second)
  )) return;

  const { error } = await db.from('results').upsert({
    event_id: eventId,
    first_family_id: first,
    second_family_id: second
  }, {
    onConflict: 'event_id'
  });

  if (error) return notify(error.message);

  await fetchAll();
  notify('تم اعتماد الفائز والوصيف وإضافة مقاعد التأهل');
}

/* فتح وإغلاق التسجيل */

async function toggleRegistration() {
  if (!admin) return;

  const { error } = await db.from('zone_settings')
    .update({
      registration_open: !registrationOpen
    })
    .eq('id', true);

  if (error) return notify(error.message);

  await fetchAll();
}

/* إضافة عائلة */

async function addFamily() {
  if (!admin) return;

  const family = prompt('اسم العائلة');
  if (!family?.trim()) return;

  const family_id = prompt('آيدي العائلة');
  if (!family_id?.trim()) return;

  const coordinator = prompt('اسم المنسق');
  if (!coordinator?.trim()) return;

  const coordinator_id = prompt('آيدي المنسق');
  if (!coordinator_id?.trim()) return;

  const { error } = await db.from('families').insert({
    family: family.trim(),
    family_id: family_id.trim(),
    coordinator: coordinator.trim(),
    coordinator_id: coordinator_id.trim()
  });

  if (error) return notify(error.message);

  await fetchAll();
}

/* تعديل بيانات عائلة */

async function editFamily(id) {
  if (!admin) return;

  const f = families.find(f => f.id === id);
  if (!f) return;

  const family = prompt('اسم العائلة', f.family);
  if (family === null) return;

  const family_id = prompt('آيدي العائلة', f.family_id);
  if (family_id === null) return;

  const coordinator = prompt(
    'اسم المنسق', f.coordinator || ''
  );
  if (coordinator === null) return;

  const coordinator_id = prompt(
    'آيدي المنسق', f.coordinator_id || ''
  );
  if (coordinator_id === null) return;

  if (![family, family_id, coordinator, coordinator_id]
    .every(x => x.trim())) {
    return notify('جميع الحقول مطلوبة');
  }

  const { error } = await db.from('families').update({
    family: family.trim(),
    family_id: family_id.trim(),
    coordinator: coordinator.trim(),
    coordinator_id: coordinator_id.trim()
  }).eq('id', id);

  if (error) return notify(error.message);

  await fetchAll();
}

/* تعديل فرص العائلة */

async function zoneSetLimit(id) {
  if (!admin) return;

  const f = families.find(f => f.id === id);
  if (!f) return notify('العائلة غير موجودة');

  const raw = prompt(
    'كم عدد فرص المشاركة لعائلة ' + f.family + '؟',
    String(familyLimit(f))
  );

  if (raw === null) return;

  const value = Number(raw.trim());

  if (
    !raw.trim() ||
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    return notify('اكتب عددًا صحيحًا من صفر فأعلى');
  }

  const { error } = await db.rpc(
    'zone_admin_set_family_limit',
    {
      p_family_id: id,
      p_limit: value
    }
  );

  if (error) {
    return notify('تعذر تغيير الفرص: ' + error.message);
  }

  await fetchAll();

  notify(
    'تم تحديد ' + value + ' فرصة لعائلة ' + f.family
  );
}

/* سحب العائلة */

async function deleteFamily(id) {
  if (!admin) return;

  const f = families.find(f => f.id === id);
  if (!f) return notify('العائلة غير موجودة');

  if (!confirm(
    'سحب عائلة «' + f.family +
    '» نهائيًا من التسجيل والقرعات القادمة؟\n' +
    'ستبقى النتائج السابقة محفوظة.'
  )) return;

  const { error } = await db.rpc(
    'zone_admin_withdraw_family',
    { p_family_id: id }
  );

  if (error) {
    return notify('تعذر سحب العائلة: ' + error.message);
  }

  await fetchAll();
  notify('تم سحب العائلة من التسجيل والقرعات القادمة');
}

/* تعديل الروم */

async function editRoom(id) {
  if (!admin) return;

  const room = events.find(e => e.id === id);
  if (!room) return;

  const name = prompt('اسم الروم', room.name);
  if (name === null) return;

  const time = prompt(
    'الوقت HH:MM',
    String(room.event_time).slice(0, 5)
  );
  if (time === null) return;

  if (
    !name.trim() ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)
  ) {
    return notify('تحقق من الاسم وصيغة الوقت');
  }

  const { error } = await db.from('events').update({
    name: name.trim(),
    event_time: time
  }).eq('id', id);

  if (error) return notify(error.message);

  await fetchAll();
}

/* حذف الروم */

async function deleteRoom(id) {
  if (!admin) return;

  const room = events.find(e => e.id === id);
  if (!room) return notify('الروم غير موجود');

  if (results.some(r => r.event_id === id)) {
    return notify('لا يمكن حذف روم لديه مقاعد تأهل معتمدة');
  }

  if (!confirm(
    'هل تريد حذف الروم «' + room.name +
    '» نهائيًا؟\n' +
    'سيتم حذف جميع مواجهاته وتوزيعاته.'
  )) return;

  const { error } = await db.rpc(
    'zone_admin_delete_room',
    { p_event_id: id }
  );

  if (error) {
    return notify('تعذر حذف الروم: ' + error.message);
  }

  await fetchAll();
  notify('تم حذف الروم ومواجهاته وتوزيعه');
}

/* تعديل طرفَي المواجهة */

async function zoneSaveTeams(matchId, firstId, secondId) {
  if (!admin) return;

  if (!firstId || !secondId || firstId === secondId) {
    return notify('اختر عائلتين مختلفتين');
  }

  const match = roomMatches.find(m => m.id === matchId);
  if (!match) return notify('المواجهة غير موجودة');

  if (!confirm(
    'حفظ طرفَي المواجهة؟\n' +
    familyName(firstId) + '\nضد\n' +
    familyName(secondId)
  )) return;

  const scroll = window.scrollY;

  const { error } = await db.rpc(
    'zone_admin_edit_match',
    {
      p_match_id: matchId,
      p_first_id: firstId,
      p_second_id: secondId
    }
  );

  if (error) {
    return notify('تعذر تعديل المواجهة: ' + error.message);
  }

  await fetchAll();
  notify('تم حفظ العائلتين وتحديث المواجهة');

  requestAnimationFrame(() => {
    window.scrollTo({
      top: scroll,
      left: 0,
      behavior: 'auto'
    });
  });
}

/* حفظ حالة القوائم المفتوحة */

function preserveDetails() {
  const map = new Map();

  document.querySelectorAll(
    'details[data-room-key]'
  ).forEach(d => {
    map.set(d.dataset.roomKey, d.open);
  });

  return map;
}

function detailsHTML(key, title, body, state) {
  return (
    '<details class="zone-accordion" data-room-key="' +
    esc(key) + '"' +
    (state.get(key) ? ' open' : '') +
    '><summary>' + esc(title) + '</summary>' +
    '<div class="zone-accordion-body">' +
    body +
    '</div></details>'
  );
}

/* عرض الموقع */

function render() {
  $('registered').textContent = publicNames.length;

  const publicIds = new Set([
    ...rosters.map(r => r.event_id),
    ...publicMatches.map(m => m.event_id)
  ]);

  $('eventCount').textContent =
    admin ? events.length : publicIds.size;

  const first = scoreboard.filter(r => r.first_family);
  const second = scoreboard.filter(r => r.second_family);

  const firstCount = admin ? results.length : first.length;
  const secondCount = admin ? results.length : second.length;

  $('qualified').textContent = firstCount + secondCount;
  $('mainCount').textContent = firstCount + '/32 مقعد';
  $('secondCount').textContent = secondCount + '/32 مقعد';

  $('mainRemaining').textContent =
    Math.max(0, 32 - firstCount);

  $('secondRemaining').textContent =
    Math.max(0, 32 - secondCount);

  $('mainSeats').innerHTML =
    first.map((r, i) =>
      '<div class="team">' +
      (i + 1) + '. ' +
      esc(r.first_family) +
      '</div>'
    ).join('') ||
    '<p class="muted">لم تُنشر نتائج بعد</p>';

  $('secondSeats').innerHTML =
    second.map((r, i) =>
      '<div class="team">' +
      (i + 1) + '. ' +
      esc(r.second_family) +
      '</div>'
    ).join('') ||
    '<p class="muted">لم تُنشر نتائج بعد</p>';

  $('publicFamilies').innerHTML =
    publicNames.map((f, i) =>
      '<div class="team"><b>' +
      (i + 1) + '. ' +
      esc(f.family) +
      '</b></div>'
    ).join('') ||
    '<p class="muted">لا توجد عوائل مسجلة</p>';

  $('registration').hidden = !registrationOpen;
  $('registerButton').disabled = !registrationOpen;

  const publicEvents = new Map();

  for (const row of rosters) {
    if (!publicEvents.has(row.event_id)) {
      publicEvents.set(row.event_id, {
        name: row.name || 'روم',
        event_date: row.event_date,
        event_time: row.event_time,
        names: []
      });
    }

    publicEvents.get(row.event_id).names.push(row.family);
  }

  for (const match of publicMatches) {
    if (!publicEvents.has(match.event_id)) {
      publicEvents.set(match.event_id, {
        name: match.room_name,
        event_date: match.event_date,
        event_time: match.event_time,
        names: []
      });
    }
  }

  $('eventList').innerHTML =
    [...publicEvents.values()].map(room => {
      const names = [
        ...new Set(room.names.filter(Boolean))
      ];

      return (
        '<div class="panel" style="margin:15px 0">' +
        '<h2>' + esc(room.name) + '</h2>' +
        '<p class="muted">' +
        esc(room.event_date) + ' • ' +
        esc(String(room.event_time || '').slice(0, 5)) +
        '</p>' +
        (
          names.map((name, i) =>
            '<div class="team">' +
            (i + 1) + '. ' + esc(name) +
            '</div>'
          ).join('') ||
          '<p class="muted">المواجهات متاحة في جدول المواجهات</p>'
        ) +
        '<button onclick="showPage(\'matches\')">' +
        'عرض المواجهات</button></div>'
      );
    }).join('') ||
    '<p class="muted">لا توجد رومات منشورة حاليًا</p>';

  if (!admin) return;

  $('registrationState').textContent =
    registrationOpen
      ? 'التسجيل مفتوح'
      : 'التسجيل مغلق';

  const state = preserveDetails();

  /* العوائل */

  $('requests').innerHTML =
    activeFamilies().map(f => {
      const used = assignments.filter(a =>
        a.family_id === f.id
      );

      const limit = familyLimit(f);
      const qualified = isQualified(f.id);

      const options = events
        .filter(room =>
          !room.published &&
          !eventMatches(room.id).length
        )
        .map(room =>
          '<option value="' + room.id + '">' +
          esc(room.name) + ' — ' +
          esc(room.event_date) + ' (' +
          eventAssignments(room.id).length +
          '/8)</option>'
        ).join('');

      return (
        '<div class="team">' +
        '<div><b>' + esc(f.family) + '</b>' +
        '<br><small>آيدي العائلة: ' +
        esc(f.family_id) +
        ' | المنسق: ' +
        esc(f.coordinator) +
        ' | آيدي المنسق: ' +
        esc(f.coordinator_id) +
        '</small>' +
        '<br><small>المشاركات: ' +
        used.length + '/' + limit +
        (qualified ? ' • متأهلة' : '') +
        '</small>' +
        '<br><small>' +
        (
          used.map(a =>
            esc(
              events.find(e => e.id === a.event_id)
                ?.name || 'روم'
            )
          ).join('، ') || 'في الانتظار'
        ) +
        '</small></div>' +
        '<div class="team-actions">' +
        '<select id="assign_' + f.id + '">' +
        '<option value="">اختر الروم</option>' +
        options +
        '</select>' +
        '<button ' +
        (qualified || used.length >= limit
          ? 'disabled'
          : '') +
        ' onclick="assign(\'' + f.id +
        '\',$(\'assign_' + f.id +
        '\').value)">توزيع</button>' +
        '<button class="secondary" onclick="editFamily(\'' +
        f.id + '\')">تعديل البيانات</button>' +
        '<button class="secondary" onclick="zoneSetLimit(\'' +
        f.id + '\')">تعديل الفرص (' +
        limit + ')</button>' +
        '<button class="danger" onclick="deleteFamily(\'' +
        f.id + '\')">سحب العائلة نهائيًا</button>' +
        used.filter(a => {
          const room = events.find(e => e.id === a.event_id);

          return (
            !room?.published &&
            !eventMatches(a.event_id).length
          );
        }).map(a =>
          '<button class="secondary" onclick="unassign(\'' +
          f.id + '\',\'' + a.event_id +
          '\')">إزالة من الروم</button>'
        ).join('') +
        '</div></div>'
      );
    }).join('') ||
    '<p class="muted">لا توجد عوائل مسجلة</p>';

  /* الرومات */

  $('roomControls').innerHTML =
    events.map(room => {
      const count = eventAssignments(room.id).length;
      const matches = eventMatches(room.id);

      const body =
        '<div class="team">' +
        '<div><small>' +
        esc(String(room.event_time || '').slice(0, 5)) +
        ' • ' + count + '/8 عوائل • ' +
        matches.length + '/7 مواجهات</small></div>' +
        '<div class="team-actions">' +
        '<button class="secondary" ' +
        (
          room.published || count || matches.length
            ? 'disabled'
            : ''
        ) +
        ' onclick="randomDraw(\'' + room.id +
        '\')">قرعة عشوائية</button>' +
        '<button onclick="publishRoom(\'' +
        room.id + '\',' + (!room.published) + ')">' +
        (room.published ? 'إخفاء' : 'نشر') +
        '</button>' +
        '<button class="secondary" onclick="editRoom(\'' +
        room.id + '\')">تعديل الروم</button>' +
        '<button class="danger" onclick="deleteRoom(\'' +
        room.id + '\')">حذف الروم</button>' +
        '</div></div>' +
        (
          count
            ? '<h3>العوائل الموزعة</h3>' +
              eventAssignments(room.id).map((a, i) =>
                '<div class="team">' +
                (i + 1) + '. ' +
                esc(familyName(a.family_id)) +
                '</div>'
              ).join('')
            : '<p class="muted">لم توزع عوائل بعد</p>'
        );

      return detailsHTML(
        'room-' + room.id,
        room.name + ' — ' + room.event_date +
        ' • ' + (room.published ? 'منشور' : 'مخفي'),
        body,
        state
      );
    }).join('') ||
    '<p class="muted">لم يتم إنشاء رومات بعد</p>';

  renderMatchFamilyEditor(state);
  renderAdminMatches(state);
}

/* تعديل مواجهات دور الثمانية */

function renderMatchFamilyEditor(state) {
  $('matchFamilyEditor').innerHTML =
    events.map(room => {
      const matches = eventMatches(room.id)
        .filter(m => m.round_number === 1);

      const locked =
        eventMatches(room.id).some(m =>
          Boolean(m.winner_family_id)
        ) ||
        results.some(r => r.event_id === room.id);

      const optionList = activeFamilies().map(f =>
        '<option value="' + f.id + '">' +
        esc(f.family) +
        '</option>'
      ).join('');

      const select = (id, slot, selected) =>
        '<select id="' + slot + '_' + id + '" ' +
        (locked ? 'disabled' : '') + '>' +
        '<option value="">اختر العائلة</option>' +
        optionList +
        (
          selected &&
          !activeFamilies().some(f => f.id === selected)
            ? '<option value="' + selected + '">' +
              esc(familyName(selected)) +
              '</option>'
            : ''
        ) +
        '</select>';

      const body =
        (
          locked
            ? '<p class="muted">' +
              'هذا الروم بدأت نتائجه؛ التعديل مقفل لحماية النتائج.' +
              '</p>'
            : ''
        ) +
        (
          matches.map(m =>
            '<div class="zone-editor-card">' +
            '<h3>المواجهة ' +
            m.match_number + '</h3>' +
            '<label>العائلة الأولى' +
            select(
              m.id,
              'first',
              m.first_family_id
            ) +
            '</label>' +
            '<label>العائلة الثانية' +
            select(
              m.id,
              'second',
              m.second_family_id
            ) +
            '</label>' +
            '<button ' +
            (locked ? 'disabled' : '') +
            ' onclick="zoneSaveTeams(\'' +
            m.id +
            '\',$(\'first_' + m.id +
            '\').value,$(\'second_' + m.id +
            '\').value)">' +
            'حفظ طرفَي المواجهة</button>' +
            '</div>'
          ).join('') ||
          '<p class="muted">لم تُنشأ مواجهات لهذا الروم</p>'
        );

      return detailsHTML(
        'edit-' + room.id,
        room.name + ' — ' + room.event_date,
        body,
        state
      );
    }).join('') ||
    '<p class="muted">لا توجد رومات</p>';

  for (const m of roomMatches.filter(m =>
    m.round_number === 1
  )) {
    const first = $('first_' + m.id);
    const second = $('second_' + m.id);

    if (first) first.value = m.first_family_id || '';
    if (second) second.value = m.second_family_id || '';
  }
}

/* نتائج المواجهات مع زر التعديل */

function renderAdminMatches(state) {
  const titles = {
    1: 'دور الثمانية',
    2: 'نصف النهائي',
    3: 'النهائي'
  };

  $('resultControls').innerHTML =
    events.map(room => {
      const matches = eventMatches(room.id);

      const final = matches.find(m =>
        m.round_number === 3 &&
        m.match_number === 1
      );

      const result = results.find(r =>
        r.event_id === room.id
      );

      const rounds = [1, 2, 3].map(round =>
        '<div class="round">' +
        '<h3>' + titles[round] + '</h3>' +
        matches.filter(m =>
          m.round_number === round
        ).map(m => {
          const first = m.first_family_id
            ? familyName(m.first_family_id)
            : round === 1
              ? 'مكان شاغر'
              : 'بانتظار المتأهل';

          const second = m.second_family_id
            ? familyName(m.second_family_id)
            : round === 1
              ? 'مكان شاغر'
              : 'بانتظار المتأهل';

          const options =
            '<option value="">اختر الفائز</option>' +
            (
              m.first_family_id
                ? '<option value="' +
                  m.first_family_id + '">' +
                  esc(first) + '</option>'
                : ''
            ) +
            (
              m.second_family_id
                ? '<option value="' +
                  m.second_family_id + '">' +
                  esc(second) + '</option>'
                : ''
            );

          const canCorrect =
            Boolean(m.winner_family_id) && !result;

          return (
            '<div class="match">' +
            '<b>المواجهة ' + m.match_number + '</b>' +
            '<div>' + esc(first) + '</div>' +
            '<div>ضد</div>' +
            '<div>' + esc(second) + '</div>' +
            (
              m.winner_family_id
                ? '<p class="tag">الفائز: ' +
                  esc(familyName(m.winner_family_id)) +
                  '</p>' +
                  (
                    canCorrect
                      ? '<button class="secondary" ' +
                        'onclick="zoneCorrectWinner(\'' +
                        m.id +
                        '\')">تعديل الفائز</button>'
                      : '<p class="muted">' +
                        'التأهل معتمد؛ تعديل الفائز مقفل لحماية المقاعد' +
                        '</p>'
                  )
                : m.first_family_id &&
                  m.second_family_id
                  ? '<select id="winner_' +
                    m.id + '">' +
                    options +
                    '</select>' +
                    '<button onclick="setMatchWinner(\'' +
                    m.id +
                    '\',$(\'winner_' + m.id +
                    '\').value)">اعتماد الفائز</button>'
                  : '<p class="muted">' +
                    'بانتظار اكتمال المواجهة</p>'
            ) +
            '</div>'
          );
        }).join('') +
        '</div>'
      ).join('');

      const body =
        (
          matches.length
            ? '<div class="rounds">' +
              rounds + '</div>'
            : '<p class="muted">' +
              'لم تُنشأ مواجهات لهذا الروم بعد.</p>'
        ) +
        (
          result
            ? '<p class="tag">تم اعتماد النتيجة: ' +
              esc(familyName(result.first_family_id)) +
              ' — الوصيف: ' +
              esc(familyName(result.second_family_id)) +
              '</p>'
            : final?.winner_family_id
              ? '<button onclick="saveResult(\'' +
                room.id +
                '\')">اعتماد الفائز والوصيف للتأهل</button>'
              : '<p class="muted">' +
                'اعتمد نتائج المواجهات حتى النهائي، ثم مقاعد التأهل.' +
                '</p>'
        );

      return detailsHTML(
        'result-' + room.id,
        room.name + ' — ' + room.event_date,
        body,
        state
      );
    }).join('') ||
    '<p class="muted">لا توجد رومات بعد</p>';
}

/* جدول المواجهات العام */

function displayPublicMatches() {
  const container = $('publicMatches');
  if (!container) return;

  container.replaceChildren();

  if (!publicMatches.length) {
    container.innerHTML =
      '<p class="muted">لم تُنشر جداول المواجهات بعد.</p>';
    return;
  }

  const groups = new Map();

  for (const m of publicMatches) {
    if (!groups.has(m.event_id)) {
      groups.set(m.event_id, []);
    }

    groups.get(m.event_id).push(m);
  }

  const roundNames = {
    1: 'دور الثمانية',
    2: 'نصف النهائي',
    3: 'النهائي'
  };

  for (const matches of groups.values()) {
    const firstMatch = matches[0];
    const title = document.createElement('h2');

    title.textContent =
      firstMatch.room_name + ' — ' +
      dateStr(firstMatch.event_date) +
      ' • ' +
      String(firstMatch.event_time || '').slice(0, 5);

    title.style.cssText =
      'text-align:center;color:#ff5962;margin:18px 0 10px';

    container.appendChild(title);

    const scroll = document.createElement('div');

    scroll.style.cssText =
      'width:100%;overflow-x:auto;' +
      '-webkit-overflow-scrolling:touch;padding-bottom:12px';

    const stage = document.createElement('div');

    stage.style.cssText =
      'position:relative;width:650px;height:400px;' +
      'direction:ltr;margin:auto';

    const positions = [
      [78, 158, 238, 318],
      [118, 278],
      [198]
    ];

    const x = [8, 235, 462];
    const width = 180;
    const height = 68;
    const ns = 'http://www.w3.org/2000/svg';

    const svg = document.createElementNS(ns, 'svg');

    svg.setAttribute('width', '650');
    svg.setAttribute('height', '400');
    svg.setAttribute('viewBox', '0 0 650 400');

    svg.style.cssText =
      'position:absolute;inset:0;pointer-events:none';

    function line(x1, y1, x2, y2) {
      const e = document.createElementNS(ns, 'line');

      for (const [key, value] of Object.entries({
        x1,
        y1,
        x2,
        y2,
        stroke: '#8b4556',
        'stroke-width': '1.5'
      })) {
        e.setAttribute(key, value);
      }

      svg.appendChild(e);
    }

    for (let round = 0; round < 2; round++) {
      const startX = x[round] + width;
      const endX = x[round + 1];
      const middleX = (startX + endX) / 2;

      for (
        let i = 0;
        i < positions[round + 1].length;
        i++
      ) {
        const y1 = positions[round][i * 2];
        const y2 = positions[round][i * 2 + 1];
        const target = positions[round + 1][i];

        line(startX, y1, middleX, y1);
        line(startX, y2, middleX, y2);
        line(middleX, y1, middleX, y2);
        line(middleX, target, endX, target);
      }
    }

    stage.appendChild(svg);

    for (let r = 0; r < 3; r++) {
      const round = r + 1;
      const heading = document.createElement('div');

      heading.textContent = roundNames[round];

      heading.style.cssText =
        'position:absolute;left:' + x[r] +
        'px;top:10px;width:' + width +
        'px;text-align:center;font-size:13px;' +
        'font-weight:bold;color:#e3a8b2';

      stage.appendChild(heading);

      for (let i = 0; i < positions[r].length; i++) {
        const m = matches.find(m =>
          Number(m.round_number) === round &&
          Number(m.match_number) === i + 1
        );

        const first = m?.first_family ||
          (round === 1
            ? 'مكان شاغر'
            : 'بانتظار المتأهل');

        const second = m?.second_family ||
          (round === 1
            ? 'مكان شاغر'
            : 'بانتظار المتأهل');

        const winner = m?.winner_family || '';

        const card = document.createElement('div');

        card.style.cssText =
          'position:absolute;left:' + x[r] +
          'px;top:' + (positions[r][i] - height / 2) +
          'px;width:' + width +
          'px;height:' + height +
          'px;background:#21141a;' +
          'border:1px solid #8d4657;' +
          'border-radius:9px;color:white;' +
          'display:flex;flex-direction:column;' +
          'justify-content:center;align-items:center;' +
          'gap:2px;padding:5px;direction:rtl;' +
          'text-align:center;overflow-wrap:anywhere;' +
          'box-shadow:0 5px 15px #0006';

        const elements = [
          [
            'م ' + (i + 1),
            'font-size:8px;color:#c998a4'
          ],
          [
            (winner && winner === first ? '🏆 ' : '') +
              first,
            'font-size:10px;font-weight:bold'
          ],
          [
            'VS',
            'font-size:8px;color:#ff6572'
          ],
          [
            (winner && winner === second ? '🏆 ' : '') +
              second,
            'font-size:10px;font-weight:bold'
          ]
        ];

        for (const [content, css] of elements) {
          const e = document.createElement('div');
          e.textContent = content;
          e.style.cssText = css;
          card.appendChild(e);
        }

        stage.appendChild(card);
      }
    }

    scroll.appendChild(stage);
    container.appendChild(scroll);
  }
}

/* تشغيل الموقع */

fetchAll();
