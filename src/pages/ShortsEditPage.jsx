import { useState } from "react";
import { Link } from "react-router-dom";
import Shorts3Panel from "../Shorts3Panel.jsx";

export default function ShortsEditPage() {
  const [pendingSegments, setPendingSegments] = useState([]);
  const [shorts3JobId, setShorts3JobId] = useState("");

  return (
    <div className="app-shell shell-wide shorts-edit-page">
      <header className="shorts-edit-page-head">
        <Link to="/" className="shorts-edit-back-link">
          ← 대시보드로 돌아가기
        </Link>
      </header>
      <Shorts3Panel
        pendingSegments={pendingSegments}
        onPendingSegmentsUsed={() => setPendingSegments([])}
        onJobIdChange={setShorts3JobId}
      />
    </div>
  );
}
