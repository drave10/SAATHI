import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import Layout from './components/Layout'
import { Spinner } from './components/ui'
import type { Role } from './types'
import Login from './pages/Login'
import BeneficiaryDashboard from './pages/beneficiary/Dashboard'
import Assessment from './pages/beneficiary/Assessment'
import AssessmentHistory from './pages/beneficiary/History'
import Trends from './pages/beneficiary/Trends'
import Resources from './pages/beneficiary/Resources'
import CaseworkerDashboard from './pages/caseworker/Dashboard'
import CaseDetail from './pages/caseworker/CaseDetail'
import FollowUps from './pages/caseworker/FollowUps'
import Interventions from './pages/caseworker/Interventions'
import AdminDashboard from './pages/admin/Dashboard'
import UserManagement from './pages/admin/Users'
import Analytics from './pages/admin/Analytics'
import Settings from './pages/Settings'

function Protected({ roles, children }: { roles?: Role[]; children: JSX.Element }) {
  const { user, loading } = useAuth()
  if (loading) return <Spinner label="Restoring session…" />
  if (!user) return <Navigate to="/" replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/app" replace />
  return children
}

function Home() {
  const { user } = useAuth()
  if (!user) return null
  return user.role === 'beneficiary' ? <BeneficiaryDashboard /> : user.role === 'caseworker' ? <CaseworkerDashboard /> : <AdminDashboard />
}

export default function App() {
  const { user, loading } = useAuth()
  return (
    <Routes>
      <Route path="/" element={loading ? <Spinner /> : user ? <Navigate to="/app" replace /> : <Login />} />
      <Route path="/app" element={<Protected><Layout /></Protected>}>
        <Route index element={<Home />} />
        <Route path="assessment" element={<Protected roles={['beneficiary']}><Assessment /></Protected>} />
        <Route path="history" element={<Protected roles={['beneficiary']}><AssessmentHistory /></Protected>} />
        <Route path="trends" element={<Protected roles={['beneficiary']}><Trends /></Protected>} />
        <Route path="resources" element={<Protected roles={['beneficiary']}><Resources /></Protected>} />
        <Route path="cases" element={<Protected roles={['caseworker']}><CaseworkerDashboard casesOnly /></Protected>} />
        <Route path="cases/:id" element={<Protected roles={['caseworker']}><CaseDetail /></Protected>} />
        <Route path="followups" element={<Protected roles={['caseworker']}><FollowUps /></Protected>} />
        <Route path="interventions" element={<Protected roles={['caseworker']}><Interventions /></Protected>} />
        <Route path="users" element={<Protected roles={['admin']}><UserManagement /></Protected>} />
        <Route path="analytics" element={<Protected roles={['admin']}><Analytics /></Protected>} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
