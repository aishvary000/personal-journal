import { BrowserRouter, Routes, Route } from 'react-router-dom';
import LoginPage from './pages/login/Login';
import Dashboard from './pages/dashboard/Dashboard';
import ProtectedRoute from './hocs/protectedRoute/ProtectedRoute';
import OnThisDay from './pages/onThisDay/OnThisDay';
import SharePage from './pages/sharePage/SharePage';
import Collections from './pages/collections/Collections';
import Moments from './pages/moments/Moments';
import MomentDetail from './pages/momentDetails/MomentDetails';
import Osmo from './pages/osmo/Osmo';
import TransactionReview from './pages/finance/Finance';
import MapPinning from './pages/mapPinning/MapPinning';

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
        <Route path="/share/:shareId" element={<SharePage/>}/>
        <Route path='/collections' element={<ProtectedRoute><Collections/></ProtectedRoute>} />
        <Route path="/moments" element={<ProtectedRoute><Moments /></ProtectedRoute>} />
        <Route path="/moments/:clusterId" element={<ProtectedRoute><MomentDetail /></ProtectedRoute>} />
        <Route path="/osmo" element={<ProtectedRoute><Osmo /></ProtectedRoute>} />
        <Route path="/finance/review" element={<ProtectedRoute><TransactionReview /></ProtectedRoute>} />
        <Route path="/map" element={<ProtectedRoute><MapPinning /></ProtectedRoute>} />
        <Route path="*" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  );
}
