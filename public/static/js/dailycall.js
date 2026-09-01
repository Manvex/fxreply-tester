// ===========================================================================
// The call for today's open — one per instrument per day, and scored after.
//
// A bot that makes a daily prediction has to keep a daily record, otherwise it
// is just a confident voice. So every call is written down before the open with
// the levels it expects, then graded against what actually happened once the
// session has run. The record is shown next to the next call, permanently.
//
// What the call is made of, and what each part is worth:
//
//   Measured    base rates from sessions that resembled this one, with their
//               confidence interval. This is the only part with a denominator,
//               and it is the only part allowed to produce a probability.
//   Projected   those rates turned into actual prices for today, so the call
//               says 29,520 rather than "0.45%".
//   Context     trend across timeframes, and the news in the window. These are
//               shown beside the call, never folded into the probability —
//               there is no sample behind them and pretending otherwise would
//               be inventing precision.
//
// The confidence tier comes from the interval, not from the point estimate. An
// 89% whose interval reaches down to 56% is a lean, not a conviction, and it is
// labelled that way.
// ===========================================================================

const DailyCall = (() => {
  const LS = 'bt_daily_calls';

  const dayKey = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
  const idOf = (sym, day) => sym + '|' + day;

  function loadAll() {
    try { return JSON.parse(localStorage.getItem(LS) || '{}'); } catch (_e) { return {}; }
  }
  function saveAll(o) {
    try { localStorage.setItem(LS, JSON.stringify(o)); } catch (_e) {}
  }

  /**
   * Build today's call.
   *
   * Everything here is derived from the matched sessions; nothing is asserted.
   * When the sample cannot support a claim the call says so rather than
   * reaching for a weaker one.
   */
  function build(sym, sessions, t, trends) {
    if (!sessions || !sessions.length || !t) return null;

    const f = SessionBot.forecast(sessions, t, sym);
    if (!f || !f.enough) {
      return { sym, day: dayKey(), enough: false, n: f ? f.n : 0,
               reason: 'Too few comparable sessions to call this one.' };
    }

    const ref = t.opened ? t.open : t.last;
    const dir = Math.sign(t.gapPct) || 1;

    // Turn the measured percentages into today's actual prices.
    const px = (pct) => ref * (1 + pct / 100);
    const levels = {
      ref,
      prevClose: t.prevClose,
      reachUp: px(f.hour.medianUp),
      reachDown: px(f.hour.medianDown),
      stretchUp: px(f.hour.p80Up),
      stretchDown: px(f.hour.p80Down),
      typical: px(f.hour.medianMove),
    };

    // The strongest claim the interval actually supports.
    const h = f.headline;
    const tier = !h.has ? 'none'
      : (h.w.lo > 65 || h.w.hi < 35) ? 'firm'
      : 'lean';

    // Context, kept separate from the probability on purpose.
    const tf = (trends || []).filter(x => x.score != null);
    const up = tf.filter(x => x.score > 0.15).length;
    const down = tf.filter(x => x.score < -0.15).length;
    const trendNote = tf.length
      ? `${up} of ${tf.length} timeframes up, ${down} down`
      : null;
    const trendAgrees = tf.length
      ? (Math.sign(up - down) === dir ? 'agrees with the gap' :
         (up === down ? 'is split' : 'disagrees with the gap'))
      : null;

    return {
      sym, day: dayKey(), enough: true,
      at: Date.now(),
      openAt: f.news.openAt,
      gapPct: t.gapPct,
      onRangePct: t.onRangePct,
      dir,
      n: f.n, used: f.used, dropped: f.dropped,
      tier,
      claim: h.has ? h.text : null,
      claimKey: h.has ? h.key : null,
      directional: h.has ? h.directional !== false : false,
      prob: h.has ? { p: h.w.p, lo: h.w.lo, hi: h.w.hi, n: h.w.n } : null,
      outcomes: {
        fill: f.outcomes.fill, hold: f.outcomes.hold,
        close: f.outcomes.close, expand: f.outcomes.expand,
      },
      levels,
      hour: f.hour,
      news: f.news,
      context: { trendNote, trendAgrees },
      graded: false,
    };
  }

  /** Store today's call once, so it cannot be quietly rewritten after the fact. */
  function record(call) {
    if (!call || !call.enough) return call;
    const all = loadAll();
    const id = idOf(call.sym, call.day);
    if (all[id] && all[id].graded) return all[id];
    // Written before the open stays written; afterwards it is only refreshed
    // while the open has not yet happened.
    if (all[id] && Date.now() > (all[id].openAt || 0) * 1000) return all[id];
    all[id] = call;
    saveAll(all);
    return call;
  }

  /**
   * Grade the calls that have since played out.
   *
   * A call is graded on what it actually claimed — a size claim is judged on
   * size, a direction claim on direction. Judging one by the other would be a
   * way of always being right.
   */
  function grade(sym, sessions) {
    if (!sessions || !sessions.length) return;
    const all = loadAll();
    let changed = false;

    for (const [id, c] of Object.entries(all)) {
      if (c.graded || !c.enough || c.sym !== sym) continue;
      const day = Math.floor(Date.parse(c.day + 'T00:00:00Z') / 1000);
      const s = sessions.find(x => x.day === day);
      if (!s) continue;                       // that session has not been read yet

      let right = null;
      if (c.claimKey === 'expand') {
        const ranged = Math.max(s.hourUpPct, -s.hourDownPct) > 0.35;
        right = c.prob.p >= 50 ? ranged : !ranged;
      } else if (c.claimKey === 'fill') {
        right = c.prob.p >= 50 ? s.filled : !s.filled;
      } else if (c.claimKey === 'hold') {
        right = c.prob.p >= 50 ? s.dirHeld : !s.dirHeld;
      } else if (c.claimKey === 'close') {
        const closedWith = Math.sign(s.sessionClosePct) === c.dir;
        right = c.prob.p >= 50 ? closedWith : !closedWith;
      }
      if (right === null) continue;

      all[id] = { ...c, graded: true, right,
                  actual: {
                    hourMovePct: s.hourMovePct, hourUpPct: s.hourUpPct,
                    hourDownPct: s.hourDownPct, filled: s.filled,
                    dirHeld: s.dirHeld, sessionClosePct: s.sessionClosePct,
                  } };
      changed = true;
    }
    if (changed) saveAll(all);
  }

  /** The running record for one instrument, newest first. */
  function history(sym, limit = 30) {
    const all = loadAll();
    return Object.values(all)
      .filter(c => c.sym === sym && c.enough)
      .sort((a, b) => (b.day < a.day ? -1 : 1))
      .slice(0, limit);
  }

  function scorecard(sym) {
    const h = history(sym, 200).filter(c => c.graded);
    if (!h.length) return { n: 0 };
    const right = h.filter(c => c.right).length;
    const byTier = {};
    for (const tier of ['firm', 'lean']) {
      const set = h.filter(c => c.tier === tier);
      if (set.length) {
        byTier[tier] = { n: set.length, right: set.filter(c => c.right).length };
      }
    }
    return {
      n: h.length, right, pct: (right / h.length) * 100,
      byTier,
      recent: h.slice(0, 12),
    };
  }

  function forToday(sym) {
    const all = loadAll();
    return all[idOf(sym, dayKey())] || null;
  }

  return { build, record, grade, history, scorecard, forToday, dayKey };
})();

window.DailyCall = DailyCall;
