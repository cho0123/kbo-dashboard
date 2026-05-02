import { useCallback, useEffect, useState } from "react";
import { postKbo } from "./api.js";

async function parseVideoEncodeJson(res) {
  const rawText = await res.text();
  let payload;
  try {
    payload = JSON.parse(rawText);
  } catch {
    throw new Error(rawText || `HTTP ${res.status}`);
  }
  if (!res.ok) {
    throw new Error(
      payload?.error || payload?.message || `HTTP ${res.status}`
    );
  }
  return payload;
}

async function putPresigned(url, body, contentType) {
  const res = await fetch(url, {
    method: "PUT",
    body,
    headers: { "Content-Type": contentType },
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(
      `S3 업로드 실패 HTTP ${res.status}${t ? `: ${t.slice(0, 200)}` : ""}`
    );
  }
}

function audioDuration(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    a.preload = "metadata";
    a.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(a.duration);
    };
    a.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("재생 시간을 읽을 수 없습니다."));
    };
    a.src = url;
  });
}

export default function MusicLibraryPanel() {
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [uploadName, setUploadName] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await postKbo({ action: "music_list" });
      setTracks(Array.isArray(res?.tracks) ? res.tracks : []);
    } catch (e) {
      setErr(e?.message || String(e));
      setTracks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onUpload = async () => {
    if (!file) {
      window.alert("MP3 파일을 선택하세요.");
      return;
    }
    const name =
      uploadName.trim() ||
      file.name.replace(/\.[^.]+$/, "") ||
      "제목 없음";
    setBusy(true);
    setErr(null);
    try {
      let durationSec = 0;
      try {
        durationSec = await audioDuration(file);
      } catch {
        durationSec = 0;
      }
      const prep = await parseVideoEncodeJson(
        await fetch("/api/video-encode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "music_upload_url",
            fileName: file.name,
          }),
        })
      );
      const { key, presignedPutUrl } = prep;
      if (!key || !presignedPutUrl) {
        throw new Error("music_upload_url 응답에 key 또는 presignedPutUrl 없음");
      }
      await putPresigned(presignedPutUrl, file, "audio/mpeg");
      await postKbo({
        action: "music_save",
        name,
        s3_key: key,
        duration: Number.isFinite(durationSec) ? durationSec : 0,
      });
      setFile(null);
      setUploadName("");
      await load();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async (id) => {
    if (!window.confirm("이 음원을 삭제할까요?")) return;
    setBusy(true);
    setErr(null);
    try {
      await postKbo({ action: "music_delete", id });
      await load();
    } catch (e) {
      setErr(e?.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="result-page video-presets-page">
      <div className="result-hero-title">🎵 음원 라이브러리</div>
      <p className="muted" style={{ marginTop: 6 }}>
        MP3를 S3 <code>music/…</code> 에 올린 뒤 Firestore{" "}
        <code>music_library</code>에 등록합니다.
      </p>

      <div style={{ marginTop: 16, maxWidth: 480 }}>
        <label className="preset-field">
          <span>표시 이름</span>
          <input
            type="text"
            value={uploadName}
            onChange={(e) => setUploadName(e.target.value)}
            placeholder="예: 브금_A"
          />
        </label>
        <label className="preset-field">
          <span>MP3 파일</span>
          <input
            type="file"
            accept="audio/mpeg,.mp3,audio/mp3"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <button
          type="button"
          className="primary primary-fill"
          disabled={busy}
          onClick={onUpload}
        >
          {busy ? "업로드 중…" : "업로드 및 등록"}
        </button>
      </div>

      {err ? (
        <pre className="result-error-light" style={{ marginTop: 12 }}>
          {err}
        </pre>
      ) : null}

      {loading ? (
        <div className="muted" style={{ marginTop: 16 }}>
          불러오는 중…
        </div>
      ) : (
        <div style={{ marginTop: 20 }}>
          <div style={{ marginBottom: 8, fontWeight: 700 }}>
            등록된 음원 ({tracks.length})
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {tracks.map((t) => (
              <div
                key={t.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>{t.name || t.id}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {Number.isFinite(Number(t.duration))
                      ? `${Math.round(Number(t.duration) * 10) / 10}초`
                      : "—"}
                    {" · "}
                    <span className="mono" style={{ fontSize: 11 }}>
                      {t.s3_key}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="danger-outline"
                  disabled={busy}
                  onClick={() => onDelete(t.id)}
                >
                  삭제
                </button>
              </div>
            ))}
          </div>
          {!tracks.length ? (
            <div className="muted" style={{ marginTop: 12 }}>
              등록된 음원이 없습니다.
            </div>
          ) : null}
        </div>
      )}

      <button
        type="button"
        className="ghost"
        style={{ marginTop: 16 }}
        onClick={() => load()}
      >
        목록 새로고침
      </button>
    </div>
  );
}
