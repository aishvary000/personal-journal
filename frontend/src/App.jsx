import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LoginPage from './pages/login/Login';
import Dashboard from './pages/dashboard/Dashboard';
import ProtectedRoute from './hocs/protectedRoute/ProtectedRoute';
import OnThisDay from './pages/onThisDay/OnThisDay';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        <Route path="/on-this-day" element={<ProtectedRoute><OnThisDay /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  );
}
