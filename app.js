
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

function notify(message) {
  const el = $('feedback');
  if (!el) return;
  el.textContent = message;
  el.hidden = false;
  window.scrollTo(0, 0);
}

function show(id) {
  document.querySelectorAll('.section').forEach(el => {
    el.classList.toggle('active', el.id === id);
  });
  window.scrollTo(0, 0);
}

function dateStr(date) {
  if (!date) return '';
  return new Date(date + 'T12:00:00')
    .toLocaleDateString('ar-SA', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
}

function familyName(id) {
  return families.find(f => f.id === id)?.family || 'عائلة غير معروفة';
}

function eventAssignments(eventId) {
  return assignments.filter(a => a.event_id === eventId);
}

function eventMatches(eventId) {
  return roomMatches
    .filter(m => m.event_id === eventId)
    .sort((a, b) =>
      a.round_number - b.round_number ||
      a.match_number - b.match_number
    );
}

function isQualified(familyId) {
  return results.some(r =>
    r.first_family_id === familyId ||
    r.second_family_id === familyId
  );
}

async function fetchAll() {
  if (!db) {
    notify('تحقق من إعدادات Supabase في config.js');
    return;
  }

  try {
    const { data: sessionData, error: sessionError } =
      await db.auth.getSession();

    if (sessionError) throw sessionError;

    admin = false;

    if (sessionData.session) {
      const check = await db.rpc('is_zone_admin');
      admin = !check.error && check.data === true;
    }

    $('adminLogin').hidden = admin;
    $('adminTools').hidden = !admin;

    const queries = await Promise.all([
      db.from('public_family_names')
        .select('family')
        .order('family'),

      db.from('published_rosters')
        .select('*'),

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

        db.from('assignments')
          .select('*'),

        db.from('results')
          .select('*'),

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
  show('families');
  notify('تم تسجيل العائلة في قائمة الانتظار بنجاح');
});

$('loginForm').addEventListener('submit', async event => {
  event.preventDefault();

  if (!db) return notify('الاتصال بقاعدة البيانات غير متاح');

  const form = new FormData(event.target);

  const { error } = await db.auth.signInWithPassword({
    email: String(form.get('email')),
    password: String(form.get('password'))
  });

  if (error) return notify('تعذر الدخول: ' + error.message);

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

async function assign(familyId, eventId) {
  if (!admin || !eventId) return;

  const ev = events.find(e => e.id === eventId);

  if (!ev || ev.published) {
    return notify('يجب أن يكون الروم مخفيًا');
  }

  if (eventMatches(eventId).length) {
    return notify('تم إنشاء مواجهات هذا الروم، ولا يمكن تعديل توزيعه مباشرة');
  }

  const used = assignments.filter(a => a.family_id === familyId);

  if (used.length >= 6) {
    return notify('استنفدت العائلة مشاركاتها الست');
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

  if (error) return notify(error.message);

  await fetchAll();
}

async function randomDraw(eventId) {
  if (!admin) return;

  const ev = events.find(e => e.id === eventId);

  if (!ev || ev.published) {
    return notify('يجب إخفاء الروم قبل إجراء القرعة');
  }

  if (
    eventAssignments(eventId).length ||
    eventMatches(eventId).length
  ) {
    return notify('الروم يحتوي على توزيع أو مواجهات مسبقة');
  }

  if (!confirm('إجراء قرعة عشوائية لاختيار 8 عوائل وإنشاء المواجهات؟')) {
    return;
  }

  const { data, error } = await db.rpc('zone_random_draw', {
    p_event_id: eventId
  });

  if (error) {
    return notify('تعذرت القرعة: ' + error.message);
  }

  await fetchAll();
  notify('نجحت القرعة واختيرت ' + data + ' عوائل. يمكنك الآن نشر الروم.');
}

async function unassign(familyId, eventId) {
  if (!admin) return;

  const ev = events.find(e => e.id === eventId);

  if (ev?.published) {
    return notify('أخفِ الروم قبل تعديل توزيعه');
  }

  if (eventMatches(eventId).length) {
    return notify('لا يمكن إزالة عائلة بعد إنشاء المواجهات');
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

async function publishRoom(id, published) {
  if (!admin) return;

  if (published && eventAssignments(id).length !== 8) {
    return notify('يجب وجود 8 عوائل قبل نشر الروم');
  }

  if (published && eventMatches(id).length !== 7) {
    return notify('يجب إنشاء جدول المواجهات قبل نشر الروم');
  }

  const { error } = await db.from('events')
    .update({ published })
    .eq('id', id);

  if (error) return notify(error.message);

  await fetchAll();
  notify(published ? 'تم نشر الروم' : 'تم إخفاء الروم');
}

async function setMatchWinner(matchId, winnerId) {
  if (!admin) return;

  const match = roomMatches.find(m => m.id === matchId);

  if (!match) return notify('المواجهة غير موجودة');

  if (!winnerId) return notify('اختر العائلة الفائزة');

  if (!match.first_family_id || !match.second_family_id) {
    return notify('لم يكتمل طرفا المواجهة');
  }

  if (
    match.winner_family_id &&
    match.winner_family_id !== winnerId
  ) {
    return notify('تم اعتماد فائز سابقًا. لا يمكن تغييره مباشرة');
  }

  if (!confirm('اعتماد فوز ' + familyName(winnerId) + '؟')) {
    return;
  }

  const { error } = await db.rpc('zone_set_match_winner', {
    p_match_id: matchId,
    p_winner_id: winnerId
  });

  if (error) {
    return notify('تعذر اعتماد الفائز: ' + error.message);
  }

  await fetchAll();
  notify('تم اعتماد الفائز وترحيله للدور التالي');
}

async function saveResult(eventId) {
  if (!admin) return;

  const final = eventMatches(eventId).find(m =>
    m.round_number === 3 && m.match_number === 1
  );

  if (!final) {
    return notify('لا يوجد جدول نهائي لهذا الروم');
  }

  if (!final.winner_family_id) {
    return notify('اعتمد الفائز في مواجهة النهائي أولًا');
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

  if (
    results.some(r =>
      r.event_id !== eventId &&
      (
        r.first_family_id === first ||
        r.second_family_id === first ||
        r.first_family_id === second ||
        r.second_family_id === second
      )
    )
  ) {
    return notify('إحدى العائلتين حصلت على مقعد تأهل سابقًا');
  }

  if (!confirm(
    'اعتماد النتيجة النهائية؟\n' +
    'الفائز: ' + familyName(first) + '\n' +
    'الوصيف: ' + familyName(second)
  )) {
    return;
  }

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

async function toggleRegistration() {
  if (!admin) return;

  const { error } = await db.from('zone_settings')
    .update({ registration_open: !registrationOpen })
    .eq('id', true);

  if (error) return notify(error.message);

  await fetchAll();
}

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

async function editFamily(id) {
  if (!admin) return;

  const f = families.find(x => x.id === id);
  if (!f) return;

  const family = prompt('اسم العائلة', f.family);
  if (family === null) return;

  const family_id = prompt('آيدي العائلة', f.family_id);
  if (family_id === null) return;

  const coordinator = prompt('اسم المنسق', f.coordinator || '');
  if (coordinator === null) return;

  const coordinator_id = prompt('آيدي المنسق', f.coordinator_id || '');
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

async function deleteFamily(id) {
  if (!admin) return;

  if (!confirm('هل تريد حذف العائلة؟')) return;

  const { error } = await db.from('families')
    .delete()
    .eq('id', id);

  if (error) return notify(error.message);

  await fetchAll();
}

async function editRoom(id) {
  if (!admin) return;

  const ev = events.find(e => e.id === id);
  if (!ev) return;

  const name = prompt('اسم الروم', ev.name);
  if (name === null) return;

  const time = prompt('الوقت HH:MM', ev.event_time.slice(0, 5));
  if (time === null) return;

  if (!name.trim() || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
    return notify('تحقق من الاسم وصيغة الوقت');
  }

  const { error } = await db.from('events').update({
    name: name.trim(),
    event_time: time
  }).eq('id', id);

  if (error) return notify(error.message);

  await fetchAll();
}

async function deleteRoom(id) {
  if (!admin) return;

  if (
    eventMatches(id).length ||
    eventAssignments(id).length ||
    results.some(r => r.event_id === id)
  ) {
    return notify(
      'لا يمكن حذف روم يحتوي على عوائل أو مواجهات أو نتائج. يجب معالجة البيانات المرتبطة أولًا.'
    );
  }

  if (!confirm('حذف الروم نهائيًا؟')) return;

  const { error } = await db.from('events')
    .delete()
    .eq('id', id);

  if (error) return notify(error.message);

  await fetchAll();
}

function render() {
  $('registered').textContent = publicNames.length;

  const publicEventIds = new Set([
    ...rosters.map(r => r.event_id),
    ...publicMatches.map(m => m.event_id)
  ]);

  $('eventCount').textContent =
    admin ? events.length : publicEventIds.size;

  const first = scoreboard.filter(x => x.first_family);
  const second = scoreboard.filter(x => x.second_family);

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

  for (const r of rosters) {
    if (!publicEvents.has(r.event_id)) {
      publicEvents.set(r.event_id, {
        event_id: r.event_id,
        name: r.name || 'روم',
        event_date: r.event_date,
        event_time: r.event_time,
        names: []
      });
    }

    publicEvents.get(r.event_id).names.push(r.family);
  }

  for (const m of publicMatches) {
    if (!publicEvents.has(m.event_id)) {
      publicEvents.set(m.event_id, {
        event_id: m.event_id,
        name: m.room_name,
        event_date: m.event_date,
        event_time: m.event_time,
        names: []
      });
    }
  }

  $('eventList').innerHTML =
    [...publicEvents.values()].map(e => {
      const names = [...new Set(e.names.filter(Boolean))];

      return '<div class="panel" style="margin:15px 0">' +
        '<h2>' + esc(e.name) + '</h2>' +
        '<p class="muted">' +
        esc(e.event_date || '') + ' • ' +
        esc(String(e.event_time || '').slice(0, 5)) +
        '</p>' +
        (names.length
          ? names.map((name, i) =>
              '<div class="team">' +
              (i + 1) + '. ' + esc(name) +
              '</div>'
            ).join('')
          : '<p class="muted">المواجهات متاحة في جدول المواجهات</p>') +
        '<button onclick="show(\'matches\')">عرض المواجهات</button>' +
        '</div>';
    }).join('') ||
    '<p class="muted">لا توجد رومات منشورة حاليًا</p>';

  if (!admin) return;

  $('registrationState').textContent =
    registrationOpen ? 'التسجيل مفتوح' : 'التسجيل مغلق';

  $('requests').innerHTML =
    families.map(f => {
      const used = assignments.filter(a => a.family_id === f.id);
      const qualified = isQualified(f.id);

      const options = events
        .filter(e => !e.published && !eventMatches(e.id).length)
        .map(e =>
          '<option value="' + e.id + '">' +
          esc(e.name) + ' — ' +
          esc(e.event_date) + ' (' +
          eventAssignments(e.id).length + '/8)' +
          '</option>'
        ).join('');

      return '<div class="team">' +
        '<div><b>' + esc(f.family) + '</b>' +
        '<br><small>آيدي العائلة: ' + esc(f.family_id) +
        ' | المنسق: ' + esc(f.coordinator) +
        ' | آيدي المنسق: ' + esc(f.coordinator_id) +
        '</small>' +
        '<br><small>المشاركات: ' + used.length + '/6' +
        (qualified ? ' • متأهلة' : '') +
        '</small>' +
        '<br><small>' +
        (used.map(a =>
          esc(events.find(e => e.id === a.event_id)?.name || 'روم')
        ).join('، ') || 'في الانتظار') +
        '</small></div>' +
        '<div class="team-actions">' +
        '<select id="assign_' + f.id + '">' +
        '<option value="">اختر الروم</option>' +
        options +
        '</select>' +
        '<button ' +
        (qualified || used.length >= 6 ? 'disabled' : '') +
        ' onclick="assign(\'' + f.id +
        '\',$(\'assign_' + f.id + '\').value)">توزيع</button>' +
        '<button class="secondary" onclick="editFamily(\'' +
        f.id + '\')">تعديل</button>' +
        '<button class="danger" onclick="deleteFamily(\'' +
        f.id + '\')">حذف</button>' +
        used.map(a =>
          '<button class="secondary" onclick="unassign(\'' +
          f.id + '\',\'' + a.event_id +
          '\')">إزالة من الروم</button>'
        ).join('') +
        '</div></div>';
    }).join('') ||
    '<p class="muted">لا توجد عوائل مسجلة</p>';

  $('roomControls').innerHTML =
    events.map(e => {
      const count = eventAssignments(e.id).length;
      const matchCount = eventMatches(e.id).length;

      return '<div class="team">' +
        '<div><b>' + esc(e.name) + '</b>' +
        '<br><small>' + esc(e.event_date) + ' • ' +
        esc(e.event_time) + ' • ' +
        count + '/8 عوائل • ' +
        (e.published ? 'منشور' : 'مخفي') +
        ' • ' + matchCount + '/7 مواجهات</small></div>' +
        '<div class="team-actions">' +
        '<button class="secondary" ' +
        (e.published || count || matchCount ? 'disabled' : '') +
        ' onclick="randomDraw(\'' + e.id +
        '\')">قرعة عشوائية</button>' +
        '<button onclick="publishRoom(\'' + e.id + '\',' +
        (!e.published) + ')">' +
        (e.published ? 'إخفاء' : 'نشر') +
        '</button>' +
        '<button class="secondary" onclick="editRoom(\'' +
        e.id + '\')">تعديل</button>' +
        '<button class="danger" onclick="deleteRoom(\'' +
        e.id + '\')">حذف</button>' +
        '</div></div>';
    }).join('') ||
    '<p class="muted">لم يتم إنشاء رومات بعد</p>';

  renderAdminMatches();
}

function renderAdminMatches() {
  $('resultControls').innerHTML =
    events.map(e => {
      const matches = eventMatches(e.id);
      const final = matches.find(m =>
        m.round_number === 3 &&
        m.match_number === 1
      );

      const roundTitles = {
        1: 'دور الثمانية',
        2: 'نصف النهائي',
        3: 'النهائي'
      };

      const matchHTML = matches.map(m => {
        const first = m.first_family_id
          ? familyName(m.first_family_id)
          : 'بانتظار المتأهل';

        const second = m.second_family_id
          ? familyName(m.second_family_id)
          : 'بانتظار المتأهل';

        const complete =
          m.first_family_id && m.second_family_id;

        const options = [
          '<option value="">اختر الفائز</option>',
          m.first_family_id
            ? '<option value="' + m.first_family_id + '"' +
              (m.winner_family_id === m.first_family_id
                ? ' selected' : '') +
              '>' + esc(first) + '</option>'
            : '',
          m.second_family_id
            ? '<option value="' + m.second_family_id + '"' +
              (m.winner_family_id === m.second_family_id
                ? ' selected' : '') +
              '>' + esc(second) + '</option>'
            : ''
        ].join('');

        return '<div class="match">' +
          '<b>' + roundTitles[m.round_number] +
          ' — المواجهة ' + m.match_number + '</b>' +
          '<div>' + esc(first) + '</div>' +
          '<div>ضد</div>' +
          '<div>' + esc(second) + '</div>' +
          (m.winner_family_id
            ? '<p class="tag">الفائز: ' +
              esc(familyName(m.winner_family_id)) + '</p>'
            : complete
              ? '<select id="winner_' + m.id + '">' +
                options +
                '</select>' +
                '<button onclick="setMatchWinner(\'' +
                m.id + '\',$(\'winner_' + m.id +
                '\').value)">اعتماد الفائز</button>'
              : '<p class="muted">بانتظار اكتمال المواجهة</p>') +
          '</div>';
      }).join('');

      const result = results.find(r => r.event_id === e.id);

      return '<div class="panel" style="margin:15px 0">' +
        '<h2>' + esc(e.name) + '</h2>' +
        '<p class="muted">' + esc(e.event_date) + '</p>' +
        (matches.length
          ? '<div class="rounds">' +
            [1, 2, 3].map(round =>
              '<div class="round"><h3>' +
              roundTitles[round] + '</h3>' +
              matches
                .filter(m => m.round_number === round)
                .map(m => {
                  const id = m.id;
                  const start = matchHTML;
                  return '';
                }).join('') +
              '</div>'
            ).join('') +
            '</div>' +
            matchHTML
          : '<p class="muted">لم تُنشأ مواجهات لهذا الروم بعد. استخدم القرعة العشوائية لإنشائها.</p>') +
        (result
          ? '<p class="tag">تم اعتماد النتيجة النهائية: ' +
            esc(familyName(result.first_family_id)) +
            ' — الوصيف: ' +
            esc(familyName(result.second_family_id)) +
            '</p>'
          : final?.winner_family_id
            ? '<button onclick="saveResult(\'' +
              e.id +
              '\')">اعتماد الفائز والوصيف للتأهل</button>'
            : '<p class="muted">اعتمد مواجهات الأدوار حتى النهائي، ثم اعتمد مقاعد التأهل.</p>') +
        '</div>';
    }).join('') ||
    '<p class="muted">لا توجد رومات بعد</p>';
}

function displayPublicMatches() {
  const container = $('publicMatches');
  if (!container) return;

  container.innerHTML = '';

  if (!publicMatches.length) {
    container.innerHTML =
      '<p class="muted">لم تُنشر جداول المواجهات بعد.</p>';
    return;
  }

  const groups = new Map();

  for (const match of publicMatches) {
    if (!groups.has(match.event_id)) {
      groups.set(match.event_id, []);
    }
    groups.get(match.event_id).push(match);
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
      'text-align:center;color:#ff5962;margin:25px 0 12px';

    container.appendChild(title);

    const scroll = document.createElement('div');
    scroll.style.cssText =
      'width:100%;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:15px';

    const stage = document.createElement('div');
    stage.style.cssText =
      'position:relative;width:850px;height:550px;direction:ltr;margin:auto';

    const positions = [
      [100, 220, 340, 460],
      [160, 400],
      [280]
    ];

    const x = [10, 310, 610];
    const width = 230;
    const height = 94;

    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');

    svg.setAttribute('width', '850');
    svg.setAttribute('height', '550');
    svg.setAttribute('viewBox', '0 0 850 550');

    svg.style.cssText =
      'position:absolute;inset:0;pointer-events:none';

    function line(x1, y1, x2, y2) {
      const element = document.createElementNS(ns, 'line');

      element.setAttribute('x1', x1);
      element.setAttribute('y1', y1);
      element.setAttribute('x2', x2);
      element.setAttribute('y2', y2);
      element.setAttribute('stroke', '#b8758a');
      element.setAttribute('stroke-width', '2');

      svg.appendChild(element);
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
        'px;top:15px;width:' + width +
        'px;text-align:center;font-size:18px;font-weight:bold;color:#e3a8b2';

      stage.appendChild(heading);

      for (let i = 0; i < positions[r].length; i++) {
        const match = matches.find(m =>
          Number(m.round_number) === round &&
          Number(m.match_number) === i + 1
        );

        const first = match?.first_family ||
          (round === 1 ? 'بانتظار القرعة' : 'بانتظار المتأهل');

        const second = match?.second_family ||
          (round === 1 ? 'بانتظار القرعة' : 'بانتظار المتأهل');

        const winner = match?.winner_family || '';

        const card = document.createElement('div');

        card.style.cssText =
          'position:absolute;left:' + x[r] +
          'px;top:' + (positions[r][i] - height / 2) +
          'px;width:' + width +
          'px;height:' + height +
          'px;background:#25151c;border:1px solid #a85b70;border-radius:12px;color:white;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:5px;padding:8px;direction:rtl;text-align:center;overflow-wrap:anywhere';

        const label = document.createElement('div');
        label.textContent = 'المواجهة ' + (i + 1);
        label.style.cssText =
          'font-size:11px;color:#e3a8b2';

        const team1 = document.createElement('div');
        team1.textContent =
          (winner && winner === first ? '🏆 ' : '') + first;
        team1.style.cssText =
          'font-size:13px;font-weight:bold';

        const versus = document.createElement('div');
        versus.textContent = 'VS';
        versus.style.cssText =
          'font-size:11px;color:#ff6572';

        const team2 = document.createElement('div');
        team2.textContent =
          (winner && winner === second ? '🏆 ' : '') + second;
        team2.style.cssText =
          'font-size:13px;font-weight:bold';

        card.append(label, team1, versus, team2);
        stage.appendChild(card);
      }
    }

    scroll.appendChild(stage);
    container.appendChild(scroll);
  }
}

fetchAll();
