import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import GetStarted from './pages/Getstarted'
import Auth       from './pages/Auth'
import Home       from './pages/Home'
import TopRatedPage from "./pages/TopRatedPage";

function ProtectedRoute({ children }) {
  const token = localStorage.getItem('rook_access_token')
  return token ? children : <Navigate to="/auth" replace />
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Landing page */}
        <Route path="/" element={<GetStarted />} />

        {/* Auth page — redirect to home if already logged in */}
        <Route path="/auth" element={<Auth />} />

        {/* Home — protected, redirects to /auth if not logged in */}
        <Route
          path="/home"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />
        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
        <Route path="/top-rated" element={<TopRatedPage />} />
      </Routes>
    </BrowserRouter>
  );
}