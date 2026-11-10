/* Case Study Machine: page logic.
 *
 * Flow: read the user's files in the browser -> send the prompt, notes and a
 * profile of the data to Claude with playbook.md as instructions -> Claude asks
 * for calculations (run_analysis), which run here in a Web Worker -> Claude
 * hands over the deck and prep notes (deliver) -> the page renders both.
 *
 * There is no server. The API key goes from this page straight to Anthropic.
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var API = 'https://api.anthropic.com/v1/messages';
  /* Google sign-in client ID. Not a secret: it only names this site to Google.
     Paste yours between the quotes (see README, "Google sign-in setup"). If left
     empty, the page asks for one and remembers it in the browser. */
  var GOOGLE_CLIENT_ID = '';
  var DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';   // only files this page creates
  var MAX_TURNS = 40, MAX_RESULT_CHARS = 30000, ANALYSIS_TIMEOUT_MS = 20000;

  var tables = {};        // name -> array of row objects
  var run = null;         // { deck, prep_markdown, name }
  var controller = null;  // AbortController for the request in flight

  /* ---------- small helpers ---------- */

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    for (var k in attrs || {}) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    return e;
  }
  function show(id, on) { $(id).classList.toggle('hidden', !on); }
  function setError(msg) { $('error').textContent = msg || ''; show('error', !!msg); }
  function setStatus(msg, busy) { $('status').innerHTML = ''; if (busy) $('status').appendChild(el('span', { 'class': 'spin' })); $('status').appendChild(document.createTextNode(msg || '')); }
  function download(name, blob) {
    var a = el('a', { href: URL.createObjectURL(blob), download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }
  function slug(s) { return String(s || 'case-study').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'case-study'; }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private window */ } }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  /* ---------- reading data files ---------- */

  function addFiles(fileList) {
    Array.prototype.forEach.call(fileList, function (f) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var wb = XLSX.read(new Uint8Array(reader.result), { type: 'array', cellDates: true });
          wb.SheetNames.forEach(function (sn) {
            var rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: null, raw: true });
            rows = rows.map(cleanRow).filter(function (r) { return Object.keys(r).length; });
            if (!rows.length) return;
            var base = f.name.replace(/\.[^.]+$/, '');
            var name = wb.SheetNames.length > 1 ? base + ' / ' + sn : base;
            tables[name] = rows;
          });
          renderFiles();
        } catch (e) { setError('Could not read ' + f.name + ': ' + e.message); }
      };
      reader.readAsArrayBuffer(f);
    });
  }
  function cleanRow(r) {
    var out = {};
    Object.keys(r).forEach(function (k) {
      if (/^__EMPTY/.test(k) && (r[k] == null || r[k] === '')) return;
      var v = r[k];
      if (v instanceof Date) v = v.toISOString().slice(0, 10);
      else if (typeof v === 'string') {
        var t = v.trim(), n = t.replace(/[$,]/g, '');
        if (/^-?\d+(\.\d+)?%$/.test(n)) v = parseFloat(n) / 100;
        else if (n !== '' && /^-?\d+(\.\d+)?$/.test(n)) v = parseFloat(n);
        else v = t;
      }
      out[String(k).trim()] = v;
    });
    return out;
  }
  function renderFiles() {
    var ul = $('files'); ul.innerHTML = '';
    Object.keys(tables).forEach(function (name) {
      var li = el('li'), rm = el('button', { type: 'button', 'aria-label': 'Remove ' + name }, 'remove');
      li.appendChild(el('span', null, name + '  (' + tables[name].length + ' rows, ' + Object.keys(tables[name][0]).length + ' columns)'));
      rm.onclick = function () { delete tables[name]; renderFiles(); };
      li.appendChild(rm); ul.appendChild(li);
    });
  }
  function profile() {
    var names = Object.keys(tables);
    if (!names.length) return 'No data files were supplied.';
    return names.map(function (name) {
      var rows = tables[name], cols = Object.keys(rows[0]);
      var sample = rows.slice(0, rows.length <= 40 ? rows.length : 12);
      var lines = [cols.join(' | ')].concat(sample.map(function (r) { return cols.map(function (c) { return r[c] == null ? '' : r[c]; }).join(' | '); }));
      return 'Table "' + name + '": ' + rows.length + ' rows. Columns: ' + cols.join(', ') + '\n' +
        (rows.length <= 40 ? 'All rows:\n' : 'First 12 rows:\n') + lines.join('\n');
    }).join('\n\n');
  }

  /* ---------- running the model's analysis code ---------- */

  var WORKER_SRC = 'onmessage = function (e) { try { var fn = new Function("tables", e.data.code);' +
    ' Promise.resolve(fn(e.data.tables)).then(function (r) { postMessage({ ok: true, result: JSON.stringify(r === undefined ? null : r) }); },' +
    ' function (err) { postMessage({ ok: false, error: String(err && err.stack || err) }); }); }' +
    ' catch (err) { postMessage({ ok: false, error: String(err && err.stack || err) }); } };';
  function runAnalysis(code) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
      var w = new Worker(url), done = false;
      function finish(r) { if (done) return; done = true; w.terminate(); URL.revokeObjectURL(url); resolve(r); }
      var timer = setTimeout(function () { finish({ ok: false, error: 'Timed out after 20 seconds. Simplify the calculation.' }); }, ANALYSIS_TIMEOUT_MS);
      w.onmessage = function (e) { clearTimeout(timer); finish(e.data); };
      w.onerror = function (e) { clearTimeout(timer); finish({ ok: false, error: String(e.message || e) }); };
      w.postMessage({ code: code, tables: tables });
    });
  }

  /* ---------- talking to Claude ---------- */

  var TOOLS = [
    { name: 'run_analysis', eager_input_streaming: true,
      description: 'Run JavaScript against the candidate\'s data in their browser and get the result back. `code` is the body of a function that receives `tables` (object: table name -> array of row objects keyed by column header, numbers already parsed) and must `return` a small JSON-serialisable summary. Use this for every number; never do arithmetic yourself.',
      input_schema: { type: 'object', properties: {
        purpose: { type: 'string', description: 'One plain sentence saying what this calculation is for. Shown to the candidate.' },
        code: { type: 'string', description: 'Function body. Must end with a return statement.' } }, required: ['purpose', 'code'] } },
    { name: 'deliver', eager_input_streaming: true,
      description: 'Hand over the finished deck and prep notes. Call once, when the analysis is complete. Returns a list of problems to fix if the deck is not valid.',
      input_schema: { type: 'object', properties: {
        deck: { type: 'object', description: 'The deck, in the format described under "Deck format" in your instructions.' },
        prep_markdown: { type: 'string', description: 'The prep notes, in Markdown, following the sections in your instructions.' } }, required: ['deck', 'prep_markdown'] } }
  ];

  /* One streamed request. Returns { content: [...blocks], stop_reason }. */
  async function callClaude(body, key, onText, useFallback) {
    var headers = { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2026-10-21', 'anthropic-dangerous-direct-browser-access': 'true' };
    var payload = Object.assign({}, body);
    if (useFallback) { headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; payload.fallbacks = 'default'; }
    var res = await fetch(API, { method: 'POST', headers: headers, body: JSON.stringify(payload), signal: controller.signal });
    if (!res.ok) {
      var detail = ''; try { var j = await res.json(); detail = (j.error && j.error.message) || JSON.stringify(j); } catch (e) { detail = res.statusText; }
      if (useFallback && res.status === 400 && /fallback|beta/i.test(detail)) return callClaude(body, key, onText, false);
      var err = new Error(friendlyError(res.status, detail)); err.status = res.status; throw err;
    }
    var reader = res.body.getReader(), dec = new TextDecoder(), buf = '', blocks = [], partial = {}, stop = null;
    for (;;) {
      var chunk = await reader.read();
      if (chunk.done) break;
      buf += dec.decode(chunk.value, { stream: true });
      var parts = buf.split('\n\n'); buf = parts.pop();
      parts.forEach(function (evt) {
        var line = evt.split('\n').filter(function (l) { return l.indexOf('data:') === 0; }).map(function (l) { return l.slice(5).trim(); }).join('');
        if (!line) return;
        var d; try { d = JSON.parse(line); } catch (e) { return; }
        if (d.type === 'content_block_start') { blocks[d.index] = d.content_block; if (d.content_block.type === 'tool_use') partial[d.index] = ''; }
        else if (d.type === 'content_block_delta') {
          var b = blocks[d.index], dl = d.delta;
          if (dl.type === 'text_delta') { b.text = (b.text || '') + dl.text; onText(dl.text); }
          else if (dl.type === 'thinking_delta') b.thinking = (b.thinking || '') + dl.thinking;
          else if (dl.type === 'signature_delta') b.signature = (b.signature || '') + dl.signature;
          else if (dl.type === 'input_json_delta') partial[d.index] += dl.partial_json;
        } else if (d.type === 'content_block_stop') {
          var tb = blocks[d.index];
          if (tb && tb.type === 'tool_use') {
            try { tb.input = partial[d.index] ? JSON.parse(partial[d.index]) : {}; }
            catch (e) { tb.input = {}; tb._bad = true; }   // incomplete or invalid JSON: reported back to the model
          }
        } else if (d.type === 'message_delta') { if (d.delta && d.delta.stop_reason) stop = d.delta.stop_reason; }
        else if (d.type === 'error') { throw new Error((d.error && d.error.message) || 'The connection was interrupted.'); }
      });
    }
    return { content: blocks.filter(Boolean), stop_reason: stop };
  }
  function friendlyError(status, detail) {
    if (status === 401) return 'Anthropic did not accept that API key. Check it and try again.';
    if (status === 429) return 'Rate limit reached. Wait a minute and try again.\n' + detail;
    if (status === 529 || status >= 500) return 'Anthropic is overloaded or had an error. Try again shortly.\n' + detail;
    return 'The request was rejected (' + status + '): ' + detail;
  }
  /* Blocks go back to the API exactly as they came, minus our private flag. */
  function forReplay(blocks) { return blocks.map(function (b) { if (!b._bad) return b; var c = Object.assign({}, b); delete c._bad; return c; }); }

  async function start() {
    setError('');
    var key = $('key').value.trim(), prompt = $('prompt').value.trim();
    if (!prompt) return setError('Paste the case study prompt first.');
    if (!key) return setError('Add your Anthropic API key.');
    store('csm.key', $('remember').checked ? key : null);
    store('csm.author', $('author').value.trim());

    var system;
    try { system = await (await fetch('playbook.md', { cache: 'no-cache' })).text(); }
    catch (e) { return setError('Could not load playbook.md. If you opened this page as a file, run a local server instead (see the README).'); }

    var first = 'Here is my case study.\n\n<prompt>\n' + prompt + '\n</prompt>\n\n' +
      '<my_notes>\n' + ($('notes').value.trim() || 'None supplied.') + '\n</my_notes>\n\n' +
      '<data>\n' + profile() + '\n</data>\n\n' +
      'Presentation slot: ' + $('slot').value + '.\n' +
      'My name for the title slide: ' + ($('author').value.trim() || 'leave the author blank') + '.\n' +
      'Today\'s date: ' + new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) + '.\n\n' +
      'Analyse the data, make the call, then deliver the deck and the prep notes.';
    var messages = [{ role: 'user', content: first }];

    $('log').innerHTML = ''; show('logCard', true); show('outCard', false);
    $('run').disabled = true; show('stop', true);
    controller = new AbortController();
    var delivered = false;

    try {
      for (var turn = 0; turn < MAX_TURNS; turn++) {
        setStatus(delivered ? 'Wrapping up' : 'Thinking', true);
        var say = null;
        var res = await callClaude({ model: $('model').value, max_tokens: 64000, stream: true, system: system, tools: TOOLS, messages: messages,
          thinking: { type: 'adaptive' }, output_config: { effort: 'high' }, cache_control: { type: 'ephemeral' } }, key,
          function (t) { if (!say) { say = el('div', { 'class': 'say' }); $('log').appendChild(say); } say.textContent += t; }, true);

        if (res.stop_reason === 'refusal') throw new Error('The model declined this request. Try rewording the prompt, or pick a different model.');
        if (res.stop_reason === 'max_tokens') throw new Error('The model ran out of room mid-answer. Try again; if it keeps happening, shorten the prompt or notes.');
        messages.push({ role: 'assistant', content: forReplay(res.content) });
        var calls = res.content.filter(function (b) { return b.type === 'tool_use'; });
        if (res.stop_reason !== 'tool_use' || !calls.length) break;

        var results = [];
        for (var i = 0; i < calls.length; i++) {
          var c = calls[i], out;
          if (c._bad) out = { text: 'INVALID_JSON: the tool input was incomplete or not valid JSON. Send it again.', bad: true };
          else if (c.name === 'run_analysis') out = await doAnalysis(c.input);
          else if (c.name === 'deliver') { out = doDeliver(c.input); if (!out.bad) delivered = true; }
          else out = { text: 'Unknown tool.', bad: true };
          var tr = { type: 'tool_result', tool_use_id: c.id, content: out.text };
          if (out.bad) tr.is_error = true;
          results.push(tr);
        }
        messages.push({ role: 'user', content: results });   // all results in one message
      }
      if (!delivered) throw new Error('The run ended without a finished deck. Try again.');
      setStatus('Done');
    } catch (e) {
      if (e.name === 'AbortError') setStatus('Stopped'); else { setStatus(''); setError(e.message || String(e)); }
    } finally { $('run').disabled = false; show('stop', false); controller = null; }
  }

  async function doAnalysis(input) {
    var d = el('details'), s = el('summary', null, input.purpose || 'Calculation');
    d.appendChild(s); d.appendChild(el('pre', null, input.code || ''));
    $('log').appendChild(d);
    setStatus('Calculating: ' + (input.purpose || ''), true);
    if (typeof input.code !== 'string' || !input.code.trim()) { d.appendChild(el('pre', null, 'No code supplied.')); return { text: 'No code supplied.', bad: true }; }
    var r = await runAnalysis(input.code);
    if (!r.ok) { s.textContent += '  (error, retrying)'; d.appendChild(el('pre', null, r.error)); return { text: 'Error: ' + r.error, bad: true }; }
    if (r.result.length > MAX_RESULT_CHARS) { d.appendChild(el('pre', null, 'Result too large (' + r.result.length + ' characters).')); return { text: 'The result was ' + r.result.length + ' characters. Return a smaller summary (aggregate, or take the top rows).', bad: true }; }
    var pretty = r.result; try { pretty = JSON.stringify(JSON.parse(r.result), null, 1); } catch (e) { /* keep raw */ }
    d.appendChild(el('pre', null, pretty));
    return { text: r.result };
  }

  function doDeliver(input) {
    var errs = CSM.validate(input.deck);
    if (typeof input.prep_markdown !== 'string' || input.prep_markdown.length < 400) errs.push('prep_markdown is missing or too short');
    if (errs.length) { $('log').appendChild(el('div', { 'class': 'say' }, 'Fixing ' + errs.length + ' problem(s) in the deck.')); return { text: 'Fix these and call deliver again:\n- ' + errs.join('\n- '), bad: true }; }
    run = { version: 1, name: input.deck.meta.title, deck: input.deck, prep_markdown: input.prep_markdown };
    renderRun();
    return { text: 'Delivered. ' + input.deck.slides.length + ' slides.' };
  }

  /* ---------- showing the result ---------- */

  function safeHTML(md) {
    var doc = new DOMParser().parseFromString(marked.parse(md || ''), 'text/html');
    doc.querySelectorAll('script,style,iframe,object,embed,link,meta,form').forEach(function (n) { n.remove(); });
    doc.querySelectorAll('*').forEach(function (n) {
      Array.prototype.slice.call(n.attributes).forEach(function (a) {
        if (/^on/i.test(a.name) || (/^(href|src)$/i.test(a.name) && /^\s*(javascript|data):/i.test(a.value))) n.removeAttribute(a.name);
      });
    });
    return doc.body.innerHTML;
  }
  function renderRun() {
    if (!run) return;
    var box = $('slides'); box.innerHTML = '';
    CSM.layoutDeck(run.deck).forEach(function (s, i) {
      var d = el('div', { 'class': 'slide' });
      d.innerHTML = CSM.toSVG(s);
      var n = el('div', { 'class': 'sn' }); n.appendChild(el('b', null, 'Slide ' + (i + 1) + ' notes: ')); n.appendChild(document.createTextNode(s.notes || 'none'));
      d.appendChild(n); box.appendChild(d);
    });
    $('prep').innerHTML = safeHTML(run.prep_markdown);
    applyView(); show('outCard', true);
  }
  function applyView() {
    var on = $('showNotes').checked;
    document.querySelectorAll('.slide .sn').forEach(function (n) { n.classList.toggle('hidden', !on); });
    $('slides').classList.toggle('one', $('oneCol').checked);
  }
  function tab(which) {
    $('tabDeck').setAttribute('aria-selected', which === 'deck'); $('tabPrep').setAttribute('aria-selected', which === 'prep');
    show('deckPane', which === 'deck'); show('prepPane', which === 'prep');
  }
  function prepDocument() {
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + (run.name || 'Prep notes').replace(/</g, '&lt;') + '</title>' +
      '<style>body{font-family:Arial,sans-serif;font-size:11pt;max-width:760px;margin:40px auto;line-height:1.45}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px;vertical-align:top;text-align:left}th{background:#f0f0f0}</style></head><body>' +
      safeHTML(run.prep_markdown) + '</body></html>';
  }

  /* ---------- wiring ---------- */

  $('drop').onclick = function () { $('file').click(); };
  $('drop').onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('file').click(); } };
  $('file').onchange = function (e) { addFiles(e.target.files); e.target.value = ''; };
  ['dragenter', 'dragover'].forEach(function (t) { $('drop').addEventListener(t, function (e) { e.preventDefault(); $('drop').classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { $('drop').addEventListener(t, function (e) { e.preventDefault(); $('drop').classList.remove('over'); }); });
  $('drop').addEventListener('drop', function (e) { addFiles(e.dataTransfer.files); });

  $('run').onclick = start;
  $('stop').onclick = function () { if (controller) controller.abort(); };
  $('tabDeck').onclick = function () { tab('deck'); };
  $('tabPrep').onclick = function () { tab('prep'); };
  $('showNotes').onchange = applyView; $('oneCol').onchange = applyView;

  /* ---------- Google Drive ---------- */

  var gToken = null, gTokenExpires = 0;
  function clientId() { return GOOGLE_CLIENT_ID || load('csm.gclient') || ''; }
  function here(file) { return location.origin + location.pathname.replace(/[^/]*$/, '') + file; }

  /* Opens Google's sign-in in a small window. Google sends the window back to
     oauth.html, which passes the access token to this page and closes. */
  function googleSignIn() {
    if (gToken && Date.now() < gTokenExpires) return Promise.resolve(gToken);
    return new Promise(function (resolve, reject) {
      var state = Math.random().toString(36).slice(2) + Date.now().toString(36);
      var url = 'https://accounts.google.com/o/oauth2/v2/auth?response_type=token&include_granted_scopes=true' +
        '&client_id=' + encodeURIComponent(clientId()) + '&redirect_uri=' + encodeURIComponent(here('oauth.html')) +
        '&scope=' + encodeURIComponent(DRIVE_SCOPE) + '&state=' + state;
      var win = window.open(url, 'csm-google', 'width=520,height=640');
      if (!win) return reject(new Error('Your browser blocked the sign-in window. Allow pop-ups for this site and try again.'));
      var watch = setInterval(function () { if (win.closed) { cleanup(); reject(new Error('Sign-in was closed before it finished.')); } }, 700);
      function cleanup() { clearInterval(watch); window.removeEventListener('message', onMsg); }
      function onMsg(e) {
        if (e.origin !== location.origin || !e.data || e.data.source !== 'csm-oauth') return;
        cleanup();
        var q = new URLSearchParams(e.data.hash || '');
        if (q.get('state') !== state) return reject(new Error('Sign-in response did not match the request. Try again.'));
        if (q.get('error')) return reject(new Error('Google sign-in failed: ' + q.get('error')));
        gToken = q.get('access_token'); gTokenExpires = Date.now() + (parseInt(q.get('expires_in'), 10) || 3000) * 1000 - 60000;
        if (!gToken) return reject(new Error('Google did not return an access token.'));
        resolve(gToken);
      }
      window.addEventListener('message', onMsg);
    });
  }
  /* Uploads a file and asks Drive to convert it to a Google format. */
  async function driveCreate(token, name, googleType, blob) {
    var form = new FormData();
    form.append('metadata', new Blob([JSON.stringify({ name: name, mimeType: googleType })], { type: 'application/json' }));
    form.append('file', blob);
    var res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: form });
    var j = await res.json().catch(function () { return {}; });
    if (!res.ok) { if (res.status === 401) gToken = null; throw new Error('Google Drive refused the upload (' + res.status + '): ' + ((j.error && j.error.message) || 'unknown error')); }
    return j;
  }
  async function saveToDrive() {
    show('driveError', false); show('driveResult', false);
    if (!clientId()) { show('driveSetup', true); $('clientId').focus(); return; }
    var btn = $('toDrive'); btn.disabled = true; btn.textContent = 'Saving to Drive';
    try {
      var token = await googleSignIn();
      var pptx = await CSM.toPptx(PptxGenJS, run.deck).write({ outputType: 'blob' });
      var deck = await driveCreate(token, run.name, 'application/vnd.google-apps.presentation',
        new Blob([pptx], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }));
      var doc = await driveCreate(token, run.name + ': prep notes', 'application/vnd.google-apps.document', new Blob([prepDocument()], { type: 'text/html' }));
      var box = $('driveResult'); box.innerHTML = '';
      box.appendChild(document.createTextNode('Saved to your Drive: '));
      box.appendChild(el('a', { href: deck.webViewLink, target: '_blank', rel: 'noopener' }, 'open the deck in Google Slides'));
      box.appendChild(document.createTextNode(' and '));
      box.appendChild(el('a', { href: doc.webViewLink, target: '_blank', rel: 'noopener' }, 'the prep notes in Google Docs'));
      box.appendChild(document.createTextNode('.'));
      show('driveResult', true);
    } catch (e) { $('driveError').textContent = e.message || String(e); show('driveError', true); }
    finally { btn.disabled = false; btn.textContent = 'Save to Google Drive'; }
  }
  $('toDrive').onclick = saveToDrive;
  $('saveClientId').onclick = function () {
    var v = $('clientId').value.trim();
    if (!/\.apps\.googleusercontent\.com$/.test(v)) { $('driveError').textContent = 'That does not look like a client ID. It ends in .apps.googleusercontent.com'; show('driveError', true); return; }
    store('csm.gclient', v); show('driveSetup', false); saveToDrive();
  };

  $('dlPptx').onclick = function () { CSM.toPptx(PptxGenJS, run.deck).writeFile({ fileName: slug(run.name) + '.pptx' }); };
  $('dlPrep').onclick = function () { download(slug(run.name) + '-prep-notes.html', new Blob([prepDocument()], { type: 'text/html' })); };
  $('saveRun').onclick = function () { download(slug(run.name) + '-run.json', new Blob([JSON.stringify(run, null, 1)], { type: 'application/json' })); };
  $('copyPrep').onclick = async function () {
    var html = prepDocument(), btn = $('copyPrep');
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([run.prep_markdown], { type: 'text/plain' }) })]);
      btn.textContent = 'Copied';
    } catch (e) { try { await navigator.clipboard.writeText(run.prep_markdown); btn.textContent = 'Copied as plain text'; } catch (e2) { btn.textContent = 'Copy failed; use Download'; } }
    setTimeout(function () { btn.textContent = 'Copy notes for Google Docs'; }, 2500);
  };

  $('open').onclick = function () { $('openFile').click(); };
  $('openFile').onchange = function (e) {
    var f = e.target.files[0]; e.target.value = ''; if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var j = JSON.parse(reader.result), deck = j.deck || j, errs = CSM.validate(deck);
        if (errs.length) throw new Error(errs.slice(0, 5).join('; '));
        run = { version: 1, name: (deck.meta && deck.meta.title) || f.name, deck: deck, prep_markdown: j.prep_markdown || '' };
        setError(''); renderRun(); $('outCard').scrollIntoView({ behavior: 'smooth' });
      } catch (err) { setError('That file is not a saved run: ' + err.message); }
    };
    reader.readAsText(f);
  };

  var savedKey = load('csm.key'); if (savedKey) { $('key').value = savedKey; $('remember').checked = true; }
  var savedAuthor = load('csm.author'); if (savedAuthor) $('author').value = savedAuthor;

  window.CSMApp = { loadRun: function (j) { run = { version: 1, name: j.deck.meta.title, deck: j.deck, prep_markdown: j.prep_markdown || '' }; renderRun(); } };
})();
