(() => {
  const MAX_MB = 15;
  const MAX_REC_SECONDS = 300; // 5 minutes
  const $ = (id) => document.getElementById(id);

  const form = $("prayerForm");
  const nameEl = $("name");
  const msgEl = $("message");
  const errorBox = $("errorBox");
  const sendBtn = $("sendBtn");
  $("year").textContent = new Date().getFullYear();

  // ---------- Character counter ----------
  const updateCount = () => ($("charCount").textContent = msgEl.value.length);
  msgEl.addEventListener("input", updateCount);

  // ---------- Speak to type (Web Speech API) ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const dictateBtn = $("dictateBtn");
  const dictateStatus = $("dictateStatus");
  let recognition = null;
  let listening = false;

  if (!SR) {
    $("dictateWrap").classList.add("d-none");
  } else {
    dictateBtn.addEventListener("click", () => (listening ? stopDictation() : startDictation()));
  }

  function startDictation() {
    recognition = new SR();
    recognition.lang = $("dictateLang").value;
    recognition.continuous = true;
    recognition.interimResults = false;
    const base = msgEl.value ? msgEl.value.replace(/\s*$/, " ") : "";
    let spoken = "";
    recognition.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) spoken += e.results[i][0].transcript.trim() + " ";
      }
      msgEl.value = (base + spoken).slice(0, 5000);
      updateCount();
    };
    recognition.onerror = (e) => {
      dictateStatus.textContent =
        e.error === "not-allowed" ? "Microphone access was blocked. Allow it in your browser settings." : "Could not hear clearly. Try again.";
    };
    recognition.onend = () => setListening(false);
    recognition.start();
    setListening(true);
  }
  function stopDictation() {
    recognition && recognition.stop();
    setListening(false);
  }
  function setListening(on) {
    listening = on;
    dictateBtn.classList.toggle("listening", on);
    dictateBtn.querySelector("span").textContent = on ? "Stop" : "Speak to type";
    dictateBtn.querySelector("i").className = on ? "bi bi-stop-fill" : "bi bi-mic";
    if (on) dictateStatus.textContent = "Listening… speak now";
    else if (dictateStatus.textContent.startsWith("Listening")) dictateStatus.textContent = "";
  }

  // ---------- Voice message recorder ----------
  const recBtn = $("recBtn");
  const recTime = $("recTime");
  const recPreview = $("recPreview");
  const recAudio = $("recAudio");
  let mediaRecorder = null;
  let chunks = [];
  let voiceBlob = null;
  let timer = null;
  let seconds = 0;

  if (!navigator.mediaDevices || !window.MediaRecorder) {
    $("recorder").classList.add("d-none");
  }

  function pickMime() {
    const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    return types.find((t) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || "";
  }

  recBtn.addEventListener("click", async () => {
    if (mediaRecorder && mediaRecorder.state === "recording") return mediaRecorder.stop();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMime();
      mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunks = [];
      mediaRecorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(timer);
        voiceBlob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
        recAudio.src = URL.createObjectURL(voiceBlob);
        recPreview.classList.remove("d-none");
        recTime.classList.add("d-none");
        setRecUI(false, true);
      };
      mediaRecorder.start();
      seconds = 0;
      recTime.textContent = "0:00";
      recTime.classList.remove("d-none");
      recPreview.classList.add("d-none");
      timer = setInterval(() => {
        seconds++;
        recTime.textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
        if (seconds >= MAX_REC_SECONDS) mediaRecorder.stop();
      }, 1000);
      setRecUI(true);
    } catch (err) {
      showError("Microphone access was blocked. Allow it in your browser settings to record a voice message.");
    }
  });

  $("recDelete").addEventListener("click", () => {
    voiceBlob = null;
    recAudio.removeAttribute("src");
    recPreview.classList.add("d-none");
    setRecUI(false, false);
  });

  function setRecUI(recording, hasRecording) {
    recBtn.classList.toggle("recording", recording);
    recBtn.querySelector("i").className = recording ? "bi bi-stop-fill" : "bi bi-record-circle";
    recBtn.querySelector("span").textContent = recording
      ? "Stop recording"
      : hasRecording
      ? "Record again"
      : "Record voice message";
  }

  // ---------- File inputs ----------
  function wireFile(inputId, nameId, emptyText, onPick) {
    const input = $(inputId);
    input.addEventListener("change", () => {
      const f = input.files[0];
      const tile = input.previousElementSibling;
      if (f && f.size > MAX_MB * 1024 * 1024) {
        input.value = "";
        showError(`"${f.name}" is larger than ${MAX_MB} MB. Choose a smaller file.`);
        $(nameId).textContent = emptyText;
        tile.classList.remove("has-file");
        onPick && onPick(null);
        return;
      }
      $(nameId).textContent = f ? f.name : emptyText;
      tile.classList.toggle("has-file", !!f);
      onPick && onPick(f);
    });
  }
  wireFile("image", "imageName", "No photo chosen", (f) => {
    const img = $("imagePreview");
    if (f) { img.src = URL.createObjectURL(f); img.classList.remove("d-none"); }
    else img.classList.add("d-none");
  });
  wireFile("audio", "audioName", "No audio chosen");

  // ---------- Submit ----------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError();
    if (listening) stopDictation();
    if (mediaRecorder && mediaRecorder.state === "recording") {
      return showError("Stop the voice recording before sending.");
    }

    const name = nameEl.value.trim();
    nameEl.classList.toggle("is-invalid", !name);
    if (!name) return nameEl.focus();

    const hasContent = msgEl.value.trim() || voiceBlob || $("image").files[0] || $("audio").files[0];
    if (!hasContent) return showError("Type, speak, or attach your prayer request before sending.");

    const data = new FormData(form);
    if (voiceBlob) {
      const ext = voiceBlob.type.includes("mp4") ? "m4a" : voiceBlob.type.includes("ogg") ? "ogg" : "webm";
      data.append("voice", voiceBlob, `voice-message.${ext}`);
    }

    setBusy(true);
    try {
      const res = await fetch("/api/prayer", { method: "POST", body: data });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) throw new Error(json.error || "Your request could not be sent. Please try again.");
      $("thanksName").textContent = name;
      $("formCard").classList.add("d-none");
      $("successCard").classList.remove("d-none");
      $("successCard").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (err) {
      showError(navigator.onLine ? err.message : "You appear to be offline. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  });

  $("againBtn").addEventListener("click", () => {
    form.reset();
    voiceBlob = null;
    recPreview.classList.add("d-none");
    setRecUI(false, false);
    $("imagePreview").classList.add("d-none");
    $("imageName").textContent = "No photo chosen";
    $("audioName").textContent = "No audio chosen";
    document.querySelectorAll(".file-tile").forEach((t) => t.classList.remove("has-file"));
    updateCount();
    $("successCard").classList.add("d-none");
    $("formCard").classList.remove("d-none");
    nameEl.focus();
  });

  nameEl.addEventListener("input", () => nameEl.classList.remove("is-invalid"));

  function setBusy(on) {
    sendBtn.disabled = on;
    sendBtn.querySelector(".btn-label").classList.toggle("d-none", on);
    sendBtn.querySelector(".btn-busy").classList.toggle("d-none", !on);
  }
  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.remove("d-none");
    errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function hideError() {
    errorBox.classList.add("d-none");
  }
})();
