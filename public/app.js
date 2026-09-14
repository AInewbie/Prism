import { outputList, createOutputViewer, saveOutput } from "./artifacts.js";
import { filterSessions } from "./session-search.js";

const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const criteria = ["accuracy", "usefulness", "clarity"];
const label = (key) => key[0].toUpperCase() + key.slice(1);
const S = {
  providers: [],
  connections: {},
  selected: new Set(["openai", "gemini", "grok", "claude"]),
  mode: "demo",
  outputMode: "text",
  run: null,
  view: "answers",
  blind: false,
  sort: "original",
  requests: new Set(),
  reviewQueue: Promise.resolve(),
  savingReviews: 0,
  notes: {},
  combinedDraft: null,
  combineBusy: false,
  creating: false,
  fileBusy: false,
  history: [],
  synthesisPreviewSignature: "",
  synthesisPreviewRequested: "",
  synthesisPreviewTimer: null,
};
let token = new URLSearchParams(location.hash.slice(1)).get("key");
if (token) {
  sessionStorage.setItem("prism-session", token);
  history.replaceState(null, "", location.pathname);
} else token = sessionStorage.getItem("prism-session") || "";
const p = (id) => S.providers.find((x) => x.id === id);
const score = (r) =>
  criteria.every((k) => Number.isInteger(r.scores[k]))
    ? Math.round((criteria.reduce((n, k) => n + r.scores[k], 0) / 3) * 10) / 10
    : null;
const name = (r) => (S.blind ? "Answer " + r.label : p(r.provider).name);
const models = (r) => r.imageModel && r.imageModel !== r.model ? r.model + " + " + r.imageModel : r.model;
const busy = () =>
  S.creating || S.fileBusy || S.requests.size > 0 || S.combineBusy || S.savingReviews > 0;
function toast(message, error = false) {
  $("toast").textContent = message;
  $("toast").className = error ? "error" : "";
  $("toast").hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(
    () => ($("toast").hidden = true),
    error ? 9000 : 4500,
  );
}
async function api(path, options = {}) {
  const response = await fetch("/api" + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Prism-Session": token,
      ...(options.headers || {}),
    },
    ...(options.data !== undefined
      ? { body: JSON.stringify(options.data) }
      : {}),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Error(data.error || "Request failed.");
  }
  return options.raw ? response : response.json();
}
function markdown(input) {
  // Escape first; model output never becomes arbitrary HTML, scripts or active links.
  const safe = esc(input),
    lines = safe.split("\n");
  let html = "",
    code = false,
    list = "";
  const inline = (s) =>
    s
      .replace(/\x60([^\x60]+)\x60/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/_([^_]+)_/g, "<em>$1</em>");
  const endList = () => {
    if (list) {
      html += "</" + list + ">";
      list = "";
    }
  };
  for (const line of lines) {
    if (line.startsWith(String.fromCharCode(96).repeat(3))) {
      endList();
      html += code ? "</code></pre>" : "<pre><code>";
      code = !code;
      continue;
    }
    if (code) {
      html += line + "\n";
      continue;
    }
    const li = line.match(/^(?:[-*]|\d+\.)\s+(.*)$/);
    if (li) {
      const type = /^\d/.test(line) ? "ol" : "ul";
      if (list !== type) {
        endList();
        html += "<" + type + ">";
        list = type;
      }
      html += "<li>" + inline(li[1]) + "</li>";
      continue;
    }
    endList();
    if (/^#{1,6}\s/.test(line))
      html += "<h3>" + inline(line.replace(/^#{1,6}\s+/, "")) + "</h3>";
    else if (line.trim()) html += "<p>" + inline(line) + "</p>";
  }
  endList();
  if (code) html += "</code></pre>";
  return html;
}
function withFocus(fn) {
  const el = document.activeElement,
    id = el?.id,
    start = el?.selectionStart,
    end = el?.selectionEnd;
  const scrolls = [...document.querySelectorAll(".answer-scroll")].map((n) => [
    n.dataset.provider,
    n.scrollTop,
  ]);
  fn();
  for (const [provider, top] of scrolls) {
    const node = document.querySelector(
      '.answer-scroll[data-provider="' + provider + '"]',
    );
    if (node) node.scrollTop = top;
  }
  if (id && $(id) && el !== $(id)) {
    $(id).focus({ preventScroll: true });
    if (typeof start === "number") $(id).setSelectionRange?.(start, end);
  }
}
function acceptRun(run, force = false) {
  if (
    force ||
    !S.run ||
    (run.id === S.run.id && run.revision >= S.run.revision)
  )
    S.run = run;
  if (S.run) localStorage.setItem("prism-last-run", S.run.id);
}
function renderProviders() {
  $("provider-picker").innerHTML = S.providers
    .map((provider) => {
      const c = S.connections[provider.id];
      const supported = S.outputMode === "text" || ["openai", "gemini"].includes(provider.id);
      return (
        '<label class="provider-chip ' + (supported ? '' : 'unsupported') + '"><span class="provider-icon ' +
        provider.id +
        '">' +
        provider.letter +
        '</span><div><span class="provider-name">' +
        esc(provider.name) +
        "</span><small>" +
        (!supported
          ? "Text output only in Prism"
          : S.mode === "demo"
          ? (S.outputMode === 'visual' ? "Visual sample" : "Text sample")
          : c?.hasKey
            ? esc(S.outputMode === 'visual' && provider.id === 'gemini' ? c.imageModel || "Choose an image model" : c.model || "Choose a model")
            : "Connect API key") +
        '</small></div><input type="checkbox" data-provider-pick="' +
        provider.id +
        '" aria-label="Include ' +
        provider.name +
        '" ' +
        (S.selected.has(provider.id) ? "checked" : "") + (supported ? '' : ' disabled') +
        "></label>"
      );
    })
    .join("");
  $("connection-count").textContent =
    Object.values(S.connections).filter((c) => c.hasKey).length + "/4";
  $("send-caption").textContent = S.selected.size + " models · " + (S.outputMode === 'visual' ? 'generated image' : 'text / files');
  $("mode-note").textContent =
    S.mode === "demo"
      ? "Explore with clearly labelled sample answers. Add your API keys for real responses."
      : "Sends your prompt to " +
        S.selected.size +
        " selected provider(s). " + (S.outputMode === 'visual' ? 'Image generation charges can apply. ' : '') + "No automatic retries.";
  $("send-button").disabled = busy() || !S.selected.size;
}
async function refreshHistory() {
  const data = await api("/runs");
  S.history = data.runs;
  renderHistory();
}
function renderHistory() {
  const query = $("session-search").value;
  const mode = $("session-mode").value;
  const matches = filterSessions(S.history, { query, mode });
  $("history-count").textContent = S.history.length;
  $("session-result-count").textContent = matches.length + " of " + S.history.length + " sessions";
  $("clear-session-search").disabled = !query && mode === "all";
  $("history-list").innerHTML = matches.length
    ? matches
        .map(
          (run) =>
            '<button class="history-item ' +
            (run.id === S.run?.id ? "current" : "") +
            '" data-load="' +
            run.id +
            '" ' +
            (busy() ? "disabled" : "") +
            "><strong>" +
            esc(run.title) +
            "</strong><small>" +
            (run.mode === "demo" ? "DEMO" : "LIVE") +
            " · " +
            new Date(run.createdAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            }) +
            " · " +
            run.completed +
            "/" +
            run.total +
            " answers</small></button>",
        )
        .join("")
    : '<p class="quiet">' + (S.history.length
      ? 'No sessions match. Try another title or clear the filters.'
      : 'Your comparisons will appear here.') + '</p>';
}
function sortedResponses() {
  const result = [...S.run.responses];
  if (S.sort === "score")
    result.sort((a, b) => (score(b) ?? -1) - (score(a) ?? -1));
  if (S.sort === "speed")
    result.sort(
      (a, b) => (a.elapsedMs ?? Infinity) - (b.elapsedMs ?? Infinity),
    );
  return result;
}
const outputViewer = createOutputViewer();
const runFiles = (owner) => (S.run.artifacts || []).filter(file => (owner.artifactIds || []).includes(file.id));
async function openOutput(id, download = false) {
  const runId = S.run.id;
  try {
    const { artifact } = await api('/runs/' + runId + '/artifacts/' + id);
    if (S.run.id !== runId) return;
    if (artifact.encoding !== 'base64') return toast('Attach a downloaded copy of this provider file.');
    if (download) saveOutput(artifact);
    else outputViewer.open(artifact, S.blind ? 'Output file · identity hidden' : artifact.name);
  } catch (error) { toast(error.message, true); }
}
async function attachOutputs(input) {
  const files = [...input.files], runId = S.run.id, provider = input.dataset.attach;
  if (!files.length || busy()) return;
  if (files.length > 8 || files.some(f => f.size > 4000000) || files.reduce((n, f) => n + f.size, 0) > 4000000) {
    input.value = ''; return toast('Attach up to 8 files, totalling at most 4 MB per upload.', true);
  }
  S.fileBusy = true;
  try {
    const version = S.run.responses.find(r => r.provider === provider).fileVersion || 0;
    const encoded = await Promise.all(files.map(file => new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onerror = () => reject(Error('Could not read file.'));
      reader.onload = () => resolve({ name: file.name, mimeType: file.type, data: String(reader.result).split(',')[1] });
      reader.readAsDataURL(file);
    })));
    const result = await api('/runs/' + runId + '/artifacts', { method: 'POST', data: { provider, version, files: encoded } });
    if (S.run.id === runId) { acceptRun(result.run); renderSession(); }
    toast('Files saved. Scores and selection reset so you can review the updated answer.');
  } catch (error) { toast(error.message, true); }
  finally { S.fileBusy = false; input.value = ''; renderSession(); }
}
function renderCards() {
  const rows = sortedResponses();
  $("answer-grid").className = "answer-grid count-" + rows.length;
  $("answer-grid").innerHTML = rows
    .map((r) => {
      const done = r.status === "complete",
        running = S.requests.has(r.provider) || r.status === "running",
        grade = score(r);
      const body = done
        ? (r.warning
            ? '<p class="answer-warning">' + esc(r.warning) + "</p>"
            : "") +
          '<div class="answer-text">' +
          markdown(r.text) +
          "</div>"
        : running
          ? '<div class="waiting"><span class="spinner"></span><span>Waiting for ' +
            esc(name(r)) +
            "…</span></div>"
          : '<div class="answer-error">' +
            esc(r.error || "This answer has not been requested yet.") +
            '</div><button class="button" data-retry="' +
            r.provider +
            '">' +
            (r.error ? "Retry this model" : "Request answer") +
            "</button>";
      return (
        '<article class="answer-card ' +
        (r.selected ? "selected" : "") +
        '" aria-label="Answer ' +
        r.label +
        '"><div class="answer-head"><span class="provider-icon ' +
        (S.blind ? "" : r.provider) +
        '">' +
        (S.blind ? r.label : p(r.provider).letter) +
        "</span><div><h3>" +
        esc(name(r)) +
        "</h3><small>" +
        esc(S.blind ? "Blind review" : models(r)) +
        '</small></div><span class="score-badge" aria-label="Overall score ' +
        (grade ?? "unscored") +
        '">' +
        (grade?.toFixed(1) ?? "—") +
        '<small>/5</small></span></div><div class="metrics"><span>' +
        (S.run.mode === "demo"
          ? "SAMPLE · NO API CALL"
          : r.elapsedMs !== null
            ? (r.elapsedMs / 1000).toFixed(1) + "s elapsed"
            : "Awaiting response") +
        "</span><span>" +
        (r.outputTokens !== null ? r.outputTokens + " output tokens" : "") +
        '</span></div><div class="answer-scroll" data-provider="' +
        r.provider +
        '">' +
        body +
        "</div>" +
        (done ? outputList(runFiles(r), { blind: S.blind }) + '<label class="attach-outputs">Attach outputs<input type="file" multiple data-attach="' + r.provider + '" aria-label="Attach outputs to answer ' + r.label + '" ' + (busy() ? 'disabled' : '') + '><small>Files from this model’s response · up to 4 MB per upload</small></label>' : '') +
        (done
          ? '<div class="review-panel"><div class="review-label"><span>YOUR SCORE</span><span>' +
            criteria.filter((k) => r.scores[k] !== null).length +
            "/3 rated</span></div>" +
            criteria
              .map(
                (k) =>
                  '<div class="score-row"><span>' +
                  label(k) +
                  '</span><div class="score-options" role="radiogroup" aria-label="' +
                  label(k) +
                  " for answer " +
                  r.label +
                  '">' +
                  [1, 2, 3, 4, 5]
                    .map(
                      (n) =>
                        '<button type="button" role="radio" aria-checked="' +
                        (r.scores[k] === n) +
                        '" aria-label="' +
                        label(k) +
                        " " +
                        n +
                        " of 5 for answer " +
                        r.label +
                        '" data-rate="' +
                        r.provider +
                        '" data-criterion="' +
                        k +
                        '" data-value="' +
                        n +
                        '">' +
                        n +
                        "</button>",
                    )
                    .join("") +
                  "</div></div>",
              )
              .join("") +
            '<label class="notes-label">Notes for answer ' +
            r.label +
            '<textarea aria-label="Notes for answer ' +
            r.label +
            '" id="notes-' +
            r.provider +
            '" data-notes="' +
            r.provider +
            '" rows="2" maxlength="5000" placeholder="What stands out? What needs checking?">' +
            esc(S.notes[r.provider] ?? r.notes) +
            "</textarea></label></div>" +
            '<div class="answer-footer"><label class="check-label"><input type="checkbox" data-select="' +
            r.provider +
            '" ' +
            (r.selected ? "checked" : "") +
            '>Use in combined answer</label><button class="text-button" data-copy="' +
            r.provider +
            '">Copy ↗</button></div>'
          : "") +
        "</article>"
      );
    })
    .join("");
}
function renderScorecard() {
  const rated = [...S.run.responses].sort(
    (a, b) => (score(b) ?? -1) - (score(a) ?? -1),
  );
  $("scorecard-view").innerHTML =
    '<div class="scorecard"><table><thead><tr><th>ANSWER</th><th>ACCURACY</th><th>USEFULNESS</th><th>CLARITY</th><th>OVERALL / 5</th></tr></thead><tbody>' +
    rated
      .map(
        (r) =>
          "<tr><td><strong>" +
          esc(name(r)) +
          "</strong><small>Answer " +
          r.label +
          (S.blind ? "" : " · " + esc(models(r))) +
          "</small></td>" +
          criteria
            .map((k) => "<td>" + (r.scores[k] ?? "—") + "</td>")
            .join("") +
          '<td><span class="score-badge">' +
          (score(r)?.toFixed(1) ?? "—") +
          "</span></td></tr>",
      )
      .join("") +
    '</tbody></table><p class="scorecard-note">Your judgment, on a 1–5 scale. Overall scores are equal-weight averages and appear only after all three criteria are rated. Unscored answers are not treated as zero. Accuracy scores are your assessment, not an independent fact check.</p></div>';
}
function renderCombine() {
  const run = S.run,
    selected = run.responses.filter(
      (r) => r.selected && r.status === "complete",
    ),
    selectedImages = selected.flatMap((r) => runFiles(r)).filter((file) =>
      ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimeType));
  $("combine-sources").innerHTML = run.responses
    .filter((r) => r.status === "complete")
    .map(
      (r) =>
        '<label class="source-option"><span class="check-label"><input type="checkbox" data-select="' +
        r.provider +
        '" ' +
        (r.selected ? "checked" : "") +
        ">Answer " +
        r.label +
        (S.blind ? "" : " · " + esc(p(r.provider).name)) +
        "</span><small>" +
        (score(r) !== null ? score(r).toFixed(1) + "/5" : "Unscored") +
        "</small></label>",
    )
    .join("");
  $("combined-files").innerHTML = outputList(runFiles(run.combined), { blind: S.blind });
  const prior = $("synth-provider").value;
  $("synth-provider").innerHTML = S.providers
    .map(
      (provider) =>
        '<option value="' +
        provider.id +
        '">' +
        esc(provider.name) +
        " · " +
        esc(
          run.mode === "demo"
            ? "Demo sample"
            : S.connections[provider.id]?.model || "Not configured",
        ) +
        "</option>",
    )
    .join("");
  if (prior) $("synth-provider").value = prior;
  const currentVisualProviderSupported = ['openai', 'gemini', 'claude'].includes($("synth-provider").value);
  if (S.combinedDraft === null) $("combined-text").value = run.combined.text;
  $("combined-meta").textContent = run.combined.method
    ? run.combined.method + " · Sources " + run.combined.sources.join(", ") +
      (run.combined.fileContentMode === "bounded-readable-text" ? " · readable file contents used" : "") +
      (run.combined.imageContentMode === "bounded-inline-images" ? " · images visually inspected" : "")
    : "An editable space for the strongest ideas.";
  $("combined-save-state").textContent =
    S.combinedDraft !== null
      ? "Unsaved changes"
      : run.combined.text
        ? "Saved locally"
        : "No draft yet";
  $("compile-button").disabled =
    busy() ||
    !selected.length ||
    S.combinedDraft !== null ||
    Object.keys(S.notes).length > 0;
  $("synthesize-button").disabled =
    busy() ||
    !selected.length ||
    S.combinedDraft !== null ||
    Object.keys(S.notes).length > 0 ||
    ($("include-images").checked && !currentVisualProviderSupported);
  $("synthesize-button").textContent = S.combineBusy
    ? "Combining…"
    : run.mode === "demo"
      ? "Try sample combination ✧"
      : "Synthesize selected answers ✧";
  $("synthesis-note").textContent =
    run.mode === "demo"
      ? "Demo: combines the local samples without calling any provider. The exact preview shows what a live synthesis would disclose."
      : "One API request to " +
        p($("synth-provider").value)?.name +
        ". Sends answer text, scores, notes and file metadata" +
        ($("include-readable-files").checked ? ", plus the readable file contents shown below. " : ". File contents stay local. ") +
        ($("include-images").checked
          ? (currentVisualProviderSupported ? "Selected images are sent for visual inspection. " : "Choose ChatGPT, Gemini or Claude to inspect images. ")
          : "Image bytes stay local. ") +
        "Original files stay attached to the draft. API charges apply.";
  $("include-readable-files").disabled = busy();
  $("include-images").disabled = busy() || !selectedImages.length;
  $("image-synthesis-help").textContent = selectedImages.length
    ? selectedImages.length + " compatible selected image" + (selectedImages.length === 1 ? "" : "s") +
      ". Up to 6 / 8 MB total will be sent when enabled."
    : "No compatible PNG, JPEG or WebP image is attached to the selected answers.";
  queueSynthesisPreview(selected);
  $("combined-text").disabled = S.combineBusy;
  $("save-combined").disabled = S.combineBusy || S.combinedDraft === null;
  const history = [...(run.combinedHistory || [])].reverse();
  const priorRevision = $("history-select").value;
  $("draft-revision-count").textContent = history.length + " saved revisions";
  $("history-select").innerHTML = history.map((draft) =>
    '<option value="' + esc(draft.historyId) + '">Revision ' + draft.version +
    ' · ' + esc(draft.method) + '</option>',
  ).join("");
  if (history.some((draft) => draft.historyId === priorRevision))
    $("history-select").value = priorRevision;
  renderHistoryPreview();
}
function queueSynthesisPreview(selected) {
  clearTimeout(S.synthesisPreviewTimer);
  if (!selected.length) {
    S.synthesisPreviewSignature = "";
    $("synthesis-preview").textContent = "Select at least one completed answer.";
    return;
  }
  const request = {
    providers: selected.map((r) => r.provider),
    direction: $("combine-direction").value,
    includeReadableFiles: $("include-readable-files").checked,
    includeImages: $("include-images").checked,
    provider: $("synth-provider").value,
  };
  const signature = S.run.id + ":" + S.run.updatedAt + ":" + JSON.stringify(request);
  if (signature === S.synthesisPreviewSignature) return;
  S.synthesisPreviewRequested = signature;
  $("synthesis-preview").textContent = "Preparing exact payload preview…";
  S.synthesisPreviewTimer = setTimeout(async () => {
    try {
      const data = await api("/runs/" + S.run.id + "/synthesis-preview", { method: "POST", data: request });
      if (signature !== S.synthesisPreviewRequested) return;
      S.synthesisPreviewSignature = signature;
      $("synthesis-preview").textContent = JSON.stringify(data, null, 2);
    } catch (error) {
      $("synthesis-preview").textContent = "Preview unavailable: " + error.message;
    }
  }, 180);
}
function renderHistoryPreview() {
  const draft = (S.run.combinedHistory || []).find(
    (item) => item.historyId === $("history-select").value,
  );
  $("history-preview").value = draft?.text || "";
  $("history-files").innerHTML = draft ? outputList(runFiles(draft), { blind: S.blind }) : "";
  $("history-meta").textContent = draft
    ? "Saved " + new Date(draft.savedAt).toLocaleString() +
      " · Sources " + (draft.sources.join(", ") || "manual")
    : "Your previous saved drafts will appear here after the next change.";
  $("restore-draft").disabled = !draft || busy() || S.combinedDraft !== null;
}
function renderSession() {
  if (!S.run) return;
  withFocus(() => {
    const run = S.run;
    $("session").hidden = false;
    $("empty-state").hidden = true;
    $("composer").hidden = true;
    $("welcome").hidden = true;
    $("session-title").textContent = "A wider view of your question";
    $("saved-prompt-text").textContent = run.prompt;
    $("saved-instructions").hidden = !run.instructions;
    $("saved-instructions").querySelector("p").textContent = run.instructions;
    $("answer-count").textContent =
      run.responses.filter((r) => r.status === "complete").length +
      "/" +
      run.responses.length;
    $("session-note").textContent =
      (run.mode === "demo"
        ? "DEMO SESSION · Fixed sample answers, not real outputs from these models. "
        : "LIVE SESSION · Responses are saved as they arrive. ") +
      ((run.outputMode || "text") === "visual" ? "Requested generated image; provider text is retained when available. " : "Requested text / code / files. ") +
      (S.blind
        ? "Model identities are hidden; answer order is randomized per session."
        : "Score what matters to you. Select answers to build your combined draft.");
    document
      .querySelectorAll("[data-view]")
      .forEach((button) =>
        button.setAttribute("aria-selected", button.dataset.view === S.view),
      );
    for (const view of ["answers", "scorecard", "combined"])
      $(view + "-view").hidden = view !== S.view;
    renderCards();
    renderScorecard();
    renderCombine();
    const count = run.responses.filter((r) => r.selected).length;
    $("selected-count").textContent =
      count + (count === 1 ? " answer" : " answers");
    $("go-combine").disabled = !count || busy();
    $("stop-button").hidden = !S.requests.size && !S.combineBusy;
    $("new-comparison").disabled = busy();
    $("export-json").disabled = busy();
    $("export-zip").disabled = busy();
    $("export-md").disabled = busy();
    renderHistory();
  });
}
async function saveReview(id, patch) {
  S.savingReviews++;
  const task = S.reviewQueue
    .then(async () => {
      const r = S.run.responses.find((r) => r.provider === id);
      const data = await api("/runs/" + S.run.id + "/review", {
        method: "PATCH",
        data: { provider: id, version: r.reviewVersion, ...patch },
      });
      acceptRun(data.run);
      if (patch.notes !== undefined && S.notes[id] === patch.notes)
        delete S.notes[id];
    })
    .catch((e) => {
      toast(e.message, true);
    })
    .finally(() => {
      S.savingReviews--;
      renderSession();
    });
  S.reviewQueue = task;
  return task;
}
async function requestAnswer(providerId) {
  const runId = S.run.id;
  S.requests.add(providerId);
  renderSession();
  try {
    const data = await api("/runs/" + runId + "/answer", {
      method: "POST",
      data: { provider: providerId },
    });
    acceptRun(data.run);
  } catch (e) {
    toast(e.message, true);
    try {
      acceptRun((await api("/runs/" + runId)).run);
    } catch {
      /* keep the visible saved snapshot */
    }
  } finally {
    S.requests.delete(providerId);
    renderSession();
    await refreshHistory();
  }
}
async function start(event) {
  event.preventDefault();
  if (busy()) return;
  S.creating = true;
  renderProviders();
  try {
    const data = await api("/runs", {
      method: "POST",
      data: {
        prompt: $("prompt").value,
        instructions: $("instructions").value,
        maxTokens: Number($("max-tokens").value),
        outputMode: S.outputMode,
        mode: S.mode,
        providers: [...S.selected],
      },
    });
    S.notes = {};
    S.combinedDraft = null;
    S.view = "answers";
    acceptRun(data.run, true);
    S.creating = false;
    renderSession();
    await Promise.allSettled(
      data.run.responses.map((r) => requestAnswer(r.provider)),
    );
  } catch (e) {
    toast(e.message, true);
  } finally {
    S.creating = false;
    renderProviders();
  }
}
async function loadRun(id) {
  if (busy())
    return toast("Wait for the current request or review save to finish.");
  if (S.combinedDraft !== null || Object.keys(S.notes).length)
    return toast("Save your draft and notes before switching sessions.", true);
  try {
    acceptRun((await api("/runs/" + id)).run, true);
    S.view = "answers";
    S.notes = {};
    S.combinedDraft = null;
    renderSession();
    refreshHistory();
    $("session").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    toast(e.message, true);
  }
}
function newComparison() {
  if (busy()) return;
  if (S.combinedDraft !== null || Object.keys(S.notes).length)
    return toast(
      "Save your draft and notes before starting another comparison.",
      true,
    );
  S.run = null;
  S.notes = {};
  S.combinedDraft = null;
  localStorage.removeItem("prism-last-run");
  $("session").hidden = true;
  $("composer").hidden = false;
  $("welcome").hidden = false;
  $("empty-state").hidden = false;
  renderProviders();
  renderHistory();
  $("prompt").focus();
}
async function copy(value) {
  try {
    await navigator.clipboard.writeText(value);
    toast("Copied to clipboard.");
  } catch {
    toast(
      "Clipboard is unavailable. Select the text and copy it manually.",
      true,
    );
  }
}
async function exportRun(format) {
  if (S.combinedDraft !== null || Object.keys(S.notes).length)
    return toast("Save your draft and notes before exporting.", true);
  try {
    const response = await api(
      "/runs/" + S.run.id + "/export?format=" + format,
      { raw: true },
    );
    const url = URL.createObjectURL(await response.blob()),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "prism-" + S.run.id.slice(0, 8) + "." + format;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  } catch (e) {
    toast(e.message, true);
  }
}
async function combine(method) {
  if (busy() || S.combinedDraft !== null || Object.keys(S.notes).length) return;
  const selected = S.run.responses.filter(
    (r) => r.selected && r.status === "complete",
  );
  if (!selected.length) return toast("Select at least one answer.");
  S.combineBusy = true;
  renderSession();
  try {
    const data = await api("/runs/" + S.run.id + "/combine", {
      method: "POST",
      data: {
        method,
        providers: selected.map((r) => r.provider),
        provider: $("synth-provider").value,
        direction: $("combine-direction").value,
        includeReadableFiles: $("include-readable-files").checked,
        includeImages: $("include-images").checked,
        version: S.run.combined.version,
      },
    });
    acceptRun(data.run);
    S.combinedDraft = null;
    toast(
      method === "compile"
        ? "Your editable compilation is ready."
        : "Combined draft ready. Review before using.",
    );
  } catch (e) {
    toast(e.message, true);
  } finally {
    S.combineBusy = false;
    renderSession();
  }
}
function renderConnections() {
  $("connection-forms").innerHTML = S.providers
    .map((provider) => {
      const c = S.connections[provider.id];
      return (
        '<form class="connection-form" data-connect="' +
        provider.id +
        '"><div class="connection-header"><span class="provider-icon ' +
        provider.id +
        '">' +
        provider.letter +
        "</span><strong>" +
        esc(provider.name) +
        "</strong><small>" +
        esc(provider.company) +
        '</small><a href="' +
        esc(provider.url) +
        '" target="_blank" rel="noopener noreferrer">Get an API key ↗</a></div>' +
        '<div class="connection-inputs"><label>API key<input type="password" id="key-' +
        provider.id +
        '" autocomplete="off" maxlength="4096" placeholder="' +
        (c?.hasKey ? "Key saved · blank keeps it" : "Paste your API key") +
        '"></label><label>Text model ID<input id="model-' +
        provider.id +
        '" list="models-' +
        provider.id +
        '" value="' +
        esc(c?.model || "") +
        '" placeholder="Enter an ID or load models" maxlength="120"><datalist id="models-' +
        provider.id +
        '"></datalist></label>' +
        (["openai", "gemini"].includes(provider.id) ? '<label>Image model ID<input id="image-model-' + provider.id + '" list="models-' + provider.id + '" value="' + esc(c?.imageModel || '') + '" placeholder="For text + generated image" maxlength="120"></label>' : '') + '</div>' +
        '<div class="connection-actions"><label class="check-label"><input id="remember-' +
        provider.id +
        '" type="checkbox" ' +
        (c?.remembered ? "checked" : "") +
        '>Remember on device</label><button type="button" class="button" data-models="' +
        provider.id +
        '">Load models</button><button type="button" class="button" data-disconnect="' +
        provider.id +
        '">Disconnect</button><button class="button primary" type="submit">Save connection</button></div><p class="connection-status" id="status-' +
        provider.id +
        '">' +
        (c?.hasKey
          ? "Key saved" +
            (c.remembered ? " on device" : " for this server session") +
            (c.model ? " · text model configured" : " · choose a text model") +
            (["openai", "gemini"].includes(provider.id) ? (c.imageModel ? " · image model configured" : " · image model optional") : "")
          : "Not connected") +
        "</p></form>"
      );
    })
    .join("");
}
function openConnections() {
  renderConnections();
  $("connections-dialog").showModal();
}
$("composer").addEventListener("submit", start);
$("sample-prompt").onclick = () => {
  $("prompt").value =
    "Give me a practical plan to turn an idea into a useful app. Compare the trade-offs and tell me what to test first.";
  $("prompt").focus();
};
$("mode").onchange = () => {
  S.mode = $("mode").value;
  renderProviders();
};
$("output-mode").onchange = () => {
  S.outputMode = $("output-mode").value;
  if (S.outputMode === "visual") {
    const removed = [...S.selected].filter((id) => !["openai", "gemini"].includes(id));
    removed.forEach((id) => S.selected.delete(id));
    if (!S.selected.size) ["openai", "gemini"].forEach((id) => S.selected.add(id));
    if (removed.length) toast("Visual comparison uses OpenAI and Gemini; text-only providers were deselected.");
  }
  renderProviders();
};
$("provider-picker").onchange = (event) => {
  const id = event.target.dataset.providerPick;
  if (!id) return;
  event.target.checked ? S.selected.add(id) : S.selected.delete(id);
  renderProviders();
};
$("new-comparison").onclick = newComparison;
$("studio-nav").onclick = () => (S.run ? renderSession() : newComparison());
$("history-list").onclick = (event) => {
  const button = event.target.closest("[data-load]");
  if (button) loadRun(button.dataset.load);
};
$("session-search").oninput = renderHistory;
$("session-mode").onchange = renderHistory;
$("clear-session-search").onclick = () => {
  $("session-search").value = "";
  $("session-mode").value = "all";
  renderHistory();
  $("session-search").focus();
};
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" &&
      !event.altKey && !document.querySelector("dialog[open]")) {
    event.preventDefault();
    $("session-search").focus();
    $("session-search").select();
  }
});
$("blind").onchange = () => {
  S.blind = $("blind").checked;
  renderSession();
};
$("sort").onchange = () => {
  S.sort = $("sort").value;
  renderSession();
};
document.querySelectorAll("[data-view]").forEach(
  (button) =>
    (button.onclick = () => {
      S.view = button.dataset.view;
      renderSession();
    }),
);
$("go-combine").onclick = () => {
  S.view = "combined";
  renderSession();
  $("combined-view").scrollIntoView({ behavior: "smooth", block: "start" });
};
document.addEventListener("click", (event) => {
  const opened = event.target.closest('[data-output-open]'), downloaded = event.target.closest('[data-output-download]');
  if (opened) openOutput(opened.dataset.outputOpen);
  if (downloaded) openOutput(downloaded.dataset.outputDownload, true);
  const rate = event.target.closest("[data-rate]"),
    retry = event.target.closest("[data-retry]"),
    copyButton = event.target.closest("[data-copy]");
  if (rate) {
    const r = S.run.responses.find((r) => r.provider === rate.dataset.rate),
      value = Number(rate.dataset.value);
    saveReview(r.provider, {
      scores: {
        [rate.dataset.criterion]:
          r.scores[rate.dataset.criterion] === value ? null : value,
      },
    });
  }
  if (retry) requestAnswer(retry.dataset.retry);
  if (copyButton)
    copy(
      S.run.responses.find((r) => r.provider === copyButton.dataset.copy).text,
    );
});
document.addEventListener("change", (event) => {
  const { target } = event;
  if (target.dataset.attach) attachOutputs(target);
  if (target.dataset.select)
    saveReview(target.dataset.select, { selected: target.checked });
  if (target.dataset.notes)
    saveReview(target.dataset.notes, { notes: target.value });
});
document.addEventListener("input", (event) => {
  const id = event.target.dataset.notes;
  if (id) {
    if (
      event.target.value ===
      S.run.responses.find((r) => r.provider === id).notes
    )
      delete S.notes[id];
    else S.notes[id] = event.target.value;
  }
});
$("combined-text").oninput = () => {
  S.combinedDraft =
    $("combined-text").value === S.run.combined.text
      ? null
      : $("combined-text").value;
  renderCombine();
};
$("save-combined").onclick = async () => {
  if (S.combinedDraft === null || S.combineBusy) return;
  const value = S.combinedDraft;
  $("save-combined").disabled = true;
  try {
    acceptRun(
      (
        await api("/runs/" + S.run.id + "/combined", {
          method: "PATCH",
          data: { text: value, version: S.run.combined.version },
        })
      ).run,
    );
    if (S.combinedDraft === value) S.combinedDraft = null;
    renderCombine();
    toast("Draft saved locally.");
  } catch (e) {
    toast(e.message, true);
    $("save-combined").disabled = false;
  }
};
$("copy-combined").onclick = () => copy($("combined-text").value);
$("history-select").onchange = renderHistoryPreview;
$("restore-draft").onclick = async () => {
  if (busy() || S.combinedDraft !== null) return;
  const historyId = $("history-select").value;
  if (!historyId) return;
  S.combineBusy = true;
  renderCombine();
  try {
    acceptRun((await api("/runs/" + S.run.id + "/combined", {
      method: "PATCH",
      data: { historyId, version: S.run.combined.version },
    })).run);
    toast("Revision restored. Your previous draft is kept in history.");
  } catch (e) {
    toast(e.message, true);
  } finally {
    S.combineBusy = false;
    renderCombine();
  }
};
$("compile-button").onclick = () => combine("compile");
$("synthesize-button").onclick = () => combine("synthesize");
$("synth-provider").onchange = renderCombine;
$("combine-direction").oninput = renderCombine;
$("include-readable-files").onchange = () => {
  S.synthesisPreviewSignature = "";
  renderCombine();
};
$("include-images").onchange = () => {
  S.synthesisPreviewSignature = "";
  renderCombine();
};
$("stop-button").onclick = async () => {
  try {
    await api("/runs/" + S.run.id + "/stop", { method: "POST", data: {} });
    toast("Stop requested. Completed answers are kept.");
  } catch (e) {
    toast(e.message, true);
  }
};
$("export-zip").onclick = () => exportRun("zip");
$("export-json").onclick = () => exportRun("json");
$("export-md").onclick = () => exportRun("md");
$("connections-button").onclick = openConnections;
$("connections-sidebar").onclick = openConnections;
$("close-connections").onclick = () => $("connections-dialog").close();
$("connection-forms").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = event.target.dataset.connect,
    button = event.submitter;
  button.disabled = true;
  try {
    const result = await api("/connections/" + id, {
      method: "PUT",
      data: {
        key: $("key-" + id).value,
        model: $("model-" + id).value.trim(),
        imageModel: $("image-model-" + id)?.value.trim() || "",
        remember: $("remember-" + id).checked,
      },
    });
    S.connections = result.connections;
    $("key-" + id).value = "";
    $("key-" + id).placeholder = "Key saved · blank keeps it";
    $("status-" + id).textContent = "Connection saved. No provider was called.";
    renderProviders();
  } catch (e) {
    $("status-" + id).textContent = e.message;
    toast(e.message, true);
  } finally {
    button.disabled = false;
  }
});
$("connection-forms").addEventListener("click", async (event) => {
  const models = event.target.closest("[data-models]"),
    disconnect = event.target.closest("[data-disconnect]");
  const button = models || disconnect;
  if (!button) return;
  const id = models?.dataset.models || disconnect.dataset.disconnect;
  button.disabled = true;
  try {
    if (models) {
      const result = await api("/models/" + id, { method: "POST", data: {} });
      $("models-" + id).innerHTML = result.models
        .map((m) => '<option value="' + esc(m) + '"></option>')
        .join("");
      $("status-" + id).textContent =
        result.models.length +
        " model IDs loaded" +
        (result.partial ? " (partial list)" : "") +
        ". Choose a text model and save.";
      $("model-" + id).focus();
    } else {
      S.connections = (
        await api("/connections/" + id, { method: "DELETE", data: {} })
      ).connections;
      renderConnections();
      renderProviders();
      toast(
        "Disconnected locally. This does not revoke the key at the provider.",
      );
    }
  } catch (e) {
    $("status-" + id).textContent = e.message;
    toast(e.message, true);
  } finally {
    button.disabled = false;
  }
});
window.addEventListener("beforeunload", (event) => {
  if (busy() || S.combinedDraft !== null || Object.keys(S.notes).length) {
    event.preventDefault();
    event.returnValue = "";
  }
});
$("sign-out").onclick = async () => {
  if (busy() || S.combinedDraft !== null || Object.keys(S.notes).length)
    return toast("Save your edits and wait for pending requests before signing out.", true);
  try { await api("/auth/logout", { method: "POST", data: {} }); location.replace("/signin"); }
  catch (error) { toast(error.message, true); }
};
try {
  const config = await api("/config");
  if (config.browserSession) {
    token = ""; sessionStorage.removeItem("prism-session");
    $("sign-out").hidden = false;
    $("storage-note").textContent = "Saved on the Prism server";
    if (!config.liveEnabled) $("mode").querySelector('[value="live"]').disabled = true;
  }
  S.providers = config.providers;
  S.connections = config.connections;
  renderProviders();
  await refreshHistory();
  const last = localStorage.getItem("prism-last-run");
  if (last && S.history.some((r) => r.id === last)) await loadRun(last);
} catch (e) {
  $("send-button").disabled = true;
  toast(e.message, true);
}
let polling = false;
setInterval(async () => {
  if (
    polling ||
    !S.run ||
    S.requests.size ||
    !S.run.responses.some((r) => r.status === "running")
  )
    return;
  polling = true;
  try {
    acceptRun((await api("/runs/" + S.run.id)).run);
    renderSession();
  } catch {
    /* existing snapshot remains visible; polling does not generate or retry provider calls */
  } finally {
    polling = false;
  }
}, 1500);
