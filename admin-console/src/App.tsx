// App root — router setup with shared layout.

import { HashRouter, Routes, Route } from "react-router-dom";
import { NavHeader } from "./components/NavHeader";
import { LessonsPage } from "./pages/Lessons";
import { ReviewsPage } from "./pages/Reviews";

export default function App() {
  return (
    <HashRouter>
      <div className="min-h-screen flex flex-col">
        <NavHeader />
        <div className="mx-auto max-w-6xl w-full px-4 py-6 flex-1">
          <Routes>
            <Route path="/" element={<LessonsPage />} />
            <Route path="/reviews" element={<ReviewsPage />} />
            <Route path="*" element={<LessonsPage />} />
          </Routes>
        </div>
      </div>
    </HashRouter>
  );
}
