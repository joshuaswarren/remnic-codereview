// App root — router setup with shared layout.

import { HashRouter, Routes, Route } from "react-router-dom";
import { NavHeader } from "./components/NavHeader";
import { LessonsPage } from "./pages/Lessons";

export default function App() {
  return (
    <HashRouter>
      <div className="min-h-screen flex flex-col">
        <NavHeader />
        <div className="mx-auto max-w-6xl w-full px-4 py-6 flex-1">
          <Routes>
            <Route path="/" element={<LessonsPage />} />
            <Route path="/reviews" element={<ReviewsPlaceholder />} />
            <Route path="*" element={<LessonsPage />} />
          </Routes>
        </div>
      </div>
    </HashRouter>
  );
}

/** Placeholder for the reviews page (implemented in a separate feature). */
function ReviewsPlaceholder() {
  return (
    <div>
      <h1 className="text-xl font-semibold mb-4" style={{ color: "var(--color-text-primary)" }}>
        Reviews
      </h1>
      <p style={{ color: "var(--color-text-secondary)" }}>
        No reviews yet. The reviews log will appear here after running the review pipeline.
      </p>
    </div>
  );
}
