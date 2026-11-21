// Shared helpers: API calls, storage, small UI utilities.
(function () {
  const store = {
    get(k, session) { try { return (session ? sessionStorage : localStorage).getItem(k); } catch (e) { return null; } },
    set(k, v, session) { try { (session ? sessionStorage : localStorage).setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch (e) {} }
  };

  async function api(action, payload) {
    let res;
    try {
      res = await fetch(window.WHEEL_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({ action: action }, payload || {}))
      });
    } catch (e) {
      const err = new Error('אין חיבור לשרת. בדקו את האינטרנט ונסו שוב.');
      err.code = 'NETWORK';
      throw err;
    }
    let j;
    try { j = await res.json(); } catch (e) { throw new Error('השרת החזיר תשובה לא תקינה. נסו שוב בעוד רגע.'); }
    if (!j.ok) { const err = new Error(j.error); err.code = j.error; throw err; }
    return j.data;
  }

  function el(tag, attrs, ...kids) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    }
    kids.flat().forEach(c => { if (c != null && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c))); });
    return n;
  }

  function fmtDate(ds) {
    if (!ds) return '';
    const [y, m, d] = ds.split('-');
    return `${Number(d)}/${Number(m)}`;
  }
  const DAYS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];
  function dayName(ds) { return DAYS[new Date(ds + 'T12:00:00Z').getUTCDay()]; }

  // Simple in-page confirm dialog (returns Promise<boolean>)
  function ask(text, yes = 'כן', no = 'ביטול') {
    return new Promise(resolve => {
      const wrap = el('div', { class: 'ask-wrap', role: 'dialog', 'aria-modal': 'true' },
        el('div', { class: 'ask-card' },
          el('p', null, text),
          el('div', { class: 'ask-row' },
            el('button', { class: 'btn btn-primary', onclick: () => done(true) }, yes),
            el('button', { class: 'btn', onclick: () => done(false) }, no))));
      function done(v) { wrap.remove(); resolve(v); }
      document.body.append(wrap);
      wrap.querySelector('.btn-primary').focus();
    });
  }

  function toast(text, kind) {
    let t = document.querySelector('.toast');
    if (!t) { t = el('div', { class: 'toast', role: 'status' }); document.body.append(t); }
    t.textContent = text;
    t.dataset.kind = kind || 'info';
    t.classList.add('show');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.classList.remove('show'), 3500);
  }

  window.WH = { api, store, el, fmtDate, dayName, ask, toast, DAYS };
})();
