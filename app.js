/* 1-Minute Bedtime Stories: preview app */
(() => {
  const CFG = window.BEDTIME_CONFIG || {};
  const BACKEND_READY = Boolean(CFG.SUPABASE_URL && CFG.SUPABASE_KEY);
  const sb = BACKEND_READY ? supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY) : null;
  const FN_URL = BACKEND_READY ? `${CFG.SUPABASE_URL}/functions/v1/generate-story` : "";

  const LESSONS = [
    ["kindness", "💛"], ["courage", "🦁"], ["honesty", "🌟"], ["patience", "🐢"],
    ["confidence", "🌈"], ["sharing", "🍪"], ["friendship", "🤝"], ["gratitude", "🙏"],
    ["listening", "👂"], ["faith", "🕊️"], ["trying new things", "🚀"], ["bedtime calm", "🌙"],
  ];
  const FREE_PER_WEEK = 3;
  const CHILD_LIMIT = { free: 1, premium: 1, family: 5 };
  const GEN_MSGS = [
    "Sprinkling stardust...", "Waking up the moon...", "Gathering favorite things...",
    "Finding the perfect adventure...", "Tucking in the ending...",
  ];

  const state = {
    session: null, profile: null, children: [], stories: [],
    childId: localStorage.getItem("bedtime.childId") || null,
    lesson: null, continueFrom: null, story: null, storyBackTo: "home",
    authMode: "signup", libraryFilter: "all",
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), 2600);
  }

  /* ---------- Routing ---------- */
  function show(view) {
    stopReading();
    $$(".view").forEach((v) => (v.hidden = v.id !== `view-${view}`));
    const isApp = $(`#view-${view}`).classList.contains("app-view");
    $("#tabbar").hidden = !(isApp && state.session);
    $$("#tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.go === view));
    window.scrollTo({ top: 0 });
    if (view === "home") renderHome();
    if (view === "library") renderLibrary();
    if (view === "plan") renderPlan();
    if (view === "lesson") renderLesson();
  }
  document.addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]");
    if (!go) return;
    const view = go.dataset.go;
    if (view === "child") openChildForm(null);
    else if (view === "auth" && state.session) show("home");
    else show(view);
  });

  /* ---------- Auth ---------- */
  $$("[data-authmode]").forEach((b) => b.addEventListener("click", () => {
    state.authMode = b.dataset.authmode;
    $$("[data-authmode]").forEach((x) => x.classList.toggle("active", x === b));
    $("#auth-submit").textContent = state.authMode === "signup" ? "Create account" : "Sign in";
    $("#auth-error").hidden = true;
  }));

  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#auth-error"); err.hidden = true;
    if (!BACKEND_READY) { $("#backend-notice").hidden = false; return; }
    const fd = new FormData(e.target);
    const email = fd.get("email").trim(), password = fd.get("password");
    const btn = $("#auth-submit"); btn.disabled = true;
    try {
      const res = state.authMode === "signup"
        ? await sb.auth.signUp({ email, password })
        : await sb.auth.signInWithPassword({ email, password });
      if (res.error) throw res.error;
      if (state.authMode === "signup" && !res.data.session) {
        toast("Check your email to confirm your account.");
      }
    } catch (ex) {
      err.textContent = ex.message || "Something went wrong."; err.hidden = false;
    } finally { btn.disabled = false; }
  });

  $("#btn-signout").addEventListener("click", async () => {
    await sb.auth.signOut();
  });

  async function loadAll() {
    const [p, c, s] = await Promise.all([
      sb.from("profiles").select("*").eq("id", state.session.user.id).maybeSingle(),
      sb.from("children").select("*").order("created_at"),
      sb.from("stories").select("*").order("created_at", { ascending: false }).limit(200),
    ]);
    state.profile = p.data || { plan: "free" };
    state.children = c.data || [];
    state.stories = s.data || [];
    if (!state.children.find((x) => x.id === state.childId)) {
      state.childId = state.children[0]?.id || null;
      localStorage.setItem("bedtime.childId", state.childId || "");
    }
  }

  if (BACKEND_READY) {
    sb.auth.onAuthStateChange(async (event, session) => {
      const had = Boolean(state.session);
      state.session = session;
      if (session) {
        if (!had || event === "SIGNED_IN") {
          await loadAll();
          show(state.children.length ? "home" : "child");
          if (!state.children.length) openChildForm(null);
        }
      } else if (had || event === "SIGNED_OUT") {
        state.profile = null; state.children = []; state.stories = [];
        show("landing");
      }
    });
    sb.auth.getSession().then(({ data }) => { if (!data.session) show("landing"); });
  } else {
    $("#backend-notice").hidden = false;
    show("landing");
  }

  /* ---------- Home ---------- */
  function plan() { return state.profile?.plan || "free"; }
  function child() { return state.children.find((c) => c.id === state.childId) || null; }
  function weekCount() {
    const since = Date.now() - 7 * 864e5;
    return state.stories.filter((s) => new Date(s.created_at).getTime() >= since).length;
  }
  function greeting() {
    const h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }

  function renderChips(container, { all = false, onPick, allowAdd = true, active }) {
    const el = $(container); el.innerHTML = "";
    if (all) el.appendChild(chip("All", active === "all", () => onPick("all")));
    state.children.forEach((c) => el.appendChild(chip(c.name, active === c.id, () => onPick(c.id))));
    if (allowAdd) el.appendChild(chip("+ Add child", false, () => {
      const limit = CHILD_LIMIT[plan()];
      if (state.children.length >= limit) {
        toast(limit === 1 ? "Family plan unlocks more children." : "Family plan allows up to 5 children.");
        show("plan"); return;
      }
      openChildForm(null);
    }, "add"));
  }
  function chip(label, active, onClick, extra = "") {
    const b = document.createElement("button");
    b.className = `chip ${active ? "active" : ""} ${extra}`;
    b.textContent = label; b.addEventListener("click", onClick);
    return b;
  }

  function renderHome() {
    $("#home-greeting").textContent = greeting();
    renderChips("#child-chips", {
      active: state.childId,
      onPick: (id) => { state.childId = id; localStorage.setItem("bedtime.childId", id); renderHome(); },
    });
    const c = child();
    $("#home-empty").hidden = Boolean(c) || state.children.length > 0;
    $("#home-cta").hidden = !c;
    if (c) $("#cta-child-name").textContent = c.name;
    const recent = state.stories.filter((s) => !c || s.child_id === c.id).slice(0, 5);
    $("#home-recent").hidden = recent.length === 0;
    renderStoryList("#home-story-list", recent, "home");
    const q = $("#home-quota");
    if (plan() === "free") {
      const left = Math.max(0, FREE_PER_WEEK - weekCount());
      q.innerHTML = `${left} of ${FREE_PER_WEEK} free stories left this week. <a href="#" data-go="plan">Go unlimited</a>`;
    } else q.textContent = `${plan() === "family" ? "Family" : "Premium"} plan: unlimited stories.`;
  }
  $("#btn-new-story").addEventListener("click", () => { state.continueFrom = null; show("lesson"); });
  $("#btn-edit-child").addEventListener("click", () => openChildForm(child()));

  function renderStoryList(container, list, backTo) {
    const el = $(container); el.innerHTML = "";
    list.forEach((s) => {
      const c = state.children.find((x) => x.id === s.child_id);
      const b = document.createElement("button");
      b.className = "story-row";
      b.innerHTML = `<div><b>${esc(s.title)}</b><span>${esc(c?.name || "")} · ${esc(s.lesson)} · ${fmtDate(s.created_at)}</span></div>${s.is_favorite ? '<span class="star">★</span>' : ""}`;
      b.addEventListener("click", () => openStory(s, backTo));
      el.appendChild(b);
    });
  }
  const fmtDate = (d) => new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  /* ---------- Child form ---------- */
  function openChildForm(c) {
    const f = $("#child-form"); f.reset();
    $("#child-error").hidden = true;
    $("#child-form-title").textContent = c ? `Edit ${c.name}'s favorites` : "Tell us about your child";
    $("#btn-delete-child").hidden = !c;
    f.elements.id.value = c?.id || "";
    ["name", "favorite_color", "favorite_food", "favorite_animal", "favorite_place", "favorite_activity"]
      .forEach((k) => (f.elements[k].value = c?.[k] || ""));
    setChoice("age_range", c?.age_range || "5-6");
    show("child");
  }
  function setChoice(name, value) {
    $$(`[data-choice="${name}"] button`).forEach((b) => b.classList.toggle("active", b.dataset.value === value));
  }
  $$("[data-choice] button").forEach((b) => b.addEventListener("click", () => setChoice(b.closest("[data-choice]").dataset.choice, b.dataset.value)));

  $("#child-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!BACKEND_READY) return;
    const f = e.target, err = $("#child-error"); err.hidden = true;
    const row = {
      parent_id: state.session.user.id,
      name: f.elements.name.value.trim(),
      age_range: $(`[data-choice="age_range"] .active`)?.dataset.value || "5-6",
    };
    ["favorite_color", "favorite_food", "favorite_animal", "favorite_place", "favorite_activity"]
      .forEach((k) => (row[k] = f.elements[k].value.trim() || null));
    const id = f.elements.id.value;
    const q = id ? sb.from("children").update(row).eq("id", id) : sb.from("children").insert(row);
    const { data, error } = await q.select().single();
    if (error) { err.textContent = error.message; err.hidden = false; return; }
    const i = state.children.findIndex((c) => c.id === data.id);
    if (i >= 0) state.children[i] = data; else state.children.push(data);
    state.childId = data.id; localStorage.setItem("bedtime.childId", data.id);
    toast(id ? "Favorites updated" : `${data.name} added`);
    show(id ? "home" : "lesson");
  });
  $("#btn-delete-child").addEventListener("click", async () => {
    const id = $("#child-form").elements.id.value;
    const c = state.children.find((x) => x.id === id);
    if (!c || !confirm(`Remove ${c.name} and their stories?`)) return;
    const { error } = await sb.from("children").delete().eq("id", id);
    if (error) { toast(error.message); return; }
    state.children = state.children.filter((x) => x.id !== id);
    state.stories = state.stories.filter((s) => s.child_id !== id);
    state.childId = state.children[0]?.id || null;
    localStorage.setItem("bedtime.childId", state.childId || "");
    show("home");
  });

  /* ---------- Lesson ---------- */
  function renderLesson() {
    const c = child(); if (!c) { show("home"); return; }
    $("#lesson-child-name").textContent = c.name;
    const g = $("#lesson-grid"); g.innerHTML = "";
    LESSONS.forEach(([name, icon]) => {
      const b = document.createElement("button");
      b.className = `lesson ${state.lesson === name ? "active" : ""}`;
      b.innerHTML = `<span>${icon}</span>${esc(name)}`;
      b.addEventListener("click", () => { state.lesson = name; renderLesson(); });
      g.appendChild(b);
    });
    const last = state.stories.find((s) => s.child_id === c.id);
    const t = $("#continue-toggle");
    t.hidden = !last;
    if (last) {
      $("#continue-title").textContent = last.title;
      $("#continue-check").checked = state.continueFrom === last.id;
      $("#continue-check").onchange = (e) => (state.continueFrom = e.target.checked ? last.id : null);
    }
    $("#btn-generate").disabled = !state.lesson;
    $("#lesson-error").hidden = true;
  }

  $("#btn-generate").addEventListener("click", async () => {
    const c = child(); if (!c || !state.lesson) return;
    if (plan() === "free" && weekCount() >= FREE_PER_WEEK) {
      toast("You've used this week's free stories."); show("plan"); return;
    }
    $("#gen-child-name").textContent = c.name;
    show("generating");
    let i = 0; $("#gen-msg").textContent = GEN_MSGS[0];
    const rot = setInterval(() => ($("#gen-msg").textContent = GEN_MSGS[++i % GEN_MSGS.length]), 1800);
    try {
      const { data: { session } } = await sb.auth.getSession();
      const res = await fetch(FN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: CFG.SUPABASE_KEY, Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ child_id: c.id, lesson: state.lesson, continue_from: state.continueFrom || undefined }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 402) { toast("Free stories used up for this week."); show("plan"); return; }
      if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
      state.stories.unshift(body.story);
      state.continueFrom = null;
      openStory(body.story, "home");
    } catch (ex) {
      show("lesson");
      const err = $("#lesson-error");
      err.textContent = `The story didn't come through (${ex.message}). Please try again.`; err.hidden = false;
    } finally { clearInterval(rot); }
  });

  /* ---------- Story ---------- */
  function openStory(s, backTo = "home") {
    state.story = s; state.storyBackTo = backTo;
    $("#story-title").textContent = s.title;
    $("#story-lesson").textContent = s.lesson;
    $("#story-date").textContent = fmtDate(s.created_at);
    $("#story-body").innerHTML = s.body.split(/\n{2,}|\n/).filter(Boolean).map((p) => `<p>${esc(p)}</p>`).join("");
    setFav(s.is_favorite);
    show("story");
  }
  $("#story-back").addEventListener("click", () => show(state.storyBackTo));
  $("#btn-another").addEventListener("click", () => {
    state.childId = state.story.child_id; state.continueFrom = null; show("lesson");
  });
  $("#btn-continue").addEventListener("click", () => {
    if (plan() === "free") { toast("Continuing adventures come with Family."); show("plan"); return; }
    state.childId = state.story.child_id; state.continueFrom = state.story.id; show("lesson");
  });
  function setFav(on) {
    const b = $("#btn-fav");
    b.setAttribute("aria-pressed", String(on));
    b.innerHTML = on ? "&#9733; Saved" : "&#9734; Save";
  }
  $("#btn-fav").addEventListener("click", async () => {
    const s = state.story, next = !s.is_favorite;
    const { error } = await sb.from("stories").update({ is_favorite: next }).eq("id", s.id);
    if (error) { toast(error.message); return; }
    s.is_favorite = next; setFav(next); toast(next ? "Saved to your library" : "Removed from saved");
  });
  $("#btn-share").addEventListener("click", async () => {
    const s = state.story;
    const text = `${s.title}\n\n${s.body}\n\nMade with 1-Minute Bedtime Stories`;
    if (navigator.share) { try { await navigator.share({ title: s.title, text }); } catch {} }
    else { await navigator.clipboard.writeText(text); toast("Story copied"); }
  });

  /* ---------- Read to me (device voice for the preview) ---------- */
  let reading = false, utterQueue = [];
  function pickVoice() {
    const voices = speechSynthesis.getVoices();
    const prefer = ["Samantha", "Karen", "Moira", "Google US English", "Microsoft Aria"];
    return voices.find((v) => prefer.includes(v.name)) || voices.find((v) => v.lang.startsWith("en") && v.localService) || voices.find((v) => v.lang.startsWith("en")) || null;
  }
  function stopReading() {
    if (!("speechSynthesis" in window)) return;
    speechSynthesis.cancel(); reading = false; utterQueue = [];
    $$("#story-body p").forEach((p) => p.classList.remove("speaking"));
    const b = $("#btn-read"); b.innerHTML = "&#9654; Read to me"; b.setAttribute("aria-pressed", "false");
  }
  $("#btn-read").addEventListener("click", () => {
    if (!("speechSynthesis" in window)) { toast("Narration isn't supported in this browser."); return; }
    if (reading) { stopReading(); return; }
    const paras = $$("#story-body p");
    const voice = pickVoice();
    reading = true;
    $("#btn-read").innerHTML = "&#9632; Stop"; $("#btn-read").setAttribute("aria-pressed", "true");
    const title = new SpeechSynthesisUtterance(state.story.title);
    utterQueue = [title, ...paras.map((p) => new SpeechSynthesisUtterance(p.textContent))];
    utterQueue.forEach((u, i) => {
      if (voice) u.voice = voice;
      u.rate = 0.88; u.pitch = 1.05;
      u.onstart = () => { paras.forEach((p) => p.classList.remove("speaking")); if (i > 0) paras[i - 1].classList.add("speaking"); };
      if (i === utterQueue.length - 1) u.onend = () => stopReading();
    });
    utterQueue.forEach((u) => speechSynthesis.speak(u));
  });
  if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => {};

  /* ---------- Library ---------- */
  function renderLibrary() {
    renderChips("#library-chips", {
      all: true, allowAdd: false, active: state.libraryFilter,
      onPick: (id) => { state.libraryFilter = id; renderLibrary(); },
    });
    const list = state.stories.filter((s) => state.libraryFilter === "all" || s.child_id === state.libraryFilter);
    const sorted = [...list].sort((a, b) => Number(b.is_favorite) - Number(a.is_favorite));
    $("#library-empty").hidden = sorted.length > 0;
    renderStoryList("#library-list", sorted, "library");
  }

  /* ---------- Plan ---------- */
  function renderPlan() {
    $$(".plan").forEach((p) => p.classList.toggle("current", p.dataset.plan === plan()));
    $$("[data-choose]").forEach((b) => (b.textContent = b.dataset.choose === plan() ? "Current plan" : `Choose ${cap(b.dataset.choose)}`));
    $("#plan-current").textContent = `Signed in as ${state.session?.user?.email || ""}`;
  }
  const cap = (s) => s[0].toUpperCase() + s.slice(1);
  $$("[data-choose]").forEach((b) => b.addEventListener("click", async () => {
    const next = b.dataset.choose; if (next === plan()) return;
    const { error } = await sb.from("profiles").update({ plan: next }).eq("id", state.session.user.id);
    if (error) { toast(error.message); return; }
    state.profile.plan = next; renderPlan(); toast(`You're on ${cap(next)}`);
  }));
})();
